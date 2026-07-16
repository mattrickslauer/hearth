/**
 * Camera-node pipeline self-test — no OBS, no hardware, no running hub.
 *
 * Boots a miniature in-memory "hub" (just an /ingest endpoint) and a REAL
 * node.mjs node with the camera peripheral on ffmpeg's synthetic testsrc, then
 * asserts the full protocol loop a laptop or the hub's embedded camera runs:
 *
 *   · the node DESCRIBEs a vision `cam.frame` sensor + `power` actuator over HTTP
 *   · READINGs arrive on the cadence with the sampled JPEG riding `frames`
 *   · GET /frame on the node hands back a complete JPEG
 *   · POST /actuate {power off} stops capture (the LAN-direct stop that sticks)
 *
 *   node hub/tools/camera-selftest.mjs
 */

import http from 'node:http';

process.env.HEARTH_CAM_SOURCE = process.env.HEARTH_CAM_SOURCE || 'test';
process.env.HEARTH_CAM_CADENCE_MS = process.env.HEARTH_CAM_CADENCE_MS || '1000';
process.env.HEARTH_CAM_QUALITY = process.env.HEARTH_CAM_QUALITY || '70';

const { startNode } = await import('../node.mjs');

// — a miniature hub: capture every ingested document, reply like the real one —
const docs = [];
const hub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      docs.push(JSON.parse(body));
    } catch {}
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, cadences: {}, desired: {} }));
  });
});
await new Promise((r) => hub.listen(0, '127.0.0.1', r));
const hubUrl = `http://127.0.0.1:${hub.address().port}`;

const NODE_PORT = 8871;
const node = startNode({ hubUrl, port: NODE_PORT, peripherals: ['camera'] });

console.log(`capturing for 5s (synthetic testsrc) — mini-hub at ${hubUrl}, node :${NODE_PORT}…`);
await new Promise((r) => setTimeout(r, 5000));

const describe = docs.find((d) => d.type === 'hearth.node.describe');
const readings = docs.filter((d) => d.type === 'hearth.node.reading');
const framed = readings.filter((d) => d.frames?.['cam.frame']);

// The frame as the hub would store it: decode the data URI off the reading doc.
const uri = framed.at(-1)?.frames['cam.frame'] || '';
const b64 = /^data:image\/jpeg;base64,(.+)$/.exec(uri)?.[1];
const buf = b64 ? Buffer.from(b64, 'base64') : Buffer.alloc(0);
const validJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 1] === 0xd9;

// The node's own /frame endpoint (what the hub proxies for the dashboard).
const served = await fetch(`http://127.0.0.1:${NODE_PORT}/frame`).then(
  async (r) => ({ ok: r.ok, bytes: (await r.arrayBuffer()).byteLength }),
  () => ({ ok: false, bytes: 0 }),
);

// LAN-direct stop through the ESP32-shaped actuator endpoint.
const actuated = await fetch(`http://127.0.0.1:${NODE_PORT}/actuate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ actuator: 'power', value: 'off' }),
}).then((r) => r.json(), () => ({}));
const cam = await fetch(`http://127.0.0.1:${NODE_PORT}/camera`).then((r) => r.json(), () => ({}));

node.stop();
hub.close();

const visionSensor = describe?.sensors?.find((s) => s.key === 'cam.frame');
const powerActuator = describe?.actuators?.find((a) => a.key === 'power');
console.log(`\ndescribe: ${describe ? `${describe.id} sensors=[${describe.sensors.map((s) => s.key + (s.vision ? ' vision' : '')).join(', ')}] actuators=[${(describe.actuators || []).map((a) => a.key).join(', ')}]` : 'MISSING'}`);
console.log(`readings ingested: ${readings.length} (${framed.length} carrying a frame)${framed[0] ? `  e.g. ${JSON.stringify(framed[0].readings)}` : ''}`);
console.log(`frame on the reading doc: ${buf.length ? `${(buf.length / 1024).toFixed(0)}KB, valid JPEG=${validJpeg}` : 'NONE'}`);
console.log(`GET /frame on the node: ${served.ok ? `${(served.bytes / 1024).toFixed(0)}KB` : 'FAILED'}`);
console.log(`POST /actuate power off: ${actuated.ok ? `ok — capture now ${cam.enabled ? 'ON (BAD)' : 'off'}` : 'FAILED'}`);

const ok =
  !!visionSensor?.vision &&
  !!powerActuator &&
  framed.length >= 1 &&
  validJpeg &&
  served.ok &&
  actuated.ok === true &&
  cam.enabled === false;
console.log(`\n${ok ? 'PASS' : 'FAIL'} — camera node ${ok ? 'describes, snaps on cadence, rides frames on readings, and obeys /actuate.' : 'did not complete the pipeline.'}`);
process.exit(ok ? 0 : 1);
