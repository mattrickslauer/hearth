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
 *   auto            — find a real USB/built-in camera on this machine and use it;
 *                     falls back to `rtmp` if there isn't one. What `hearthctl
 *                     camera on` uses, so plugging a camera in is the whole setup.
 *   rtmp  (default) — ffmpeg listens; OBS pushes to rtmp://<hub>:1935/live
 *   test            — ffmpeg lavfi testsrc, so the whole pipeline verifies with
 *                     no OBS running
 *   <string>        — raw ffmpeg input args, e.g. "-f v4l2 -i /dev/video0"
 *
 * Needs ffmpeg on PATH. If it's absent the hub logs and runs on without a camera.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseEnabled } from './wire.mjs';

const iso = () => new Date().toISOString();
const hhmmss = () => new Date().toISOString().slice(11, 19);

/**
 * A camera's node id, unique to this machine.
 *
 * Node ids are the key for readings, cadence downlinks and the stored frame, and nothing upstream
 * makes them unique — ESP nodes only avoid collisions because theirs are MAC-derived. This one
 * used to be the constant 'hub-cam', so every hub's camera was literally the same node: two hubs
 * on an account overwrote each other's frames and interleaved into one reading series.
 *
 * Seeded from /etc/machine-id (hostname if absent) rather than the cloud-assigned hub id, because
 * the camera starts before the hub has enrolled and must keep working with no network at all.
 */
function defaultCameraId() {
  let seed;
  try {
    seed = readFileSync('/etc/machine-id', 'utf8').trim();
  } catch {
    seed = hostname();
  }
  return `cam-${createHash('sha256').update(seed || hostname()).digest('hex').slice(0, 8)}`;
}

// quality 1..100 → ffmpeg -q:v 2 (best) .. 31 (worst). Higher quality = more detail = more tokens.
const qToQv = (q) => Math.max(2, Math.min(31, Math.round(31 - (Math.max(1, Math.min(100, q)) / 100) * 29)));

// A whole JPEG ends with the EOI marker FF D9 — used to skip a frame ffmpeg is mid-write on.
const isCompleteJpeg = (buf) => buf.length > 3 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;

/** Human-readable name of a v4l2 node, e.g. "Integrated Camera". Best-effort. */
const v4l2Name = (dev) => {
  try {
    return readFileSync(`/sys/class/video4linux/${dev}/name`, 'utf8').trim();
  } catch {
    return dev;
  }
};

// Per-device probe timeout. A working capture node hands back a frame in well under a second; this
// only guards a device that opens but never delivers. Kept modest (was 8s) so `auto` on a box with
// several dead video nodes still resolves quickly — and, being async now, without blocking anyway.
const DETECT_TIMEOUT_MS = Number(process.env.HEARTH_CAM_DETECT_MS || 4000);

/**
 * Try to pull ONE frame from a v4l2 node to a null output — the cheapest proof it's a capture
 * device we have permission to read. Resolves true on ffmpeg exit 0, false on any error/non-zero
 * exit/timeout. Async (spawn, not spawnSync) so probing never blocks the event loop: pairing,
 * heartbeat and LAN serving proceed while we probe.
 */
function probeDevice(dev) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const proc = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-f', 'v4l2', '-i', `/dev/${dev}`, '-frames:v', '1', '-f', 'null', '-'],
      { stdio: 'ignore' },
    );
    const timer = setTimeout(() => {
      proc.kill('SIGKILL'); // opened but never delivered a frame — give up on this node
      finish(false);
    }, DETECT_TIMEOUT_MS);
    proc.on('error', () => finish(false)); // ffmpeg missing / spawn failure
    proc.on('exit', (code) => finish(code === 0));
  });
}

/**
 * Find a v4l2 device that can actually hand us a frame, and return it as ffmpeg
 * input args (or null if there's nothing usable).
 *
 * Why probe instead of just taking /dev/video0? Because on most modern laptops
 * /dev/video0 is NOT the camera. A single UVC webcam registers several nodes —
 * the extra ones are metadata/control interfaces that report "Not a video
 * capture device" the moment you open them. The capture node is frequently
 * video1. Numeric order tells you nothing, and guessing wrong looks identical
 * to broken hardware, so the only honest test is to open each one and try to
 * pull a frame — which we now do async, one node at a time (finding 2).
 *
 * Linux-only (v4l2). Anywhere else we resolve null and the caller falls back to rtmp.
 */
async function detectCaptureDevice() {
  if (process.platform !== 'linux') return null;
  let devs;
  try {
    devs = readdirSync('/dev')
      .filter((f) => /^video\d+$/.test(f))
      .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  } catch {
    return null;
  }
  for (const dev of devs) {
    if (await probeDevice(dev)) {
      console.log(`[cam] auto-detected camera: /dev/${dev} — ${v4l2Name(dev)}`);
      return `-f v4l2 -i /dev/${dev}`;
    }
  }
  return null;
}

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
  const id = process.env.HEARTH_CAM_ID || defaultCameraId();
  const requested = process.env.HEARTH_CAM_SOURCE || 'rtmp';
  // `auto` resolves to whatever camera is actually plugged into this machine — but that probe is
  // async now (finding 2), so start with a provisional `rtmp` source and re-resolve in start()
  // BEFORE the first ffmpeg spawn. No camera → rtmp, i.e. exactly the OBS behaviour, so a hub with
  // no local camera is unaffected. Non-auto sources are already final (nothing to probe).
  let source = requested === 'auto' ? 'rtmp' : requested;
  let sourceResolved = requested !== 'auto';
  async function resolveSource() {
    if (sourceResolved) return;
    const detected = await detectCaptureDevice();
    if (detected) source = detected;
    else console.log('[cam] auto: no local camera found — listening for OBS over rtmp instead');
    sourceResolved = true;
  }
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
  // The capture switch. Distinct from `stopped` (process shutdown, terminal): powered off is a
  // USER state — ffmpeg is down, nothing is snapped, pushed or billed — and powering back on
  // resumes capture in place. Driven from the cloud via the same desired-state downlink as any
  // ESP actuator (the node self-describes `power` below), or LAN-direct via POST /camera.
  let powered = true;

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
    // The camera IS commandable hardware: `power` is its capture switch. Describing it as a
    // normal actuator is what makes stop/start ride the existing rails — the dashboard and the
    // `actuate` tool write the device shadow, the hub applies it here, no camera-shaped special
    // case anywhere upstream.
    actuators: [{ key: 'power', kind: 'switch', label: 'Capture on/off' }],
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
    // `proc` guard: setPower(on) and a pending exit-respawn timer can both try to start
    // capture — whoever runs second must find it already running, not fork a second ffmpeg.
    if (stopped || !powered || proc) return;
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
      // Powered off: this exit is the kill we asked for — stay down until setPower(true).
      if (stopped || !powered) return;
      // rtmp: OBS disconnected (or never connected yet). test/device: source ended. Respawn.
      console.log(`[cam] ffmpeg exited (${code}) — restarting in 2s`);
      setTimeout(spawnFfmpeg, 2000);
    });
  }

  // Poll the frame file; when ffmpeg has written a fresh, complete JPEG, capture
  // it and emit a READING through the hub's normal ingest path.
  function poll() {
    // Off = silent. ffmpeg is already dead, but a frame it was mid-writing at the kill could
    // still land on disk — without this guard that last frame would push after "off".
    if (!powered) return;
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

  // (Re)create the frame poll on a period that tracks the snap cadence — fast enough to catch a
  // sub-second cadence (floored at 250ms), never slower than 1s. It's recreated on every
  // setCadence() because a timer fixed at start() would, after cadence is lowered, fire slower than
  // frames are written and skip every other one (finding 7).
  function startPollTimer() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, Math.max(250, Math.min(cadenceMs, 1000)));
    if (pollTimer.unref) pollTimer.unref();
  }

  return {
    id,
    /** Register the camera as a node and start capturing. */
    start() {
      ingest(describeDoc());
      // Resolve the capture source (async for `auto` — finding 2), THEN spawn ffmpeg. Describe and
      // the poll timer start immediately so pairing/heartbeat/LAN serving never wait on the probe.
      resolveSource().then(spawnFfmpeg);
      startPollTimer();
      console.log(`[cam] camera sensor "${id}" online — frame at GET /frame, describes cam.frame [vision]`);
    },
    /** Latest complete JPEG for GET /frame (or null if none captured yet). */
    getFrame() {
      return latest;
    },
    /** Current sensor config — for GET /camera so the dashboard can seed its sliders. */
    config() {
      return { id, source, width, quality, cadenceMs, enabled: powered, hasFrame: !!latest, frameAt: latest?.at ?? null };
    },
    /**
     * Stop or resume capture (the `power` actuator). Applied from the cloud device shadow on
     * every sync — no shadow entry means "never commanded", which is ON, so a fresh account's
     * camera runs without anyone touching a switch. Off kills ffmpeg and silences the poll:
     * no readings, no frame pushes, no Looks spent. On respawns and capture resumes.
     */
    setPower(on) {
      const v = parseEnabled(on); // shared forgiving parse (hub/wire.mjs); undefined/null = on
      if (v === powered || stopped) return;
      powered = v;
      console.log(`[cam] capture ${powered ? 'ON — resuming' : 'OFF — stopping ffmpeg, holding last frame'}`);
      if (powered) spawnFfmpeg();
      else if (proc) proc.kill('SIGKILL'); // exit handler sees !powered and stays down
    },
    /** Retune the snap cadence live (from the cloud per-sensor cadence downlink). */
    setCadence(ms) {
      if (!ms || !Number.isFinite(ms) || ms === cadenceMs) return;
      cadenceMs = Math.max(500, Math.round(ms));
      console.log(`[cam] cadence → ${cadenceMs}ms (re-describing + restarting capture)`);
      ingest(describeDoc());
      startPollTimer(); // re-pace the frame poll to the new cadence so we don't skip frames (finding 7)
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
