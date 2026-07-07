/**
 * Camera pipeline self-test — no OBS, no hardware. Drives the camera sensor with
 * ffmpeg's synthetic testsrc and asserts the full loop works: it self-describes,
 * snaps frames on a cadence, emits lightweight READINGs through the ingest path,
 * and hands back a complete JPEG for GET /frame.
 *
 *   node hub/tools/camera-selftest.mjs
 */

import { createCamera } from '../camera.mjs';

process.env.HEARTH_CAM_SOURCE = 'test';
process.env.HEARTH_CAM_CADENCE_MS = process.env.HEARTH_CAM_CADENCE_MS || '1000';
process.env.HEARTH_CAM_QUALITY = process.env.HEARTH_CAM_QUALITY || '70';

const docs = [];
const cam = createCamera({ ingest: (doc) => docs.push(doc) });
cam.start();

console.log('capturing for 4s (synthetic testsrc)…');
await new Promise((r) => setTimeout(r, 4000));

const describe = docs.find((d) => d.type === 'hearth.node.describe');
const readings = docs.filter((d) => d.type === 'hearth.node.reading');
const frame = cam.getFrame();
cam.stop();

console.log(`\ndescribe: ${describe ? `${describe.id} sensors=[${describe.sensors.map((s) => s.key + (s.vision ? ' vision' : '')).join(', ')}]` : 'MISSING'}`);
console.log(`readings emitted: ${readings.length}${readings[0] ? `  e.g. ${JSON.stringify(readings[0].readings)}` : ''}`);
const validJpeg = !!frame && frame.buf[0] === 0xff && frame.buf[1] === 0xd8 && frame.buf[frame.buf.length - 1] === 0xd9;
console.log(`frame: ${frame ? `${(frame.bytes / 1024).toFixed(0)}KB, valid JPEG=${validJpeg}` : 'NONE'}`);

const ok = !!describe && describe.sensors[0]?.vision === true && readings.length >= 1 && validJpeg;
console.log(`\n${ok ? 'PASS' : 'FAIL'} — camera sensor ${ok ? 'describes, snaps on cadence, and serves a real JPEG.' : 'did not complete the pipeline.'}`);
process.exit(ok ? 0 : 1);
