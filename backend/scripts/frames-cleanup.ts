/**
 * Delete the legacy, un-scoped camera frames left in OSS by the pre-account-scoping key layout.
 *
 * Frames used to be stored at `frames/<input>/latest.jpg` — no account, no hub (see oss.ts
 * frameKey). Because every hub camera called itself `hub-cam`, every account's camera resolved to
 * ONE object: hubs overwrote each other's frames and dashboards read whatever landed last, across
 * account boundaries. Frames are now written to `frames/<account>/<input>/latest.jpg`, which makes
 * every object at the old layout unreachable — and each one is a real photo from someone's home
 * that nothing will ever overwrite or expire again.
 *
 * So they are deleted, not migrated: there is no way to tell which account a legacy frame belongs
 * to (that ambiguity is the bug), and guessing wrong would hand a stranger's frame to an account
 * under a fresh key. Anything still live gets replaced within one snap cadence by the real camera.
 *
 * A legacy key is any `frames/<seg>/…` whose first segment is not an account id. Dry-run by
 * default; pass --apply to delete.
 *
 *   OSS_BUCKET=… OSS_REGION=… npx tsx scripts/frames-cleanup.ts [--apply]
 */

import '../src/env.ts';

const APPLY = process.argv.includes('--apply');

interface ListedObject {
  name: string;
  size: number;
  lastModified: string;
}
interface AdminClient {
  list(q: { prefix: string; 'max-keys': number; marker?: string }): Promise<{ objects?: ListedObject[]; nextMarker?: string; isTruncated?: boolean }>;
  delete(name: string): Promise<unknown>;
}

const bucket = process.env.OSS_BUCKET;
if (!bucket || !process.env.ALI_ACCESS_KEY_ID || !process.env.ALI_ACCESS_KEY_SECRET) {
  console.error('FAIL — set OSS_BUCKET + ALI_ACCESS_KEY_ID/SECRET.');
  process.exit(1);
}

const OSS = ((await import('ali-oss')) as { default?: unknown }).default as new (o: object) => AdminClient;
const client = new OSS({
  region: process.env.OSS_REGION || 'oss-ap-southeast-1',
  accessKeyId: process.env.ALI_ACCESS_KEY_ID,
  accessKeySecret: process.env.ALI_ACCESS_KEY_SECRET,
  bucket,
  secure: true,
});

/** Account ids are minted as `acct-<base36>-<seq>` (see auth.ts) — the current layout's first segment. */
const isAccountSegment = (seg: string): boolean => /^acct-/.test(seg);

const all: ListedObject[] = [];
let marker: string | undefined;
do {
  const page = await client.list({ prefix: 'frames/', 'max-keys': 1000, marker });
  all.push(...(page.objects ?? []));
  marker = page.isTruncated ? page.nextMarker : undefined;
} while (marker);

// frames/<first>/…  — legacy when <first> is an input id rather than an account id.
const legacy = all.filter((o) => {
  const first = o.name.slice('frames/'.length).split('/')[0];
  return !!first && !isAccountSegment(first);
});

console.log(`bucket: ${bucket}\n${all.length} object(s) under frames/, ${legacy.length} legacy (un-scoped)\n`);
for (const o of legacy) console.log(`  ${o.lastModified}  ${String(o.size).padStart(8)}B  ${o.name}`);

if (!legacy.length) {
  console.log('\nNothing to clean.');
  process.exit(0);
}
if (!APPLY) {
  console.log('\nDry run — re-run with --apply to delete these.');
  process.exit(0);
}

let deleted = 0;
for (const o of legacy) {
  try {
    await client.delete(o.name);
    deleted++;
    console.log(`  deleted ${o.name}`);
  } catch (e) {
    console.error(`  FAILED ${o.name}: ${(e as Error).message}`);
  }
}
console.log(`\n${deleted}/${legacy.length} deleted.`);
process.exit(deleted === legacy.length ? 0 : 1);
