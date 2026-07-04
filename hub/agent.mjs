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
 * This is the counterpart to sim-hub.mjs: that one pairs the hub UP to the cloud,
 * this one gathers nodes DOWN from the LAN. The real Pi agent runs both.
 *
 * One dependency (bonjour-service) for mDNS; everything else is Node stdlib.
 *
 * Usage:
 *   npm install && node hub/agent.mjs
 *   HUB_PORT=8899 node hub/agent.mjs
 * Inspect the registry any time:  curl http://localhost:8899/nodes
 */

import http from 'node:http';
import { Bonjour } from 'bonjour-service';

const PORT = Number(process.env.HUB_PORT || 8899);
const SERVICE_TYPE = 'hearth'; // advertised as _hearth._tcp.local
const INGEST_PATH = '/ingest';

// The live node registry. In-memory for now; the real hub will persist this and
// feed it to the rule engine / sync it to Hearth Cloud.
const nodes = new Map();

function now() {
  return new Date().toISOString();
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
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

  const shutdown = () => {
    console.log('\n[hub] shutting down, unpublishing mDNS…');
    bonjour.unpublishAll(() => bonjour.destroy());
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
