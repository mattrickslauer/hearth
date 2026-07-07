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
// LAN realtime channel (browser dashboards on the same network). Set in main() once the
// HTTP server exists; guarded everywhere so ingest works whether or not anyone's watching.
let live = null;

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
async function api(path, body, token) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

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
// Push the current registry to Hearth Cloud, authenticated with the in-memory hub token.
// No-op (LAN ingest keeps working) until paired. Serialized so a slow sync can't overlap.
async function syncToCloud() {
  if (syncing || nodes.size === 0 || !hubToken) return;
  syncing = true;
  try {
    const { ok, status, data } = await api('/hub/devices', { platform: platform(), nodes: [...nodes.values()] }, hubToken);
    if (ok) {
      console.log(`[hub→cloud] synced ${data.nodes ?? '?'} node(s), ${data.readings ?? 0} reading(s)`);
      // Absorb the account's desired per-node cadences; each node picks its up on next ingest.
      applyCadences(data.cadences);
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
  const { ok, data } = await api('/hub/enroll', { enrollToken: state.enrollToken, name: HUB_NAME, fw: FW });
  if (!ok) throw new Error(`enroll failed: ${data.error || 'unknown error'}`);
  state.hubId = data.hubId;
  saveState(state);
  showClaim(data.claimCode, data.hubId);
}

async function waitForClaim() {
  console.log('  Waiting to be claimed…');
  for (;;) {
    const { ok, data } = await api('/hub/poll', { hubId: state.hubId, enrollToken: state.enrollToken });
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
    if (!ok) {
      // enrollment token rejected → our identity is stale; enroll fresh.
      console.log(`  Poll rejected (${data.error || 'unknown'}) — re-enrolling.`);
      state.enrollToken = null;
      state.hubId = null;
      await enroll();
    }
    await sleep(POLL_MS);
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
  if (req.method === 'POST' && req.url === INGEST_PATH) {
    const doc = await readJson(req);
    const ok = ingest(doc, req.socket?.remoteAddress);
    // Downlink: hand this node the per-sensor cadences the account set for its inputs (keyed
    // by bare sensor key). Always present (possibly {}) so the node can tell "cleared" from
    // "unspoken" and revert cleared sensors to their default.
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok && doc && doc.id ? { ok, cadences: cadencesForNode(doc.id) } : { ok }));
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
