/**
 * Hearth camera capture engine — the ffmpeg half of a camera peripheral.
 *
 * This module knows how to turn a video source into a stream of sampled JPEGs.
 * It deliberately knows NOTHING about the Hearth node protocol: no node id, no
 * DESCRIBE, no ingest. That wiring lives in node.mjs, where a camera is exactly
 * what it should be — one peripheral of a node, described and streamed the same
 * way an ESP32 describes its thermistor. Two things stay TRUE to the thesis:
 *
 *   1. Frames are sampled at intervals, never streamed. Each fresh JPEG is
 *      handed to `onFrame`; the node turns it into a tiny READING plus the
 *      frame bytes for the hub. So sync stays cheap and no video leaves.
 *      For a real camera DEVICE this goes further: the device is opened only
 *      for the ~1s of each snap (open → grab → close), so the webcam LED is off
 *      between snaps, other apps can use the camera, and no long-lived process
 *      exists to wedge it. Only a pushed stream (rtmp) holds ffmpeg open.
 *   2. Two knobs, like any sensor: cadence (how often it snaps) and quality
 *      (resolution + JPEG quality — the token/detail tradeoff). Both retune
 *      live via the same per-sensor downlink the ESP nodes use.
 *
 * Source is swappable (`source` option / HEARTH_CAM_SOURCE):
 *   auto            — find a real camera on this machine (v4l2 on Linux,
 *                     avfoundation on macOS) and use it.
 *   rtmp            — ffmpeg listens; OBS pushes to rtmp://<host>:1935/live
 *   test            — ffmpeg lavfi testsrc, so the whole pipeline verifies with
 *                     no camera and no OBS
 *   <string>        — raw ffmpeg input args, e.g. "-f v4l2 -i /dev/video0"
 *
 * Needs ffmpeg on PATH. If it's absent the engine logs and stays down.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseEnabled } from './wire.mjs';

// quality 1..100 → ffmpeg -q:v 2 (best) .. 31 (worst). Higher quality = more detail = more tokens.
const qToQv = (q) => Math.max(2, Math.min(31, Math.round(31 - (Math.max(1, Math.min(100, q)) / 100) * 29)));

// A whole JPEG ends with the EOI marker FF D9 — used to skip a frame ffmpeg is mid-write on.
const isCompleteJpeg = (buf) => buf.length > 3 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;

// Every live capture process, so one exit hook can reap them all. The graceful path
// (stop()/setPower(off)) kills ffmpeg explicitly; this hook covers the process dying any
// other way Node still gets to run code for (uncaught exception, process.exit) — an
// orphaned ffmpeg keeps the webcam open, and its LED on, until someone notices.
// (SIGKILL skips this too; `hearthctl` sweeps leftovers on stop/start for that case.)
const liveProcs = new Set();
process.on('exit', () => {
  for (const p of liveProcs) {
    try {
      p.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
});

/** Human-readable name of a v4l2 node, e.g. "Integrated Camera". Best-effort. */
const v4l2Name = (dev) => {
  try {
    return readFileSync(`/sys/class/video4linux/${dev}/name`, 'utf8').trim();
  } catch {
    return dev;
  }
};

// Per-device probe timeout. A working capture device hands back a frame in well under a second;
// this only guards a device that opens but never delivers. Kept modest so `auto` on a box with
// several dead video nodes still resolves quickly — and, being async, without blocking anyway.
const DETECT_TIMEOUT_MS = Number(process.env.HEARTH_CAM_DETECT_MS || 4000);

/**
 * Try to pull ONE frame from an input to a null output — the cheapest proof it's a capture
 * source we have permission to read. Resolves true on ffmpeg exit 0, false on any error /
 * non-zero exit / timeout. Async (spawn, not spawnSync) so probing never blocks the event
 * loop: a node keeps serving /actuate, and an embedding hub keeps pairing, while we probe.
 */
function probeInput(args) {
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
      ['-hide_banner', '-loglevel', 'error', ...args, '-frames:v', '1', '-f', 'null', '-'],
      { stdio: 'ignore' },
    );
    const timer = setTimeout(() => {
      proc.kill('SIGKILL'); // opened but never delivered a frame — give up on this input
      finish(false);
    }, DETECT_TIMEOUT_MS);
    proc.on('error', () => finish(false)); // ffmpeg missing / spawn failure
    proc.on('exit', (code) => finish(code === 0));
  });
}

/**
 * Find a camera on this machine and return it as ffmpeg input args (or null).
 *
 * Linux (v4l2): why probe instead of just taking /dev/video0? Because on most
 * modern laptops /dev/video0 is NOT the camera. A single UVC webcam registers
 * several nodes — the extra ones are metadata/control interfaces that report
 * "Not a video capture device" the moment you open them. The capture node is
 * frequently video1. Numeric order tells you nothing, and guessing wrong looks
 * identical to broken hardware, so the only honest test is to open each one and
 * try to pull a frame — async, one node at a time.
 *
 * macOS (avfoundation): device 0 is the built-in camera on effectively every
 * Mac; probe it the same honest way (it also surfaces the missing-permission
 * case as a clean "no camera" instead of a hung capture).
 */
export async function detectCaptureDevice() {
  if (process.platform === 'darwin') {
    if (await probeInput(['-f', 'avfoundation', '-framerate', '30', '-i', '0'])) {
      console.log('[cam] auto-detected camera: avfoundation device 0');
      return '-f avfoundation -framerate 30 -i 0';
    }
    return null;
  }
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
    // Only consider nodes backed by physical hardware. A virtual device (v4l2loopback —
    // e.g. "OBS Virtual Camera") has no /sys device link, and can hand the probe a STALE
    // frame its long-gone producer left behind — which auto would then ship to the cloud
    // as live footage, forever. Someone who really wants a loopback can still pin it
    // explicitly: `hearthctl camera on -f v4l2 -i /dev/videoN`.
    try {
      statSync(`/sys/class/video4linux/${dev}/device`);
    } catch {
      console.log(`[cam] auto: skipping /dev/${dev} (${v4l2Name(dev)}) — virtual device, not a physical camera`);
      continue;
    }
    if (await probeInput(['-f', 'v4l2', '-i', `/dev/${dev}`])) {
      console.log(`[cam] auto-detected camera: /dev/${dev} — ${v4l2Name(dev)}`);
      return `-f v4l2 -i /dev/${dev}`;
    }
  }
  return null;
}

/**
 * Create the capture engine. Call `start()` to begin snapping; every fresh,
 * complete JPEG is handed to `onFrame(latest)` where latest is
 * `{ buf, at, w, quality, bytes }`. `latest()` returns the same object on
 * demand (for GET /frame).
 *
 * @param {{
 *   source?: string, rtmpUrl?: string, width?: number, quality?: number,
 *   cadenceMs?: number, onFrame?: (latest: object) => void,
 * }} opts
 */
export function createCapture(opts = {}) {
  const source = opts.source || 'rtmp';
  const rtmpUrl = opts.rtmpUrl || process.env.HEARTH_CAM_RTMP || 'rtmp://0.0.0.0:1935/live';
  const width = Number(opts.width || process.env.HEARTH_CAM_WIDTH || 1280);
  let quality = Number(opts.quality || process.env.HEARTH_CAM_QUALITY || 70);
  let cadenceMs = Number(opts.cadenceMs || process.env.HEARTH_CAM_CADENCE_MS || 5000);
  const onFrame = opts.onFrame;

  const framePath = join(mkdtempSync(join(tmpdir(), 'hearth-cam-')), 'latest.jpg');
  let latest = null; // { buf, at, w, quality, bytes }
  let lastMtime = 0;
  let proc = null;
  let pollTimer = null;
  let stopped = false;
  // The capture switch. Distinct from `stopped` (process shutdown, terminal): powered off is a
  // USER state — ffmpeg is down, nothing is snapped, pushed or billed — and powering back on
  // resumes capture in place. Driven exactly like any ESP actuator: the node describes `power`
  // and converges it from the desired-state downlink (or a hub watch's POST /actuate).
  let powered = true;

  // A real camera DEVICE is captured snap-by-snap; only a pushed stream (rtmp) or the
  // synthetic test source keeps a long-lived ffmpeg. Holding a v4l2/avfoundation device
  // open 24/7 to sample one frame every few seconds is how a camera gets wedged: the LED
  // never goes off, nothing else on the machine can use it, and powering down mid-stream
  // can hang the camera's own firmware so hard it drops off the USB bus until a COLD
  // power-off (a warm reboot never cuts USB power, so the wedge survives it). Open →
  // grab → close bounds the exposure to ~a second per snap and leaves the device free
  // between snaps.
  const isDevice = source !== 'rtmp' && source !== 'test' && /(^|\s)-f\s+(v4l2|avfoundation)(\s|$)/.test(source);
  let snapTimer = null;
  let snapInFlight = false;
  let snapFailures = 0;
  let snapProc = null; // the in-flight snap, so stop()/setPower(off) can kill it immediately
  // A device open ~1s per snap means sub-2s cadences would just hold it open anyway —
  // floor the snap interval so "device free between snaps" stays true even if the cloud
  // downlink asks for the 500ms minimum a streaming source can honour.
  const SNAP_MIN_MS = 2000;
  // A single wedged snap must never turn back into a device lock.
  const SNAP_KILL_MS = 15000;

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

  // One snap: a short-lived ffmpeg that opens the device, grabs a handful of frames
  // (the first ones are dark — auto-exposure needs a beat to converge; -update keeps
  // only the last), and exits. The poll loop picks the JPEG up exactly as it does for
  // the streaming sources, so downstream nothing changes.
  function snapOnce() {
    if (stopped || !powered || snapInFlight) return; // never overlap device opens; off = silent
    snapInFlight = true;
    const args = [
      '-loglevel', 'error',
      ...source.split(/\s+/),
      '-frames:v', '10',
      '-vf', `scale=${width}:-2`,
      '-q:v', String(qToQv(quality)),
      '-f', 'image2',
      '-update', '1',
      '-y', framePath,
    ];
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    snapProc = p;
    liveProcs.add(p);
    let err = '';
    p.stderr.on('data', (d) => {
      err += String(d);
    });
    const killer = setTimeout(() => p.kill('SIGKILL'), SNAP_KILL_MS);
    p.on('error', (e) => {
      clearTimeout(killer);
      liveProcs.delete(p);
      if (snapProc === p) snapProc = null;
      snapInFlight = false;
      if (e.code === 'ENOENT') {
        console.log('[cam] ffmpeg not found on PATH — camera disabled.');
        stopped = true;
        if (snapTimer) clearInterval(snapTimer);
        return;
      }
      console.log(`[cam] snap error: ${e.message}`);
    });
    p.on('exit', (code) => {
      clearTimeout(killer);
      liveProcs.delete(p);
      if (snapProc === p) snapProc = null;
      snapInFlight = false;
      if (code === 0) {
        if (snapFailures) console.log('[cam] capture recovered');
        snapFailures = 0;
        return;
      }
      // Camera unplugged / wedged / busy. Keep trying at the cadence — a replugged
      // device comes back with no restart — but don't log every tick forever.
      snapFailures++;
      if (snapFailures === 1 || snapFailures % 60 === 0)
        console.log(`[cam] snap failed (${code})${err ? ` — ${err.trim().split('\n')[0]}` : ''} · device gone or busy? retrying every ${Math.max(cadenceMs, SNAP_MIN_MS)}ms (failure #${snapFailures})`);
    });
  }

  function startSnapping() {
    if (stopped || !powered) return;
    if (snapTimer) clearInterval(snapTimer);
    const every = Math.max(cadenceMs, SNAP_MIN_MS);
    console.log(`[cam] snap mode: ${source} · every ${every}ms · q${quality} · ${width}px (device held only during each snap)`);
    snapTimer = setInterval(snapOnce, every);
    if (snapTimer.unref) snapTimer.unref();
    snapOnce();
  }

  function spawnFfmpeg() {
    // `proc` guard: setPower(on) and a pending exit-respawn timer can both try to start
    // capture — whoever runs second must find it already running, not fork a second ffmpeg.
    if (stopped || !powered || proc) return;
    const args = ffmpegArgs();
    console.log(`[cam] ffmpeg ${source === 'rtmp' ? `listening for OBS at ${rtmpUrl}` : `source=${source}`} · every ${cadenceMs}ms · q${quality} · ${width}px`);
    proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const p = proc; // pin this spawn for its handlers — `proc` moves on at respawn
    liveProcs.add(p);
    p.stderr.on('data', (d) => {
      const line = String(d).trim();
      if (line) console.log(`[cam] ffmpeg: ${line.split('\n')[0]}`);
    });
    p.on('error', (e) => {
      if (e.code === 'ENOENT') {
        console.log('[cam] ffmpeg not found on PATH — camera disabled.');
        stopped = true;
        return;
      }
      console.log(`[cam] ffmpeg error: ${e.message}`);
    });
    p.on('exit', (code) => {
      liveProcs.delete(p);
      if (proc === p) proc = null;
      // Powered off: this exit is the kill we asked for — stay down until setPower(true).
      if (stopped || !powered) return;
      // rtmp: OBS disconnected (or never connected yet). test/device: source ended. Respawn.
      console.log(`[cam] ffmpeg exited (${code}) — restarting in 2s`);
      setTimeout(spawnFfmpeg, 2000);
    });
  }

  // Poll the frame file; when ffmpeg has written a fresh, complete JPEG, capture
  // it and hand it to the node.
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
          if (onFrame) onFrame(latest);
        }
      }
    } catch {
      // no frame yet (ffmpeg still waiting for OBS / warming up) — normal
    }
  }

  // (Re)create the frame poll on a period that tracks the snap cadence — fast enough to catch
  // a sub-second cadence (floored at 250ms), never slower than 1s. Recreated on every
  // setCadence() because a timer fixed at start() would, after cadence is lowered, fire slower
  // than frames are written and skip every other one.
  function startPollTimer() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, Math.max(250, Math.min(cadenceMs, 1000)));
    if (pollTimer.unref) pollTimer.unref();
  }

  return {
    start() {
      if (isDevice) startSnapping();
      else spawnFfmpeg();
      startPollTimer();
    },
    /** Latest complete JPEG (or null if none captured yet). */
    latest() {
      return latest;
    },
    /** Current knobs — the node folds these into its DESCRIBE and GET /camera. */
    config() {
      return { source, width, quality, cadenceMs, powered, hasFrame: !!latest, frameAt: latest?.at ?? null };
    },
    /**
     * Stop or resume capture (the `power` actuator). Off kills ffmpeg and silences the
     * poll: no readings, no frame pushes, no Looks spent. On respawns and capture resumes.
     */
    setPower(on) {
      const v = parseEnabled(on); // shared forgiving parse (hub/wire.mjs); undefined/null = on
      if (v === powered || stopped) return false;
      powered = v;
      console.log(`[cam] capture ${powered ? 'ON — resuming' : 'OFF — stopping capture, holding last frame'}`);
      if (isDevice) {
        // Snap mode: off = stop the interval and abort any in-flight snap (LED dies now);
        // on = re-arm. No persistent process exists either way.
        if (powered) startSnapping();
        else {
          if (snapTimer) clearInterval(snapTimer);
          snapTimer = null;
          if (snapProc) snapProc.kill('SIGKILL');
        }
      } else if (powered) spawnFfmpeg();
      else if (proc) proc.kill('SIGKILL'); // exit handler sees !powered and stays down
      return true;
    },
    /** Retune the snap cadence live. Returns true when it actually changed. */
    setCadence(ms) {
      if (!ms || !Number.isFinite(ms) || ms === cadenceMs) return false;
      cadenceMs = Math.max(500, Math.round(ms));
      console.log(`[cam] cadence → ${cadenceMs}ms${isDevice ? ' (re-arming snap interval)' : ' (restarting capture)'}`);
      startPollTimer(); // re-pace the frame poll to the new cadence so we don't skip frames
      if (isDevice) startSnapping(); // re-arm the interval; no long-lived proc to bounce
      else if (proc) proc.kill('SIGKILL'); // exit handler respawns with the new fps
      return true;
    },
    /** Adjust capture quality live (1..100). Returns true when it actually changed. */
    setQuality(q) {
      const v = Math.max(1, Math.min(100, Math.round(q)));
      if (v === quality) return false;
      quality = v;
      console.log(`[cam] quality → ${quality}`);
      // Snap mode picks the new quality up on the next snap; a streaming ffmpeg has it
      // baked into its args and must be bounced.
      if (!isDevice && proc) proc.kill('SIGKILL');
      return true;
    },
    stop() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (snapTimer) clearInterval(snapTimer);
      if (proc) proc.kill('SIGKILL');
      if (snapProc) snapProc.kill('SIGKILL'); // LED off now, not when the snap finishes
    },
  };
}
