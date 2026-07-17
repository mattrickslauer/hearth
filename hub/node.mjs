#!/usr/bin/env node
/**
 * hub/node.mjs — the Hearth laptop node.
 *
 * A laptop is a node. Run this and the machine joins the mesh EXACTLY like an
 * ESP32: it discovers the hub over mDNS (`_hearth._tcp`), announces a DESCRIBE
 * document for whatever peripherals it actually has, streams READING documents
 * on per-sensor cadences, and converges on the `{cadences, desired}` downlink
 * that rides the reply to its own ingest POST — the same protocol, the same
 * semantics, byte for byte where it matters:
 *
 *   · a desired key that is PRESENT is converged; an ABSENT key leaves the
 *     output alone (firmware main.cpp applyDesired). This is what makes a
 *     LAN-direct "camera off" stick instead of being resurrected by the shadow.
 *   · a cadences field that is present reverts unmentioned sensors to their
 *     defaults (firmware applyCadences); an absent field touches nothing.
 *   · it serves POST /actuate so a hub watch can fire on it instantly, and
 *     re-announces DESCRIBE every 30s like the boards do.
 *
 * Peripherals are probed at startup and self-described — nothing is configured
 * on the hub, ever:
 *
 *   camera     — the machine's real camera (v4l2/avfoundation via ffmpeg), or
 *                OBS over rtmp, or the synthetic test source. One `cam.frame`
 *                vision sensor + a `power` switch actuator. Frames ride the
 *                READING document as `frames` (data URI); the hub stores the
 *                latest and forwards it to the cloud — pixels are still
 *                sampled, never streamed.
 *   battery    — `sys.battery` % (Linux /sys/class/power_supply, macOS pmset)
 *   load       — `sys.load` 1-min load average per core
 *   memory     — `sys.mem` used %
 *
 * The same machine can instead be the hub — that's hub.mjs. And when the hub
 * itself has a camera (HEARTH_CAM=1), it starts THIS code pointed at its own
 * loopback ingest, so the hub's camera is a real node on the same rails, not a
 * special case.
 *
 * Node 18+ (global fetch). Usage:
 *   node node.mjs                        # discover the hub, expose everything found
 *   HUB_ENDPOINT=http://pi:8899 node node.mjs
 *   NODE_PERIPHERALS=battery,load node node.mjs   # opt out of the camera
 *   HEARTH_CAM_SOURCE=test node node.mjs          # synthetic frames, no hardware
 */

import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { cpus, freemem, hostname, loadavg, platform, totalmem } from 'node:os';

import { createCapture, detectCaptureDevice } from './camera.mjs';
import { parseEnabled } from './wire.mjs';

const hhmmss = () => new Date().toISOString().slice(11, 19);

/**
 * A stable per-machine id seed. Node ids are the key for readings, cadence downlinks and
 * stored frames, and nothing upstream makes them unique — ESP nodes only avoid collisions
 * because theirs are MAC-derived. Seeded from /etc/machine-id (hostname if absent) rather
 * than any cloud-assigned id, because the node must keep its identity with no network at all.
 */
function machineHash() {
  let seed;
  try {
    seed = readFileSync('/etc/machine-id', 'utf8').trim();
  } catch {
    seed = hostname();
  }
  return createHash('sha256').update(seed || hostname()).digest('hex').slice(0, 8);
}

// ── peripherals ───────────────────────────────────────────────────────────────
// Each probe returns a sensor {key, kind, label, unit?, defaultMs, read} or null when the
// machine simply doesn't have the hardware — a laptop with no battery describes no battery.

function probeBattery() {
  if (process.platform === 'linux') {
    try {
      const supply = readdirSync('/sys/class/power_supply').find((d) => {
        try {
          return readFileSync(`/sys/class/power_supply/${d}/type`, 'utf8').trim() === 'Battery';
        } catch {
          return false;
        }
      });
      if (!supply) return null;
      const path = `/sys/class/power_supply/${supply}/capacity`;
      readFileSync(path, 'utf8'); // prove it reads before describing it
      return {
        key: 'sys.battery',
        kind: 'battery',
        unit: '%',
        label: 'Battery',
        defaultMs: 60_000,
        read: async () => Number(readFileSync(path, 'utf8').trim()),
      };
    } catch {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    const pmset = () =>
      new Promise((resolve) => {
        execFile('pmset', ['-g', 'batt'], { timeout: 5000 }, (err, stdout) => {
          const m = err ? null : /(\d+)%/.exec(stdout);
          resolve(m ? Number(m[1]) : null);
        });
      });
    return {
      key: 'sys.battery',
      kind: 'battery',
      unit: '%',
      label: 'Battery',
      defaultMs: 60_000,
      read: pmset,
      // Only describe a battery if pmset actually reports one (a Mac mini has none).
      probe: pmset,
    };
  }
  return null;
}

const loadSensor = () => ({
  key: 'sys.load',
  kind: 'load',
  label: 'CPU load',
  defaultMs: 5_000,
  read: async () => Number((loadavg()[0] / Math.max(1, cpus().length)).toFixed(2)),
});

const memSensor = () => ({
  key: 'sys.mem',
  kind: 'memory',
  unit: '%',
  label: 'Memory used',
  defaultMs: 30_000,
  read: async () => Number(((1 - freemem() / totalmem()) * 100).toFixed(1)),
});

// ── hub discovery ─────────────────────────────────────────────────────────────
/**
 * Find the hub's ingest URL: explicit > HUB_ENDPOINT > mDNS browse > localhost.
 * Mirrors the firmware: mDNS when available, a configured endpoint as fallback.
 */
async function discoverHub(explicit, log) {
  const configured = explicit || process.env.HUB_ENDPOINT;
  if (configured) return `${configured.replace(/\/$/, '')}/ingest`;
  try {
    const { Bonjour } = await import('bonjour-service');
    const bonjour = new Bonjour();
    const found = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      bonjour.findOne({ type: 'hearth' }, 5000, (svc) => {
        clearTimeout(timer);
        resolve(svc);
      });
    });
    bonjour.destroy();
    if (found) {
      const addr = (found.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || found.host;
      const path = found.txt?.path || '/ingest';
      const url = `http://${addr}:${found.port}${path}`;
      log(`[node] mDNS discovered hub at ${url}`);
      return url;
    }
    log('[node] no hub advertised on the LAN — falling back to http://localhost:8899');
  } catch {
    log('[node] mDNS unavailable (bonjour-service not installed) — falling back to http://localhost:8899');
  }
  return 'http://localhost:8899/ingest';
}

// ── the node ──────────────────────────────────────────────────────────────────
/**
 * Start a Hearth node. Returns { id, stop() }.
 *
 * @param {{
 *   hubUrl?: string,        // hub base URL (e.g. http://127.0.0.1:8899); default: discover
 *   token?: string,         // hub ingest token (x-hearth-token)
 *   id?: string,            // node id; default node-<machine hash> (cam-<hash> embedded)
 *   port?: number,          // this node's own HTTP server (/actuate, /frame, /camera)
 *   peripherals?: string[], // subset of ['camera','battery','load','mem']; default all
 *   embedded?: boolean,     // running inside hub.mjs (HEARTH_CAM=1): camera-only defaults,
 *                           // rtmp fallback and the legacy cam-<hash> id are preserved
 *   log?: (s:string)=>void,
 * }} opts
 */
export function startNode(opts = {}) {
  const log = opts.log || console.log;
  const embedded = !!opts.embedded;
  const id =
    opts.id ||
    (embedded ? process.env.HEARTH_CAM_ID || `cam-${machineHash()}` : process.env.HEARTH_NODE_ID || `node-${machineHash()}`);
  const PORT = Number(opts.port || process.env.NODE_PORT || 8080);
  const token = opts.token ?? process.env.HUB_INGEST_TOKEN ?? '';
  const wanted = opts.peripherals || (process.env.NODE_PERIPHERALS || 'camera,battery,load,mem').split(',').map((s) => s.trim());
  const ANNOUNCE_MS = 30_000; // re-announce DESCRIBE like the boards do
  const TICK_MS = 500;

  let hubUrl = null; // resolved ingest URL
  let stopped = false;
  let failures = 0; // consecutive delivery failures → re-discover (hub may have moved)
  const usedMdns = !opts.hubUrl && !process.env.HUB_ENDPOINT;

  // — sensors —
  const sensors = []; // {key, kind, label, unit?, defaultMs, ms, lastAt, read}
  if (wanted.includes('battery')) {
    const b = probeBattery();
    if (b) sensors.push({ ...b, ms: b.defaultMs, lastAt: 0 });
  }
  if (wanted.includes('load')) sensors.push({ ...loadSensor(), ms: 5_000, lastAt: 0 });
  if (wanted.includes('mem')) sensors.push({ ...memSensor(), ms: 30_000, lastAt: 0 });
  for (const s of sensors) s.ms = s.defaultMs;

  // — camera —
  // Source resolution: `auto` probes for a real camera (async — pulling one proof frame per
  // candidate device never blocks /actuate serving or an embedding hub's pairing loop).
  // Standalone, a machine with no camera simply doesn't describe one (like a board with no
  // DHT). Embedded, auto falls back to rtmp so `hearthctl camera on` keeps the OBS behaviour
  // on camera-less hubs.
  let capture = null;
  const camDefaultMs = Number(process.env.HEARTH_CAM_CADENCE_MS || 5000);
  async function setupCamera() {
    if (!wanted.includes('camera')) return;
    const requested = process.env.HEARTH_CAM_SOURCE || (embedded ? 'rtmp' : 'auto');
    let source = requested;
    if (requested === 'auto') {
      source = await detectCaptureDevice();
      if (!source && embedded) {
        log('[cam] auto: no local camera found — listening for OBS over rtmp instead');
        source = 'rtmp';
      }
      if (!source) log('[node] no camera on this machine — not describing one');
    }
    if (!source) return;
    capture = createCapture({
      source,
      cadenceMs: camDefaultMs,
      // Every fresh JPEG becomes a READING immediately — the frame IS the reading,
      // so its delivery cadence is the capture cadence, exactly like a sensor.
      onFrame: (f) => {
        void deliver({
          id,
          type: 'hearth.node.reading',
          readings: { 'cam.frame': `q${f.quality} ${f.w}px ${(f.bytes / 1024).toFixed(0)}KB @${hhmmss()}` },
          frames: { 'cam.frame': `data:image/jpeg;base64,${f.buf.toString('base64')}` },
        });
      },
    });
  }

  const describeDoc = () => {
    const doc = {
      id,
      type: 'hearth.node.describe',
      board: embedded ? 'hub/obs-camera' : `laptop/${platform()}`,
      sensors: sensors.map((s) => ({ key: s.key, kind: s.kind, label: s.label, ...(s.unit ? { unit: s.unit } : {}) })),
      actuators: [],
    };
    if (capture) {
      const c = capture.config();
      doc.sensors.push({
        key: 'cam.frame',
        kind: 'camera',
        label: 'Camera',
        vision: true,
        describes: 'a live camera frame, sampled at a cadence for Qwen-VL to read',
        config: { cadenceMs: c.cadenceMs, quality: c.quality, width: c.width },
      });
      // The camera IS commandable hardware: `power` is its capture switch, described as a
      // normal actuator so stop/start rides the existing rails — the dashboard and the
      // `actuate` tool write the device shadow, this node converges, no special case upstream.
      doc.actuators.push({ key: 'power', kind: 'switch', label: 'Capture on/off', port: PORT, path: '/actuate' });
    }
    return doc;
  };

  // — uplink: POST a document, absorb the reply downlink —
  async function deliver(doc) {
    if (stopped || !hubUrl) return false;
    try {
      const res = await fetch(hubUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-hearth-token': token } : {}) },
        body: JSON.stringify(doc),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        log(`[node] hub rejected ${doc.type} (${res.status}): ${data.error || 'unknown'}`);
        return false;
      }
      failures = 0;
      applyReply(data);
      return true;
    } catch (e) {
      failures += 1;
      if (failures === 1 || failures % 10 === 0) log(`[node] hub unreachable (${e.message}) — will keep trying`);
      // The hub may have moved (new IP after DHCP, restarted elsewhere). If we found it via
      // mDNS, go look again — the firmware does the same in its loop's rediscovery block.
      if (usedMdns && failures >= 5) {
        failures = 0;
        void discoverHub(null, log).then((url) => {
          if (!stopped) hubUrl = url;
        });
      }
      return false;
    }
  }

  /**
   * The reply downlink — firmware semantics exactly:
   *   cadences present → mentioned sensors retune, unmentioned revert to default.
   *   desired present  → mentioned actuators converge; an omitted key is left alone.
   */
  function applyReply(data) {
    if (data && typeof data.cadences === 'object' && data.cadences !== null) {
      for (const s of sensors) {
        const next = data.cadences[s.key];
        const ms = typeof next === 'number' && Number.isFinite(next) && next > 0 ? Math.round(next) : s.defaultMs;
        if (ms !== s.ms) {
          log(`[node] cadence ${s.key} ${s.ms} → ${ms}ms (set from dashboard)`);
          s.ms = ms;
        }
      }
      if (capture) {
        const next = data.cadences['cam.frame'];
        const ms = typeof next === 'number' && Number.isFinite(next) && next > 0 ? Math.round(next) : camDefaultMs;
        if (capture.setCadence(ms)) void deliver(describeDoc()); // config changed → re-describe
      }
    }
    if (data && typeof data.desired === 'object' && data.desired !== null) {
      if (capture && 'power' in data.desired) {
        const on = parseEnabled(data.desired.power);
        if (capture.setPower(on)) log(`[desired] cloud → power ${on ? 'on' : 'off'}`);
      }
    }
  }

  // — the node's own server: instant LAN actuation + frame/config for the hub to proxy —
  const server = http.createServer((req, res) => {
    const json = (code, body, extra = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...extra });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }
    // POST /actuate {actuator, value} — what a hub watch fires, instantly over the LAN.
    if (req.method === 'POST' && req.url === '/actuate') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 4096) req.destroy();
      });
      req.on('end', () => {
        let cmd = {};
        try {
          cmd = JSON.parse(body || '{}');
        } catch {}
        if (cmd.actuator === 'power' && capture) {
          const on = parseEnabled(cmd.value);
          capture.setPower(on);
          log(`[actuate] power -> ${on ? 'ON' : 'OFF'}`);
          json(200, { ok: true, power: on ? 'on' : 'off' });
        } else {
          json(404, { ok: false, error: `unknown actuator "${cmd.actuator}"` });
        }
      });
      return;
    }
    // GET /frame — the latest sampled JPEG, pulled on demand (never streamed).
    if (req.method === 'GET' && (req.url === '/frame' || req.url?.startsWith('/frame?'))) {
      const f = capture?.latest();
      if (!f) return json(503, { error: 'no frame yet' });
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': f.bytes,
        'cache-control': 'no-store',
        'x-frame-at': String(f.at),
        'access-control-allow-origin': '*',
      });
      res.end(f.buf);
      return;
    }
    // GET/POST /camera — knobs. The hub proxies its own /camera endpoint here, so the
    // dashboard keeps talking to the hub while the camera lives on whichever node has one.
    if (req.url === '/camera') {
      if (!capture) return json(404, { error: 'camera disabled' });
      const respond = () => {
        const c = capture.config();
        json(200, {
          id,
          source: c.source,
          width: c.width,
          quality: c.quality,
          cadenceMs: c.cadenceMs,
          enabled: c.powered,
          hasFrame: c.hasFrame,
          frameAt: c.frameAt,
        });
      };
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 4096) req.destroy();
        });
        req.on('end', () => {
          let cfg = {};
          try {
            cfg = JSON.parse(body || '{}');
          } catch {}
          let changed = false;
          if (cfg.quality != null) changed = capture.setQuality(Number(cfg.quality)) || changed;
          if (cfg.cadenceMs != null) changed = capture.setCadence(Number(cfg.cadenceMs)) || changed;
          if (cfg.enabled != null) capture.setPower(parseEnabled(cfg.enabled));
          if (changed) void deliver(describeDoc());
          respond();
        });
        return;
      }
      if (req.method !== 'GET') return json(405, { error: 'method not allowed' });
      respond();
      return;
    }
    json(404, { error: 'not found' });
  });

  // — main loop —
  let tickTimer = null;
  let announceTimer = null;

  async function tick() {
    const now = Date.now();
    const due = sensors.filter((s) => now - s.lastAt >= s.ms);
    if (!due.length) return;
    const readings = {};
    for (const s of due) {
      s.lastAt = now;
      try {
        const v = await s.read();
        if (v != null && Number.isFinite(v)) readings[s.key] = v;
      } catch {
        /* a sensor that fails to read this tick just stays silent */
      }
    }
    if (Object.keys(readings).length) await deliver({ id, type: 'hearth.node.reading', readings });
  }

  (async () => {
    // A darwin battery probe is async — resolve it before the first DESCRIBE so a
    // battery-less Mac doesn't describe a battery it can't read. Same for the camera:
    // its device probe is async, and the first DESCRIBE must reflect what's real.
    for (let i = sensors.length - 1; i >= 0; i--) {
      if (sensors[i].probe && (await sensors[i].probe()) == null) sensors.splice(i, 1);
    }
    await setupCamera();
    hubUrl = await discoverHub(opts.hubUrl, log);
    await new Promise((resolve) => server.listen(PORT, '0.0.0.0', resolve));
    log(`[node] ${id} → hub ${hubUrl}`);
    log(`[node] serving :${PORT} (POST /actuate${capture ? ', GET /frame, GET|POST /camera' : ''})`);
    await deliver(describeDoc());
    if (capture) capture.start();
    const doc = describeDoc();
    log(
      `[node] describing: ${doc.sensors.map((s) => s.key).join(', ') || '(no sensors)'}` +
        (doc.actuators.length ? ` · can do: ${doc.actuators.map((a) => a.key).join(', ')}` : ''),
    );
    tickTimer = setInterval(tick, TICK_MS);
    announceTimer = setInterval(() => void deliver(describeDoc()), ANNOUNCE_MS);
    if (tickTimer.unref) tickTimer.unref();
    if (announceTimer.unref) announceTimer.unref();
  })().catch((e) => log(`[node] fatal: ${e.message}`));

  return {
    id,
    stop() {
      stopped = true;
      if (tickTimer) clearInterval(tickTimer);
      if (announceTimer) clearInterval(announceTimer);
      if (capture) capture.stop();
      server.close();
    },
  };
}

// CLI: `node node.mjs` — a laptop joining the mesh as a simple node.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const node = startNode({});
  const shutdown = () => {
    console.log('\n[node] shutting down…');
    node.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
