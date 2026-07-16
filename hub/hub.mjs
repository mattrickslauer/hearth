#!/usr/bin/env node
/**
 * Hearth hub — the complete edge agent, one process.
 *
 * This is what a Hearth user runs on their always-on machine (a Pi, a spare laptop,
 * a mini PC). It does BOTH halves of the hub in a single process, so there is no
 * shared-file handoff to desync:
 *
 *   UP to the cloud   — pairs with your Hearth account (enroll → claim code → token)
 *                       and heartbeats so the dashboard shows the hub Online.
 *   DOWN to the LAN   — advertises itself over mDNS as `_hearth._tcp` so ESP32 nodes
 *                       discover it with zero config, ingests their DESCRIBE + READING
 *                       documents, and syncs that live registry up to the cloud.
 *
 * The hub token minted by pairing is held IN MEMORY and used directly by the device
 * sync — the earlier two-process design passed it through ~/.hearth/hub-state.json,
 * which desynced whenever the file/mount changed underneath the reader. One process,
 * one token, no race.
 *
 * Identity (enroll token + hub id + hub token) still persists to hub-state.json so the
 * hub keeps its identity across restarts; a restart re-reads it and does NOT re-enroll.
 *
 * mDNS needs the optional `bonjour-service` package. If it isn't installed the hub still
 * pairs, ingests, and syncs — nodes just have to be pointed at it via HUB_ENDPOINT
 * instead of discovering it automatically.
 *
 * Node 18+ (global fetch). Usage:
 *   node hub.mjs                      # pair with Hearth Cloud + serve the LAN
 *   HUB_NAME="Kitchen Pi" node hub.mjs
 *   BACKEND_URL=http://localhost:9000 node hub.mjs   # local backend (dev)
 *   node hub.mjs --reset              # forget identity and enroll fresh
 */

import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, hostname, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { attachWebSocket } from './ws.mjs';

import { createRuntime } from './runtime.mjs';
import { setCloudNotifier } from './notify.mjs';
import { createCamera } from './camera.mjs';

// ── config ──────────────────────────────────────────────────────────────────
const DEFAULT_BACKEND = 'https://hearth-mcp-gqfuhlkzpo.ap-southeast-1.fcapp.run';
const BACKEND_URL = (process.env.BACKEND_URL || DEFAULT_BACKEND).replace(/\/$/, '');
const HUB_NAME = process.env.HUB_NAME || hostname() || 'Hearth hub';
const FW = process.env.HUB_FW || 'hearth-hub/0.2.0';
const STATE_DIR = process.env.HEARTH_HOME || join(homedir(), '.hearth');
const STATE_FILE = process.env.HUB_STATE_FILE || join(STATE_DIR, 'hub-state.json');
// The installer surfaces the claim code from here; we write it on enroll, clear it on claim.
const CLAIM_FILE = process.env.HUB_CLAIM_FILE || join(STATE_DIR, 'claim-code.txt');
const PORT = Number(process.env.HUB_PORT || 8899);
// Which interface the LAN server binds. Defaults to 0.0.0.0 (nodes/dashboard live on
// other LAN hosts, so loopback-only would break them); set HUB_BIND to a specific
// interface to narrow exposure.
const BIND = process.env.HUB_BIND || '0.0.0.0';
// Optional shared secret. When set, /ingest, /nodes and the /live WS require it
// (header `x-hearth-token` or `?token=`), closing the unauthenticated LAN surface.
// Unset = open (backward compatible with nodes that don't present a token).
const INGEST_TOKEN = process.env.HUB_INGEST_TOKEN || '';
const SERVICE_TYPE = 'hearth'; // advertised as _hearth._tcp.local
const INGEST_PATH = '/ingest';

// Constant-time credential check. In open mode (no token configured) everything passes.
const constEq = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};
function tokenOk(req) {
  if (!INGEST_TOKEN) return true;
  const url = new URL(req.url || '/', 'http://localhost');
  const provided = req.headers['x-hearth-token'] || url.searchParams.get('token') || '';
  return constEq(provided, INGEST_TOKEN);
}
const POLL_MS = 3000;
const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 60_000; // ceiling for exponential backoff on transient/rejected calls
const SYNC_MS = Number(process.env.HUB_SYNC_MS || 15000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = () => new Date().toISOString();

// ── identity persistence ──────────────────────────────────────────────────────
function loadState() {
  if (process.argv.includes('--reset')) return {};
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
      /* corrupt → fresh */
    }
  }
  return {};
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();
// The live credential, held in memory. Persisted copy is only for surviving restarts.
let hubToken = state.hubToken || null;
let accountId = state.accountId || null;

// ── node registry (LAN side) ──────────────────────────────────────────────────
const nodes = new Map();
// Desired per-sensor sample cadence in ms (input id "<node>.<key>" → ms), learned from the
// cloud on each device sync. We hand each node its own sensors' cadences in the HTTP response
// to its next ingest POST — the node polls us by POSTing, so its POST is the downlink carrier
// (no node server). Keyed by full input id upstream; handed to the node keyed by bare sensor key.
const desiredCadence = new Map();

// The cadences for one node, keyed by bare sensor key (strip the "<node>." prefix) — this is
// exactly what the node needs to retune its own per-sensor timers. Empty = no overrides.
function cadencesForNode(nodeId) {
  const prefix = `${nodeId}.`;
  const out = {};
  for (const [input, ms] of desiredCadence) {
    if (input.startsWith(prefix)) out[input.slice(prefix.length)] = ms;
  }
  return out;
}

// Desired actuator state (input id "<node>.<key>" → on/off), learned from the cloud on each
// device sync — the "desired" half of the device shadow. Same downlink carrier as cadences:
// we hand each node its own actuators' desired states in the reply to its next ingest POST,
// and the node converges its output to match. Keyed by full input id; handed to the node by key.
const desiredState = new Map();

// Replace our view of desired actuator states with the cloud's latest (input id → bool).
function applyDesired(desired) {
  if (!desired || typeof desired !== 'object') return;
  desiredState.clear();
  for (const [input, on] of Object.entries(desired)) desiredState.set(input, !!on);
}

// The desired actuator states for one node, keyed by bare actuator key ("on"/"off" strings the
// node's forgiving parser understands). Empty = the cloud has commanded nothing for this node,
// so the node leaves its output to whatever a local watch set.
function desiredForNode(nodeId) {
  const prefix = `${nodeId}.`;
  const out = {};
  for (const [input, on] of desiredState) {
    if (input.startsWith(prefix)) out[input.slice(prefix.length)] = on ? 'on' : 'off';
  }
  return out;
}
// LAN realtime channel (browser dashboards on the same network). Set in main() once the
// HTTP server exists; guarded everywhere so ingest works whether or not anyone's watching.
let live = null;

// Optional camera sensor (HEARTH_CAM=1). A camera is just another node to the registry;
// this handle only exists so GET /frame can serve its latest JPEG and the cloud can retune
// its snap cadence. Null when disabled — every use is guarded.
let camera = null;

// Bring the camera up. Idempotent — shared by boot (HEARTH_CAM=1) and a live
// POST /camera {enabled:true}, so attaching a camera never requires a hub restart.
function startCamera(sourceOverride) {
  if (camera) return;
  // Push each snapped frame up to the cloud (→ OSS) so any dashboard, on any network, and the
  // Qwen-VL judge pull it by presigned URL — the scalable path, no per-hub URL to hardcode.
  // No-op until paired (the LAN GET /frame still serves it); errors are logged, never fatal.
  const pushFrame = async (input, dataUri) => {
    if (!hubToken) return;
    try {
      const { ok, status, data } = await api('/hub/frame', { input, image: dataUri }, hubToken);
      if (!ok) console.log(`[cam→cloud] frame push rejected ${status}: ${data.error || 'unknown'}`);
    } catch (e) {
      console.log(`[cam→cloud] frame push failed: ${e.message}`);
    }
  };
  camera = createCamera({ ingest, onFrame: pushFrame, source: sourceOverride });
  camera.start();
  console.log(`[hub] camera enabled — frames pushed to cloud + served locally at GET http://<hub>:${PORT}/frame`);
}

// Tear the camera down. Idempotent. Kills the capture process immediately (the webcam LED
// goes dark now, not at the next restart) and drops the node from the registry, so the next
// cloud sync stops listing it instead of leaving a ghost sensor.
function stopCamera() {
  if (!camera) return;
  camera.stop();
  nodes.delete(camera.id);
  camera = null;
  scheduleSync();
  console.log('[hub] camera disabled — capture stopped, node dropped from the registry');
}

// The watch runtime: evaluates compiled watches against live node readings and fires
// (actuate a node + push a phone notification) on a rising edge. It shares the `nodes`
// registry so it can resolve a node's address to send actuator commands back to it.
const runtime = createRuntime({ nodes });

// Node hands back IPv4-mapped IPv6 for LAN peers (::ffff:192.168.x.y) — strip it.
const cleanAddr = (a) => (typeof a === 'string' ? a.replace(/^::ffff:/, '') : a);

// Bound the registry so a flood of distinct node IDs can't grow it (and every
// /hub/devices payload) without limit. Re-inserting keeps the Map in LRU order;
// past the cap we evict the least-recently-seen node. Far above any real home.
const MAX_NODES = Number(process.env.HUB_MAX_NODES || 1000);
function admit(id, entry) {
  nodes.delete(id); // move-to-end so recency == Map order
  nodes.set(id, entry);
  if (nodes.size > MAX_NODES) {
    const oldest = nodes.keys().next().value;
    if (oldest !== undefined && oldest !== id) nodes.delete(oldest);
  }
}

// Fold a node's document into the registry. DESCRIBE registers identity + capabilities;
// READING updates the latest values. Either way we learn the node exists — no node is
// ever configured on the hub by hand. `addr` is the node's source IP (for actuation).
function ingest(doc, addr) {
  const id = doc && doc.id;
  if (!id) return false;
  const entry = nodes.get(id) || { id, describe: null, lastReading: null, readingCount: 0, firstSeen: iso() };
  entry.lastSeen = iso();
  if (addr) entry.addr = cleanAddr(addr); // remember where to send actuator commands

  if (doc.type === 'hearth.node.describe') {
    const known = entry.describe != null;
    entry.describe = doc;
    const sensors = (doc.sensors || []).map((s) => s.key).join(', ');
    const acts = (doc.actuators || []).map((a) => a.key).join(', ');
    console.log(`[hub] ${known ? 're-announce' : '+ NEW NODE'} ${id} (${doc.board || '?'}) can sense: ${sensors}${acts ? ` · can do: ${acts}` : ''}`);
    if (!known) queueMicrotask(syncToCloud); // push a newly-discovered node up promptly
    // Tell live dashboards a (possibly new) node exists so its sensor tiles appear at once.
    if (live) live.broadcast({ type: 'describe', node: id, at: Date.now(), describe: doc });
  } else if (doc.type === 'hearth.node.reading') {
    // Merge, don't replace: with per-sensor cadence a reading doc may carry only the sensors
    // that were due, so keep the last value of the others in our snapshot.
    entry.lastReading = { ...(entry.lastReading || {}), ...(doc.readings || {}) };
    entry.readingCount += 1;
    console.log(`[hub] ${id} reading #${entry.readingCount}: ${JSON.stringify(doc.readings)}`);
    // Fan the reading out to LAN dashboards the instant it lands — the direct realtime path.
    if (live) live.broadcast({ type: 'reading', node: id, at: Date.now(), readings: doc.readings || {} });
    // And nudge a cloud sync so remote (cloud-brokered) dashboards update promptly too,
    // coalescing bursts instead of waiting out the 15s timer.
    scheduleSync();
    admit(id, entry); // ensure the registry has this node before the runtime resolves its address
    runtime.onReading(doc); // feed the engine + fire watches on this fresh reading
    return true;
  } else {
    return false;
  }

  admit(id, entry);
  return true;
}

// The fastest cadence any sensor is currently set to (ms), or 0 when none is set. Used to
// pace cloud syncs with the fastest sensor so a 500ms sensor isn't capped by a 1s debounce.
let fastestCadenceMs = 0;

// Replace our view of desired cadences with the cloud's latest (input id → ms). Inputs the
// account hasn't set a cadence for simply won't appear — we send them no override.
function applyCadences(cadences) {
  if (!cadences || typeof cadences !== 'object') return;
  desiredCadence.clear();
  let fastest = Infinity;
  for (const [input, ms] of Object.entries(cadences)) {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
      const v = Math.round(ms);
      desiredCadence.set(input, v);
      if (v < fastest) fastest = v;
    }
  }
  fastestCadenceMs = Number.isFinite(fastest) ? fastest : 0;
  // The camera is just another sensor: if the account set a cadence for its frame input,
  // retune the snap rate through the very same downlink the ESP nodes use.
  if (camera) camera.setCadence(desiredCadence.get(`${camera.id}.cam.frame`));
}

// Cap the ingest body — /ingest is unauthenticated and LAN-facing, so an
// unbounded string concat here is a trivial OOM vector. 256 KB is far above
// any real DESCRIBE/READING document.
const MAX_BODY_BYTES = 256 * 1024;
function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    let bytes = 0;
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        resolve(null);
        return;
      }
      data += c;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

// ── cloud calls ───────────────────────────────────────────────────────────────
async function api(path, body, token, timeoutMs) {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      // Callers that sit in front of a time-critical fallback pass a bound; the rest keep
      // the default (the pairing/heartbeat loops back off on their own).
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    // Network error (DNS blip, backend down, TLS reset) → surface as a non-ok result with
    // status 0 instead of rejecting, so the pairing/heartbeat loops back off, not crash.
    return { ok: false, status: 0, data: { error: e.message || 'network error' } };
  }
}

// Route fired-watch notifications through Hearth Cloud, which delivers to the channels this
// account saved in the dashboard (Telegram / email). Reads `hubToken` at call time, so this
// starts working the moment we pair and stops if we're unpaired — no re-registration needed.
// Bounded: a backend that accepts the connection then hangs must not hold a fire's notification
// open for undici's multi-minute default while the local channels wait behind it.
const NOTIFY_TIMEOUT_MS = Number(process.env.HUB_NOTIFY_TIMEOUT_MS || 8000);
setCloudNotifier(
  async (title, message, meta = {}) => {
    if (!hubToken) return null;
    const { ok, data } = await api(
      '/hub/notify',
      { title, message, questionId: meta.questionId },
      hubToken,
      NOTIFY_TIMEOUT_MS,
    );
    return ok ? data : null;
  },
  { ready: () => Boolean(hubToken) },
);

// Coalesce reading bursts into at most one cloud sync per debounce window, so remote
// dashboards get near-realtime updates without a POST per reading. The window ADAPTS to the
// fastest set cadence: with a 500ms sensor we forward ~twice a second instead of once, so
// sub-second cadence actually reaches the cloud-brokered dashboard. Floored so we never
// hammer the backend faster than the fastest sensor could possibly produce fresh data.
const SYNC_DEBOUNCE_MS = Number(process.env.HUB_SYNC_DEBOUNCE_MS || 1000);
const SYNC_DEBOUNCE_MIN_MS = Number(process.env.HUB_SYNC_DEBOUNCE_MIN_MS || 250);
let syncDebounce = null;
function debounceMs() {
  // No cadence set → keep the gentle 1s default. Otherwise track the fastest sensor,
  // clamped to [MIN, default] so we neither hammer the backend nor slow a fast sensor down.
  if (!fastestCadenceMs) return SYNC_DEBOUNCE_MS;
  return Math.max(SYNC_DEBOUNCE_MIN_MS, Math.min(SYNC_DEBOUNCE_MS, fastestCadenceMs));
}
function scheduleSync() {
  if (syncDebounce) return;
  syncDebounce = setTimeout(() => {
    syncDebounce = null;
    syncToCloud();
  }, debounceMs());
  if (syncDebounce.unref) syncDebounce.unref();
}

let syncing = false;

/**
 * The registry as the cloud should see it, with each node's silence measured here.
 *
 * The registry keeps a node forever once seen, so every sync re-sends the last reading of a node
 * that may have died hours ago. The cloud can't date that from our `lastSeen` — it's an ISO string
 * off this box's clock, and subtracting it from the cloud's own now() inherits whatever skew we
 * have. `ageMs` is a duration measured entirely on one clock, so it survives the trip: the cloud
 * uses it to date the reading and to tell a live node from a quiet one.
 */
function nodesForSync() {
  const now = Date.now();
  return [...nodes.values()].map((n) => {
    const seenAt = n.lastSeen ? Date.parse(n.lastSeen) : NaN;
    return { ...n, ageMs: Number.isFinite(seenAt) ? Math.max(0, now - seenAt) : null };
  });
}

// Push the current registry to Hearth Cloud, authenticated with the in-memory hub token.
// No-op (LAN ingest keeps working) until paired. Serialized so a slow sync can't overlap.
async function syncToCloud() {
  if (syncing || nodes.size === 0 || !hubToken) return;
  syncing = true;
  try {
    const { ok, status, data } = await api('/hub/devices', { platform: platform(), nodes: nodesForSync() }, hubToken);
    if (ok) {
      console.log(`[hub→cloud] synced ${data.nodes ?? '?'} node(s), ${data.readings ?? 0} reading(s)`);
      // A node id another hub on this account already owns is refused rather than merged (merging
      // interleaved two devices into one series). Say so here — otherwise it's a device the user
      // installed, sees on this hub, and cannot find in the dashboard.
      if (Array.isArray(data.conflicts) && data.conflicts.length) {
        console.log(
          `[hub→cloud] REFUSED ${data.conflicts.length} node(s) — another hub already owns: ${data.conflicts.join(', ')}\n` +
            `            Give them unique ids (for the camera: HEARTH_CAM_ID=<something-unique>).`,
        );
      }
      // Absorb the account's desired per-node cadences + actuator states; each node picks
      // them up on its next ingest POST.
      applyCadences(data.cadences);
      applyDesired(data.desired);
      // …and the account's authored watches. This is the "describe it in the app → it runs
      // on my hardware" link: the sync is debounced onto live readings, so a watch you just
      // authored starts running here about a second later. Same downlink as the shadow —
      // the hub pulls, so no inbound port and an outage just delays it.
      runtime.setWatches(data.watches);
    } else if (status === 401 || status === 403) {
      // Token invalid or hub unpaired → drop it and re-pair. Re-enroll surfaces a fresh code.
      console.log(`[hub→cloud] rejected ${status}: ${data.error || 'unpaired'} — re-pairing.`);
      hubToken = null;
      accountId = null;
      delete state.hubToken;
      delete state.accountId;
      saveState(state);
    } else {
      console.log(`[hub→cloud] rejected ${status}: ${data.error || 'unknown'}`);
    }
  } catch (e) {
    console.log(`[hub→cloud] failed: ${e.message}`);
  } finally {
    syncing = false;
  }
}

// ── pairing (cloud side) ──────────────────────────────────────────────────────
function showClaim(code, hubId) {
  // Persist for the installer to surface, and print for anyone watching the logs.
  try {
    mkdirSync(dirname(CLAIM_FILE), { recursive: true });
    writeFileSync(CLAIM_FILE, `${code}\n`);
  } catch {
    /* non-fatal */
  }
  console.log('\n  ┌─────────────────────────────────────────────┐');
  console.log('  │  Enter this code in the dashboard to pair:    │');
  console.log('  │                                               │');
  console.log(`  │            >>>   ${code}   <<<            │`);
  console.log('  │                                               │');
  console.log('  └─────────────────────────────────────────────┘\n');
  console.log('  Open your Hearth dashboard → "Connect a hub" and enter the code above.');
  console.log(`  (code expires in ~15 min; hub id ${hubId})\n`);
}

function clearClaim() {
  try {
    rmSync(CLAIM_FILE, { force: true });
  } catch {
    /* non-fatal */
  }
}

async function enroll() {
  state.enrollToken = state.enrollToken || randomBytes(32).toString('hex');
  const { ok, status, data } = await api('/hub/enroll', { enrollToken: state.enrollToken, name: HUB_NAME, fw: FW });
  if (!ok) {
    // Transient (network) or rate-limited (429) — log and let the caller back off/retry
    // rather than throw, which would bubble to main() and kill the process.
    console.log(`  enroll failed (${status || 'network'}): ${data.error || 'unknown'} — will retry.`);
    return false;
  }
  state.hubId = data.hubId;
  saveState(state);
  showClaim(data.claimCode, data.hubId);
  return true;
}

async function waitForClaim() {
  console.log('  Waiting to be claimed…');
  let backoff = POLL_MS;
  for (;;) {
    const { ok, status, data } = await api('/hub/poll', { hubId: state.hubId, enrollToken: state.enrollToken });
    if (ok && data.status === 'claimed' && data.hubToken) {
      hubToken = data.hubToken;
      accountId = data.accountId;
      state.hubToken = hubToken;
      state.accountId = accountId;
      saveState(state);
      clearClaim();
      console.log(`\n  ✓ Paired to account ${accountId}. Serving the LAN and syncing devices.\n`);
      return;
    }
    if (ok) {
      // Valid response, just not claimed yet → keep the steady poll cadence.
      backoff = POLL_MS;
    } else if (status === 0) {
      // Network blip — do NOT wipe identity or re-enroll; just back off and retry the poll.
      console.log(`  Poll unreachable (${data.error || 'network'}) — retry in ${Math.round(backoff / 1000)}s.`);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    } else {
      // Real rejection (401) → our enrollment identity is stale; enroll fresh. Back off so a
      // persistent backend-side rejection can't become a 3s re-enroll flood across a fleet.
      console.log(`  Poll rejected (${status}: ${data.error || 'unknown'}) — re-enrolling.`);
      state.enrollToken = null;
      state.hubId = null;
      await enroll();
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
    await sleep(backoff);
  }
}

async function heartbeatLoop() {
  for (;;) {
    if (hubToken) {
      const { ok, status, data } = await api('/hub/heartbeat', { fw: FW }, hubToken);
      if (ok) {
        console.log(`  ♥ heartbeat ok  ${iso()}`);
      } else if (status === 401 || status === 403) {
        console.log(`  heartbeat rejected (${data.error || 'unpaired'}) — re-pairing.\n`);
        hubToken = null;
        accountId = null;
        delete state.hubToken;
        delete state.accountId;
        saveState(state);
      } else {
        console.log(`  heartbeat error ${status}: ${data.error || 'unknown'}`);
      }
    } else {
      // Lost/never had a token → (re)enroll and wait for the user to claim.
      if (!state.hubId || !state.enrollToken) await enroll();
      await waitForClaim();
      continue; // heartbeat immediately after claiming
    }
    await sleep(HEARTBEAT_MS);
  }
}

// ── LAN server + mDNS ─────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // A LAN dashboard (Expo web on another origin) reads /frame and controls the camera, so
  // answer the CORS preflight BEFORE the auth gate — browser preflights carry no token.
  // Frames are LAN-only.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-hearth-token',
      'access-control-max-age': '86400',
    });
    res.end();
    return;
  }
  if (!tokenOk(req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  if (req.method === 'GET' && (req.url === '/nodes' || req.url === '/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([...nodes.values()], null, 2));
    return;
  }
  // The camera's latest snapped frame, pulled on demand (never streamed). This is
  // what the dashboard tile and the Qwen-VL judge fetch — the pixels stay on the hub
  // until something actually asks for a frame.
  if (req.method === 'GET' && (req.url === '/frame' || req.url?.startsWith('/frame?'))) {
    const f = camera?.getFrame();
    if (!f) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'no frame yet' }));
      return;
    }
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
  // Camera config: GET seeds the dashboard's sliders; POST retunes quality/cadence live
  // (LAN-direct control, complements the cloud cadence downlink). POST {enabled:true|false}
  // attaches/detaches the camera on the running hub — how `hearthctl camera on|off` avoids
  // bouncing the whole service (and every node registration with it) to toggle one sensor.
  if (req.url === '/camera') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    // Read the body once — the stream can't be consumed twice.
    const body = req.method === 'POST' ? (await readJson(req)) || {} : {};
    if (body.enabled === false) {
      stopCamera();
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, enabled: false }));
      return;
    }
    if (body.enabled === true) startCamera(typeof body.source === 'string' && body.source ? body.source : undefined);
    if (!camera) {
      res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ error: 'camera disabled' }));
      return;
    }
    if (body.quality != null) camera.setQuality(Number(body.quality));
    if (body.cadenceMs != null) camera.setCadence(Number(body.cadenceMs));
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(camera.config()));
    return;
  }
  if (req.method === 'POST' && req.url === INGEST_PATH) {
    const doc = await readJson(req);
    const ok = ingest(doc, req.socket?.remoteAddress);
    // Downlink: hand this node the per-sensor cadences AND desired actuator states the account
    // set for its inputs (keyed by bare key). Always present (possibly {}) so the node can tell
    // "cleared" from "unspoken" and revert cleared sensors to their default.
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        ok && doc && doc.id ? { ok, cadences: cadencesForNode(doc.id), desired: desiredForNode(doc.id) } : { ok },
      ),
    );
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// mDNS is optional — the hub is fully functional without it (nodes use HUB_ENDPOINT).
async function startMdns() {
  try {
    const { Bonjour } = await import('bonjour-service');
    const bonjour = new Bonjour();
    const service = bonjour.publish({ name: 'Hearth Hub', type: SERVICE_TYPE, port: PORT, txt: { path: INGEST_PATH, v: '1' } });
    service.on('up', () => console.log(`[hub] advertising _${SERVICE_TYPE}._tcp on the LAN — nodes can now discover me`));
    return bonjour;
  } catch {
    console.log('[hub] mDNS unavailable (bonjour-service not installed) — nodes must be pointed at me via HUB_ENDPOINT');
    return null;
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[hearth-hub] backend ${BACKEND_URL}  name "${HUB_NAME}"  state ${STATE_DIR}`);

  await new Promise((resolve) => server.listen(PORT, BIND, resolve));
  // Realtime LAN channel: a browser on the same network subscribes at ws://<hub>:PORT/live
  // and gets a snapshot of the current registry, then a live push on every reading.
  live = attachWebSocket(server, {
    path: '/live',
    authorize: tokenOk, // shares the ingest token; browser passes it as ?token=
    onConnect: (send) => send({ type: 'snapshot', at: Date.now(), nodes: [...nodes.values()] }),
  });
  console.log(`[hub] ingest listening on ${BIND}:${PORT} (POST ${INGEST_PATH}, GET /nodes, WS /live)`);
  if (!INGEST_TOKEN)
    console.log('[hub] WARNING: HUB_INGEST_TOKEN unset — /ingest, /nodes and /live are open to the LAN. Set it to require a token.');
  const bonjour = await startMdns();

  // Optional camera sensor. Enabled with HEARTH_CAM=1 — it registers itself as a node via the
  // same ingest path, so it flows to the registry, /live, and the cloud like any ESP node.
  // Can also be attached/detached live via POST /camera {enabled} — no restart needed.
  if (process.env.HEARTH_CAM === '1') startCamera();

  if (hubToken) console.log(`  Already paired (hub ${state.hubId}, account ${accountId}). Heartbeating + syncing.\n`);

  // Device sync runs on its own timer regardless of pairing state (no-op until paired).
  const syncTimer = setInterval(syncToCloud, SYNC_MS);

  // Watch runtime: evaluate compiled watches against live readings and fire
  // (actuate + notify) on a rising edge; also ticks for time-based predicates.
  runtime.start();

  const shutdown = () => {
    console.log('\n[hub] shutting down…');
    clearInterval(syncTimer);
    if (syncDebounce) clearTimeout(syncDebounce);
    if (camera) camera.stop();
    if (live) live.close();
    if (bonjour) bonjour.unpublishAll(() => bonjour.destroy());
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Pairing + heartbeat loop owns the token; the sync timer just reads it.
  await heartbeatLoop();
}

main().catch((e) => {
  console.error(`[hearth-hub] fatal: ${e.message}`);
  process.exit(1);
});
