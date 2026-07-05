#!/usr/bin/env node
/**
 * hub/tools/selftest.mjs — prove the fire → actuate → notify loop with no hardware.
 *
 * Spins up a fake "node" (an HTTP server standing in for the ESP32's /actuate
 * endpoint), points a watch at it, feeds the runtime a rising temperature, and
 * asserts that:
 *   1. the watch fires exactly once on the rising edge (not every reading), and
 *   2. the node's actuator is driven ON (the LED "lights up").
 *
 * Run:  node hub/tools/selftest.mjs
 * Exits non-zero on failure. This exercises the REAL engine + runtime code paths.
 */

import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRuntime } from '../runtime.mjs';

const NODE_ID = 'node-SELFTEST01';
let actuateHits = [];

// ── fake node: an HTTP server that records actuator commands (the "LED") ──────
const nodeServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/actuate') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const cmd = JSON.parse(body || '{}');
      actuateHits.push(cmd);
      console.log(`  [fake-node] 💡 actuator ${cmd.actuator} -> ${cmd.value}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const fail = (msg) => {
  console.error(`\n✗ FAIL: ${msg}`);
  process.exit(1);
};

await new Promise((r) => nodeServer.listen(0, '127.0.0.1', r));
const port = nodeServer.address().port;

// ── a watch file pointing at the fake node ────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'hearth-selftest-'));
const watchesFile = join(dir, 'watches.json');
writeFileSync(
  watchesFile,
  JSON.stringify([
    {
      id: 'w-hot',
      title: 'Board is hot',
      compiledSpec: { kind: 'local', local: { expr: { op: '>', left: { input: 'board.temp' }, right: 58 } } },
      fire: { edge: 'rising', cooldown: '30s' },
      actuate: [{ nodeId: NODE_ID, actuator: 'led', value: 'on', port, path: '/actuate' }],
      notify: 'crossed the threshold ({detail})',
    },
  ]),
);
process.env.HUB_WATCHES_FILE = watchesFile;

// ── runtime with a fake node registry entry (addr = our fake server) ──────────
const nodes = new Map([[NODE_ID, { id: NODE_ID, addr: '127.0.0.1', describe: { id: NODE_ID, ip: '127.0.0.1' } }]]);
const runtime = createRuntime({ nodes });
runtime.loadWatches();

const reading = (t) => runtime.onReading({ type: 'hearth.node.reading', id: NODE_ID, readings: { 'board.temp': t } });

console.log('\n→ feeding temps below threshold (should NOT fire)…');
reading(50);
reading(55);
reading(57);

console.log('→ crossing the threshold (should fire ONCE)…');
reading(59); // rising edge
reading(61); // still true — must NOT re-fire (rising edge)
reading(63);

// give the async actuate fetch a moment to land
await new Promise((r) => setTimeout(r, 200));

// ── assertions ────────────────────────────────────────────────────────────────
if (actuateHits.length !== 1) fail(`expected exactly 1 actuation, got ${actuateHits.length}`);
if (actuateHits[0].actuator !== 'led' || String(actuateHits[0].value) !== 'on')
  fail(`actuator command wrong: ${JSON.stringify(actuateHits[0])}`);

console.log('\n✓ PASS — watch fired once on the rising edge and drove the node actuator ON.');
nodeServer.close();
process.exit(0);
