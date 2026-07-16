/**
 * Verifies the OSS image path end to end:
 *   1. a household reference photo uploads to OSS and comes back as a fetchable
 *      presigned GET URL,
 *   2. Qwen-VL reads the OSS presigned URL directly (proves DashScope can fetch
 *      it server-side — the whole point of storing frames/refs in OSS).
 *
 * The camera-frame legs live in hub-isolation-check instead: frames are reachable only through
 * `framesFor(store, accountId)`, so proving them needs an account whose store declares the input —
 * which is exactly the setup that check already has.
 *
 *   OSS_BUCKET=... OSS_REGION=... ALI_ACCESS_KEY_ID=... ALI_ACCESS_KEY_SECRET=... \
 *   QWEN_API_KEY=... npm run oss-check
 */

import '../src/env.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ossProvisioned, putImage, resolveImage } from '../src/oss.ts';
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

// 2) Qwen-VL reads the OSS URL directly (DashScope fetches it server-side)
let vlOk = true;
if (hasKey()) {
  const { answer } = await probeVision([url], 'Describe this image in one sentence. Reply JSON {description}.');
  console.log(`2) Qwen-VL via OSS URL → ${JSON.stringify(answer)}`);
  vlOk = typeof answer.description === 'string';
} else {
  console.log('2) (no QWEN_API_KEY — skipped Qwen-VL read)');
}

const ok = !!handle?.startsWith('oss://') && r.ok && vlOk;
console.log(`\n${ok ? 'PASS' : 'FAIL'} — OSS image path works end to end.`);
process.exit(ok ? 0 : 1);
