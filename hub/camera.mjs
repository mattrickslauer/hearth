/**
 * Hearth hub camera — a camera is just another sensor.
 *
 * It self-describes a single `cam.frame` sensor and, on a cadence, "snaps a
 * photo": one JPEG sampled from a live source. The design mirrors an ESP32
 * node exactly (DESCRIBE once, READING on a cadence) so the rest of the hub —
 * registry, /live broadcast, cloud sync, the watch runtime — treats it with no
 * special cases. Two things stay TRUE to the thesis:
 *
 *   1. Frames are sampled at intervals, never streamed. The READING is tiny
 *      metadata (`"q70 1280x720 @14:03:12"`); the actual pixels are pulled on
 *      demand from GET /frame. So cloud sync stays cheap and no video leaves.
 *   2. Two knobs, like any sensor: cadence (how often it snaps) and quality
 *      (resolution + JPEG quality — the token/detail tradeoff). Cadence can be
 *      retuned live from the cloud via the same per-sensor cadence downlink the
 *      ESP nodes use.
 *
 * Source is swappable (env HEARTH_CAM_SOURCE):
 *   rtmp  (default) — ffmpeg listens; OBS pushes to rtmp://<hub>:1935/live
 *   test            — ffmpeg lavfi testsrc, so the whole pipeline verifies with
 *                     no OBS running
 *   <string>        — raw ffmpeg input args, e.g. "-f v4l2 -i /dev/video0"
 *
 * Needs ffmpeg on PATH. If it's absent the hub logs and runs on without a camera.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const iso = () => new Date().toISOString();
const hhmmss = () => new Date().toISOString().slice(11, 19);

// quality 1..100 → ffmpeg -q:v 2 (best) .. 31 (worst). Higher quality = more detail = more tokens.
const qToQv = (q) => Math.max(2, Math.min(31, Math.round(31 - (Math.max(1, Math.min(100, q)) / 100) * 29)));

// A whole JPEG ends with the EOI marker FF D9 — used to skip a frame ffmpeg is mid-write on.
const isCompleteJpeg = (buf) => buf.length > 3 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;

/**
 * Create the camera sensor. Wire it to the hub by passing the hub's `ingest`
 * (to fold DESCRIBE/READING into the registry like any node). Returns handles
 * the hub uses for GET /frame and live cadence retuning.
 *
 * @param {{ ingest: (doc:object)=>void, onFrame?: (input:string, dataUri:string)=>void }} deps
 *   onFrame — called with the full-frame data: URI each time a fresh JPEG is captured, so the
 *   hub can push the bytes up to Hearth Cloud (→ OSS) where the dashboard and Qwen-VL read them.
 */
export function createCamera({ ingest, onFrame }) {
  const id = process.env.HEARTH_CAM_ID || 'hub-cam';
  const source = process.env.HEARTH_CAM_SOURCE || 'rtmp';
  const rtmpUrl = process.env.HEARTH_CAM_RTMP || 'rtmp://0.0.0.0:1935/live';
  const width = Number(process.env.HEARTH_CAM_WIDTH || 1280);
  let quality = Number(process.env.HEARTH_CAM_QUALITY || 70);
  let cadenceMs = Number(process.env.HEARTH_CAM_CADENCE_MS || 5000);

  const framePath = join(mkdtempSync(join(tmpdir(), 'hearth-cam-')), 'latest.jpg');
  let latest = null; // { buf: Buffer, at: number, w: number, h: number, quality: number, bytes: number }
  let lastMtime = 0;
  let proc = null;
  let pollTimer = null;
  let stopped = false;

  const describeDoc = () => ({
    id,
    type: 'hearth.node.describe',
    board: 'hub/obs-camera',
    sensors: [
      {
        key: 'cam.frame',
        kind: 'camera',
        label: 'Doorway camera',
        vision: true,
        describes: 'a live camera frame of the doorway, sampled at a cadence for Qwen-VL to read',
        config: { cadenceMs, quality, width },
      },
    ],
    actuators: [],
  });

  // Build ffmpeg args for the chosen source. Output is a single JPEG overwritten
  // every `cadenceMs` (fps=1/sec), scaled to `width`, at the mapped JPEG quality.
  function ffmpegArgs() {
    const sec = Math.max(1, cadenceMs / 1000);
    let input;
    if (source === 'test') {
      input = ['-f', 'lavfi', '-re', '-i', `testsrc=size=${width}x720:rate=15`];
    } else if (source === 'rtmp') {
      input = ['-listen', '1', '-i', rtmpUrl];
    } else {
      input = source.split(/\s+/); // raw ffmpeg input args
    }
    return [
      '-loglevel', 'error',
      ...input,
      '-vf', `fps=1/${sec},scale=${width}:-2`,
      '-q:v', String(qToQv(quality)),
      '-f', 'image2',
      '-update', '1',
      '-y', framePath,
    ];
  }

  function spawnFfmpeg() {
    if (stopped) return;
    const args = ffmpegArgs();
    console.log(`[cam] ffmpeg ${source === 'rtmp' ? `listening for OBS at ${rtmpUrl}` : `source=${source}`} · every ${cadenceMs}ms · q${quality} · ${width}px`);
    proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', (d) => {
      const line = String(d).trim();
      if (line) console.log(`[cam] ffmpeg: ${line.split('\n')[0]}`);
    });
    proc.on('error', (e) => {
      if (e.code === 'ENOENT') {
        console.log('[cam] ffmpeg not found on PATH — camera disabled.');
        stopped = true;
        return;
      }
      console.log(`[cam] ffmpeg error: ${e.message}`);
    });
    proc.on('exit', (code) => {
      proc = null;
      if (stopped) return;
      // rtmp: OBS disconnected (or never connected yet). test/device: source ended. Respawn.
      console.log(`[cam] ffmpeg exited (${code}) — restarting in 2s`);
      setTimeout(spawnFfmpeg, 2000);
    });
  }

  // Poll the frame file; when ffmpeg has written a fresh, complete JPEG, capture
  // it and emit a READING through the hub's normal ingest path.
  function poll() {
    try {
      const st = statSync(framePath);
      if (st.mtimeMs !== lastMtime && st.size > 0) {
        const buf = readFileSync(framePath);
        if (isCompleteJpeg(buf)) {
          lastMtime = st.mtimeMs;
          latest = { buf, at: Date.now(), w: width, quality, bytes: buf.length };
          ingest({
            id,
            type: 'hearth.node.reading',
            readings: { 'cam.frame': `q${quality} ${width}px ${(buf.length / 1024).toFixed(0)}KB @${hhmmss()}` },
          });
          // Push the actual pixels up to the cloud (→ OSS) so any dashboard, anywhere, and the
          // Qwen-VL judge can pull this frame by presigned URL — no reach-in to the LAN. Sampled,
          // not streamed: one JPEG per snap, overwriting a single latest-frame key.
          if (onFrame) onFrame(`${id}.cam.frame`, `data:image/jpeg;base64,${buf.toString('base64')}`);
        }
      }
    } catch {
      // no frame yet (ffmpeg still waiting for OBS / warming up) — normal
    }
  }

  return {
    id,
    /** Register the camera as a node and start capturing. */
    start() {
      ingest(describeDoc());
      spawnFfmpeg();
      pollTimer = setInterval(poll, Math.max(250, Math.min(cadenceMs, 1000)));
      if (pollTimer.unref) pollTimer.unref();
      console.log(`[cam] camera sensor "${id}" online — frame at GET /frame, describes cam.frame [vision]`);
    },
    /** Latest complete JPEG for GET /frame (or null if none captured yet). */
    getFrame() {
      return latest;
    },
    /** Current sensor config — for GET /camera so the dashboard can seed its sliders. */
    config() {
      return { id, source, width, quality, cadenceMs, hasFrame: !!latest, frameAt: latest?.at ?? null };
    },
    /** Retune the snap cadence live (from the cloud per-sensor cadence downlink). */
    setCadence(ms) {
      if (!ms || !Number.isFinite(ms) || ms === cadenceMs) return;
      cadenceMs = Math.max(500, Math.round(ms));
      console.log(`[cam] cadence → ${cadenceMs}ms (re-describing + restarting capture)`);
      ingest(describeDoc());
      if (proc) proc.kill('SIGKILL'); // exit handler respawns with the new fps
    },
    /** Adjust capture quality live (1..100). */
    setQuality(q) {
      const v = Math.max(1, Math.min(100, Math.round(q)));
      if (v === quality) return;
      quality = v;
      console.log(`[cam] quality → ${quality}`);
      ingest(describeDoc());
      if (proc) proc.kill('SIGKILL');
    },
    stop() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (proc) proc.kill('SIGKILL');
    },
  };
}
