/**
 * Verifies the OSS image path end to end:
 *   1. a household reference photo uploads to OSS and comes back as a fetchable
 *      presigned GET URL,
 *   2. a camera frame round-trips through putFrame → get_snapshot's presign,
 *   3. Qwen-VL reads the OSS presigned URL directly (proves DashScope can fetch
 *      it server-side — the whole point of storing frames/refs in OSS).
 *
 *   OSS_BUCKET=... OSS_REGION=... ALI_ACCESS_KEY_ID=... ALI_ACCESS_KEY_SECRET=... \
 *   QWEN_API_KEY=... npm run oss-check
 */

import '../src/env.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ossProvisioned, putImage, resolveImage, putFrame, presignKey, frameKey } from '../src/oss.ts';
import { probeVision, hasKey } from '../src/qwen.ts';

if (!ossProvisioned()) {
  console.error('FAIL — OSS not provisioned (set OSS_BUCKET + ALI_ACCESS_KEY_ID/SECRET).');
  process.exit(1);
}
console.log(`bucket: ${process.env.OSS_BUCKET}  region: ${process.env.OSS_REGION ?? 'oss-ap-southeast-1'}\n`);

const img = `data:image/png;base64,${readFileSync(
  fileURLToPath(new URL('../../docs/assets/hearth-landing.png', import.meta.url)),
).toString('base64')}`;

// 1) household reference photo → OSS handle → presigned URL → fetchable
const handle = await putImage('household', `check-${Date.now().toString(36)}`, img);
console.log(`1) putImage → ${handle}`);
const url = await resolveImage(handle!);
const r = await fetch(url);
console.log(`   presigned GET → ${r.status} ${r.headers.get('content-type')} (${(await r.arrayBuffer()).byteLength} bytes)`);

// 2) camera frame → putFrame → get_snapshot-style presign of the latest-frame key
await putFrame('camera.frame', img);
const furl = await presignKey(frameKey('camera.frame'));
const fr = await fetch(furl);
console.log(`2) frame ${frameKey('camera.frame')} presigned GET → ${fr.status}`);

// 3) Qwen-VL reads the OSS URL directly (DashScope fetches it server-side)
let vlOk = true;
if (hasKey()) {
  const { answer } = await probeVision([url], 'Describe this image in one sentence. Reply JSON {description}.');
  console.log(`3) Qwen-VL via OSS URL → ${JSON.stringify(answer)}`);
  vlOk = typeof answer.description === 'string';
} else {
  console.log('3) (no QWEN_API_KEY — skipped Qwen-VL read)');
}

const ok = !!handle?.startsWith('oss://') && r.ok && fr.ok && vlOk;
console.log(`\n${ok ? 'PASS' : 'FAIL'} — OSS image path works end to end.`);
process.exit(ok ? 0 : 1);
