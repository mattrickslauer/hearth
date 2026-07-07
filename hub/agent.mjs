#!/usr/bin/env node
/**
 * Hearth hub agent — the node-facing side of the hub.
 *
 * Two jobs:
 *   1. ADVERTISE itself on the LAN over mDNS as `_hearth._tcp` so nodes find it
 *      with zero configuration — you never tell a node the hub's address.
 *   2. INGEST what nodes send: a `DESCRIBE` document (self-registration — "here's
 *      who I am and what I can sense") and a stream of `READING` documents. It
 *      keeps a live registry of nodes + their latest readings.
 *
 * This is the counterpart to hearth-hub.mjs: that one pairs the hub UP to the cloud,
 * this one gathers nodes DOWN from the LAN — then syncs the registry up to Hearth
 * Cloud (per-account, exposed to Qwen/MCP) using the token hearth-hub.mjs minted.
 * The real Pi agent runs both.
 *
 * One dependency (bonjour-service) for mDNS; everything else is Node stdlib.
 *
 * Usage:
 *   npm install && node hub/agent.mjs
 *   HUB_PORT=8899 BACKEND_URL=http://localhost:9000 node hub/agent.mjs
 * Inspect the registry any time:  curl http://localhost:8899/nodes
 */

import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Bonjour } from 'bonjour-service';

const PORT = Number(process.env.HUB_PORT || 8899);
const SERVICE_TYPE = 'hearth'; // advertised as _hearth._tcp.local
const INGEST_PATH = '/ingest';

// Cloud sync: push the node registry up to Hearth Cloud so it's stored per-account
// and exposed to Qwen/MCP. Authenticated with the hub token that the pairing client
// (hearth-hub.mjs) mints into the shared state file.
const BACKEND_URL = (process.env.BACKEND_URL || 'https://hearth-mcp-gqfuhlkzpo.ap-southeast-1.fcapp.run').replace(/\/$/, '');
const STATE_FILE = process.env.HUB_STATE_FILE || join(process.env.HEARTH_HOME || join(homedir(), '.hearth'), 'hub-state.json');
const SYNC_MS = Number(process.env.HUB_SYNC_MS || 15000);

// The live node registry. In-memory for now; the real hub will persist this and
// feed it to the rule engine / sync it to Hearth Cloud.
const nodes = new Map();

function now() {
  return new Date().toISOString();
}

// The hub's cloud credential lives in the shared pairing state (written by
// hearth-hub.mjs). Read it fresh each sync so pairing/unpairing takes effect live.
function loadHubToken() {
  try {
    if (!existsSync(STATE_FILE)) return null;
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return s && s.hubToken ? { token: s.hubToken, accountId: s.accountId } : null;
  } catch {
    return null;
  }
}

let syncing = false;
// Push the current registry to Hearth Cloud. No-op (but LAN ingest keeps working)
// until the hub is paired. Serialized so a slow sync can't overlap the timer.
async function syncToCloud() {
  if (syncing || nodes.size === 0) return;
  const cred = loadHubToken();
  if (!cred) return;
  syncing = true;
  try {
    const res = await fetch(`${BACKEND_URL}/hub/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cred.token}` },
      body: JSON.stringify({ platform: process.platform, nodes: [...nodes.values()] }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) console.log(`[hub→cloud] synced ${data.nodes ?? '?'} node(s), ${data.readings ?? 0} reading(s)`);
    else console.log(`[hub→cloud] rejected ${res.status}: ${data.error || 'unknown'}`);
  } catch (e) {
    console.log(`[hub→cloud] failed: ${e.message}`);
  } finally {
    syncing = false;
  }
}

// Cap the ingest body — /ingest is unauthenticated and LAN-facing, so an
// unbounded string concat here is a trivial OOM vector.
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

// Fold a node's document into the registry. DESCRIBE registers/updates identity
// and capabilities; READING updates the latest values. Either way we learn the
// node exists — no node is ever configured on the hub by hand.
function ingest(doc) {
  const id = doc && doc.id;
  if (!id) return false;
  const entry = nodes.get(id) || { id, describe: null, lastReading: null, readingCount: 0, firstSeen: now() };
  entry.lastSeen = now();

  if (doc.type === 'hearth.node.describe') {
    const known = entry.describe != null;
    entry.describe = doc;
    const sensors = (doc.sensors || []).map((s) => s.key).join(', ');
    console.log(`[hub] ${known ? 're-announce' : '+ NEW NODE'} ${id} (${doc.board || '?'}) can sense: ${sensors}`);
    if (!known) queueMicrotask(syncToCloud); // push a newly-discovered node up promptly
  } else if (doc.type === 'hearth.node.reading') {
    entry.lastReading = doc.readings || null;
    entry.readingCount += 1;
    console.log(`[hub] ${id} reading #${entry.readingCount}: ${JSON.stringify(doc.readings)}`);
  } else {
    return false;
  }

  nodes.set(id, entry);
  return true;
}

const server = http.createServer(async (req, res) => {
  // Inspection endpoint — the current registry as JSON.
  if (req.method === 'GET' && (req.url === '/nodes' || req.url === '/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([...nodes.values()], null, 2));
    return;
  }
  // Node ingest — accepts DESCRIBE and READING documents.
  if (req.method === 'POST' && req.url === INGEST_PATH) {
    const doc = await readJson(req);
    const ok = ingest(doc);
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[hub] ingest listening on :${PORT} (POST ${INGEST_PATH}, GET /nodes)`);
  const bonjour = new Bonjour();
  const service = bonjour.publish({
    name: 'Hearth Hub',
    type: SERVICE_TYPE,
    port: PORT,
    txt: { path: INGEST_PATH, v: '1' },
  });
  service.on('up', () => console.log(`[hub] advertising _${SERVICE_TYPE}._tcp on the LAN — nodes can now discover me`));

  const cred = loadHubToken();
  console.log(
    cred
      ? `[hub→cloud] paired (account ${cred.accountId ?? '?'}) — syncing devices to ${BACKEND_URL} every ${SYNC_MS / 1000}s`
      : `[hub→cloud] not paired — run hearth-hub.mjs to connect an account (LAN ingest works regardless)`,
  );
  const syncTimer = setInterval(syncToCloud, SYNC_MS);

  const shutdown = () => {
    console.log('\n[hub] shutting down, unpublishing mDNS…');
    clearInterval(syncTimer);
    bonjour.unpublishAll(() => bonjour.destroy());
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
