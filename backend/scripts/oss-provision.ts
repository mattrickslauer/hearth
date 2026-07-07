/**
 * Provision the Hearth vision bucket on Alibaba Cloud OSS — the durable home for
 * camera frames + household reference images (what Qwen-VL reads). Idempotent:
 * creates the bucket if missing, sets a GET-only CORS rule so the dashboard can
 * load frames cross-origin, then round-trips a test object through a signed URL
 * to prove data-plane access end to end.
 *
 *   OSS_BUCKET=hearth-vision-xxxx OSS_REGION=oss-ap-southeast-1 npm run oss-provision
 *
 * Region defaults to ap-southeast-1 to colocate with the FC backend + Tablestore
 * + DashScope-Intl. Uses ALI_ACCESS_KEY_ID/SECRET from the environment.
 */

import '../src/env.ts';
import OSS from 'ali-oss';

const region = process.env.OSS_REGION || 'oss-ap-southeast-1';
const bucket = process.env.OSS_BUCKET;
const accessKeyId = process.env.ALI_ACCESS_KEY_ID;
const accessKeySecret = process.env.ALI_ACCESS_KEY_SECRET;

if (!bucket) throw new Error('set OSS_BUCKET (globally-unique, DNS-safe, e.g. hearth-vision-ab12cd)');
if (!accessKeyId || !accessKeySecret) throw new Error('ALI_ACCESS_KEY_ID / ALI_ACCESS_KEY_SECRET not set');

console.log(`bucket: ${bucket}  region: ${region}\n`);

// Region-scoped client (no bucket) for the create/CORS management calls.
const admin = new OSS({ region, accessKeyId, accessKeySecret, secure: true });

// 1) Create the bucket if it doesn't already exist (owned-by-us is fine).
try {
  await admin.putBucket(bucket);
  console.log('✓ created bucket');
} catch (e) {
  const code = (e as { code?: string }).code;
  if (code === 'BucketAlreadyExists' || code === 'BucketAlreadyOwnedByYou') {
    console.log(`• bucket already exists (${code}) — reusing`);
  } else {
    throw e;
  }
}

// 2) GET-only CORS so the (cross-origin) dashboard can load frames/reference images.
await admin.putBucketCORS(bucket, [
  { allowedOrigin: ['*'], allowedMethod: ['GET', 'HEAD'], allowedHeader: ['*'], maxAgeSeconds: 86400 },
]);
console.log('✓ set GET CORS');

// 3) Round-trip a test object through a signed URL to confirm data-plane access.
const client = new OSS({ region, accessKeyId, accessKeySecret, bucket, secure: true });
const key = 'healthcheck/provision.txt';
await client.put(key, Buffer.from(`hearth oss ok @ ${new Date().toISOString()}`));
const url = client.signatureUrl(key, { expires: 300 });
const res = await fetch(url);
const body = await res.text();
console.log(`✓ put+signed GET ${res.status}: "${body}"`);

console.log(`\n${res.ok ? 'PASS' : 'FAIL'} — OSS bucket provisioned and data-plane verified.`);
console.log(`\nRecord these (backend/.env + s.yaml):\n  OSS_BUCKET=${bucket}\n  OSS_REGION=${region}\n  OSS_ENDPOINT=${region}.aliyuncs.com`);
process.exit(res.ok ? 0 : 1);
