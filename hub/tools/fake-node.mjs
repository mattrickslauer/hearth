#!/usr/bin/env node
/**
 * hub/tools/fake-node.mjs — a software stand-in for an ESP32 node.
 *
 * Registers with a running hub (DESCRIBE), then streams READING documents with a
 * temperature that ramps up over time — and runs a real /actuate HTTP endpoint,
 * so when a watch fires the hub drives this node's "LED" and you see it here.
 *
 * Use it to rehearse the full fire → actuate → notify loop on one laptop, with no
 * hardware, before you film the real board doing the same thing.
 *
 *   Terminal 1:  node hub/hub.mjs                 # or point at a local backend
 *   Terminal 2:  node hub/tools/fake-node.mjs     # watch it appear + heat up
 *   (put a watch on board.temp > <threshold> in ~/.hearth/watches.json)
 *
 * Env: HUB_URL (default http://localhost:8899), NODE_ID, ACT_PORT (default 8090),
 *      START_TEMP (40), STEP (2), INTERVAL_MS (2000), MAX_TEMP (75).
 */

import http from 'node:http';

const HUB_URL = (process.env.HUB_URL || 'http://localhost:8899').replace(/\/$/, '');
const NODE_ID = process.env.NODE_ID || 'node-FAKE0001';
const ACT_PORT = Number(process.env.ACT_PORT || 8090);
const START = Number(process.env.START_TEMP || 40);
const STEP = Number(process.env.STEP || 2);
const INTERVAL = Number(process.env.INTERVAL_MS || 2000);
const MAX = Number(process.env.MAX_TEMP || 75);

let ledOn = false;
let temp = START;

// Real /actuate endpoint — the hub POSTs here when a watch fires.
http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/actuate') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const cmd = (() => {
          try {
            return JSON.parse(body || '{}');
          } catch {
            return {};
          }
        })();
        ledOn = !(String(cmd.value).includes('off') || String(cmd.value) === 'false');
        console.log(`  💡 [${NODE_ID}] ${cmd.actuator || 'led'} -> ${ledOn ? 'ON' : 'OFF'}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, led: ledOn }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(ACT_PORT, '0.0.0.0', () => console.log(`[fake-node] /actuate on :${ACT_PORT}`));

async function post(doc) {
  try {
    const res = await fetch(`${HUB_URL}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    return res.ok;
  } catch (e) {
    console.log(`[fake-node] hub unreachable at ${HUB_URL} — ${e.message}`);
    return false;
  }
}

const describe = {
  type: 'hearth.node.describe',
  id: NODE_ID,
  board: 'esp32-sim',
  ip: '127.0.0.1',
  sensors: [{ key: 'board.temp', kind: 'temperature', unit: 'C', wiring: 'builtin' }],
  actuators: [{ key: 'led', kind: 'switch', port: ACT_PORT, path: '/actuate' }],
};

console.log(`[fake-node] ${NODE_ID} → hub ${HUB_URL}  (temp ${START}→${MAX} by ${STEP} every ${INTERVAL}ms)`);
await post(describe);

setInterval(async () => {
  temp = Math.min(MAX, temp + STEP);
  const ok = await post({ type: 'hearth.node.reading', id: NODE_ID, readings: { 'board.temp': Number(temp.toFixed(1)) } });
  console.log(`[fake-node] board.temp = ${temp.toFixed(1)}°C ${ok ? '' : '(not delivered)'}${ledOn ? '   💡 LED ON' : ''}`);
}, INTERVAL);
