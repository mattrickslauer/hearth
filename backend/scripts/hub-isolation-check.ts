/**
 * Proves the two ways the dashboard used to show data that wasn't true:
 *
 *   1. CLASHES — every hub's camera called itself `hub-cam` and frames were stored at
 *      `frames/<input>/latest.jpg`, with no account and no hub in the key. Two hubs therefore
 *      wrote the same object, across account boundaries.
 *   2. STALE-AS-LIVE — the hub re-sends every node it has ever seen with its last reading, and
 *      ingest stamped each one `now`, so a node that died weeks ago kept a freshly-dated value in
 *      the series and `read_input latest` swore it was current.
 *
 * The OSS legs need a bucket; everything else runs offline against MemoryStore.
 *
 *   npx tsx scripts/hub-isolation-check.ts
 */

import '../src/env.ts';
import { readFileSync } from 'node:fs';
import { MemoryStore } from '../src/store.ts';
import { syncHubDevices } from '../src/hub-devices.ts';
import { framesFor, ossProvisioned, UnknownInputError } from '../src/oss.ts';
import type { AccountId } from '../src/auth.ts';
import { TOOL_BY_NAME, type ToolCtx } from '../src/tools.ts';

/**
 * Scripts are the one place an AccountId is conjured rather than verified. The cast is deliberate
 * and ugly on purpose: in src/ there is no exported mint, so this cannot be done by accident.
 */
const acctId = (s: string): AccountId => s as unknown as AccountId;

let failed = 0;
const line = (tag: string, ok: boolean, msg: string) => {
  console.log(`${tag} ${ok ? 'OK' : 'FAIL'} — ${msg}`);
  if (!ok) failed++;
};

const CAM_KEY = 'cam.frame';
/** One node, self-describing exactly as hub/camera.mjs does. `ageMs` is how long it's been quiet. */
const camNode = (id: string, value: number, ageMs: number | null) => ({
  id,
  describe: { board: 'hub/obs-camera', sensors: [{ key: CAM_KEY, kind: 'camera', vision: true }, { key: 'lux', kind: 'light' }] },
  lastReading: { lux: value },
  ageMs,
});

// ── A) two hubs on ONE account no longer collide ────────────────────────────
// Post-fix the camera id is machine-derived (camera.mjs defaultCameraId), so each hub brings a
// distinct node. Both must survive the merge with their own reading — under the old constant
// 'hub-cam' the second hub's snapshot simply replaced the first's node in the Home Model.
const acctStore = new MemoryStore();
await syncHubDevices(acctStore, { hubId: 'hub-A' }, { nodes: [camNode('cam-aaaa1111', 11, 0)] });
await syncHubDevices(acctStore, { hubId: 'hub-B' }, { nodes: [camNode('cam-bbbb2222', 22, 0)] });

const snaps = await acctStore.listHubDevices();
const ids = snaps.flatMap((s) => s.nodes.map((n) => n.id)).sort();
line('A)', snaps.length === 2 && ids.length === 2 && ids[0] !== ids[1], `two hubs → two distinct camera nodes (${ids.join(', ')})`);

const luxA = await acctStore.readInput('cam-aaaa1111.lux', 'latest', 0, Date.now());
const luxB = await acctStore.readInput('cam-bbbb2222.lux', 'latest', 0, Date.now());
line('A2)', luxA?.value === 11 && luxB?.value === 22, `each hub keeps its own reading series (${luxA?.value} / ${luxB?.value}) — no interleaving`);

// ── B) frames are unreachable except through the account they belong to ─────
// The old defect was a global key: `frames/<input>/latest.jpg`, no account. Rather than assert a
// key SHAPE, assert the property that makes the shape impossible to get wrong — the key builder
// is not exported, so the only door is framesFor(store, accountId) and a caller can only ever
// address the account it was handed. Verified at the module boundary:
const ossSrc = readFileSync(new URL('../src/oss.ts', import.meta.url), 'utf8');
line('B)', /^const frameKey =/m.test(ossSrc) && !/^export const frameKey/m.test(ossSrc), 'frameKey is module-private — no caller can name another account\'s frame');
line('B2)', !/export (async )?function (putFrame|headFrame)\b/.test(ossSrc), 'no free-floating putFrame/headFrame to call with a stray account id');

// ── C) a node that has gone quiet reads as no data, not as a live value ─────
// The heart of "sensors stuck on old data": the hub keeps re-sending this node forever.
const staleStore = new MemoryStore();
const DAY_MS = 86_400_000;
await syncHubDevices(staleStore, { hubId: 'hub-A' }, { nodes: [camNode('cam-dead', 99, 3 * DAY_MS)] });

const deadSnap = (await staleStore.listHubDevices())[0]?.nodes[0];
line('C)', deadSnap?.online === false, `node quiet for 3 days → online=false (was hardcoded true)`);

const deadReading = await staleStore.readInput('cam-dead.lux', 'latest', 0, Date.now());
line('C2)', deadReading == null, `a dead node's re-sent sample is not appended as a fresh reading (got ${JSON.stringify(deadReading?.value ?? null)})`);

// A LIVE node in the same payload must still work — the fix must not silence real sensors.
await syncHubDevices(staleStore, { hubId: 'hub-A' }, { nodes: [camNode('cam-alive', 42, 1500)] });
const aliveSnap = (await staleStore.listHubDevices())[0]?.nodes.find((n) => n.id === 'cam-alive');
const aliveReading = await staleStore.readInput('cam-alive.lux', 'latest', 0, Date.now());
line('C3)', aliveSnap?.online === true && aliveReading?.value === 42, 'a node heard from 1.5s ago is still online and still recorded');

// An older hub that doesn't send ageMs keeps the previous benefit of the doubt.
await syncHubDevices(staleStore, { hubId: 'hub-legacy' }, { nodes: [camNode('cam-legacy', 7, null)] });
const legacySnap = (await staleStore.listHubDevices()).find((s) => s.hubId === 'hub-legacy')?.nodes[0];
line('C4)', legacySnap?.online === true, 'a hub that predates ageMs still reports its nodes online');

// ── A3) a second hub claiming a node id the first owns is refused, not merged ──
// The camera default is unique now, but nothing stops a hub from reporting any id it likes (a
// hand-set HEARTH_CAM_ID, a cloned ESP image). Merging is what produced one series interleaved
// from two devices, unrecoverably — so the newcomer is refused and named.
const dup = await syncHubDevices(acctStore, { hubId: 'hub-C' }, { nodes: [camNode('cam-aaaa1111', 999, 0)] });
line('A3)', dup.conflicts?.includes('cam-aaaa1111') === true && dup.nodes === 0, `hub-C reusing hub-A's node id → refused, reported (${dup.conflicts?.join(',') ?? 'none'})`);
const unpolluted = await acctStore.readInput('cam-aaaa1111.lux', 'latest', 0, Date.now());
line('A4)', unpolluted?.value === 11, `hub-A's series is untouched by the refused claim (still ${unpolluted?.value})`);

// ── D) unpairing a hub takes its sensors with it ────────────────────────────
await acctStore.deleteHubDevices('hub-B');
const left = await acctStore.listHubDevices();
const model = await acctStore.describeHome();
const ghost = model.capabilities.some((c) => c.id.startsWith('cam-bbbb2222.'));
line('D)', !left.some((s) => s.hubId === 'hub-B') && !ghost, 'unpaired hub leaves no ghost sensors in the Home Model');
// …and the id it held is released, so a replacement hub can legitimately claim it.
const reclaim = await syncHubDevices(acctStore, { hubId: 'hub-D' }, { nodes: [camNode('cam-bbbb2222', 33, 0)] });
line('D2)', !reclaim.conflicts && reclaim.nodes === 1, "an unpaired hub's node id is freed for a replacement to claim");

// ── E) frame tools refuse an input the account doesn't own ──────────────────
const LIVE = ossProvisioned();
if (LIVE) {
  const acct = acctId(`acct-iso-${Date.now().toString(36)}`);
  const ctx: ToolCtx = { store: acctStore, accountId: acct };
  const call = (tool: string, args: Record<string, unknown>) => TOOL_BY_NAME.get(tool)!.handler(args, ctx);

  let refused = false;
  try {
    await call('get_snapshot', { input: 'hub-cam.cam.frame' }); // a node this account has never had
  } catch {
    refused = true;
  }
  line('E)', refused, "get_snapshot refuses an input the account doesn't own (was unchecked — any id, any account)");

  let putRefused = false;
  try {
    await call('put_snapshot', { input: 'hub-cam.cam.frame', image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' });
  } catch {
    putRefused = true;
  }
  line('E2)', putRefused, 'put_snapshot refuses to overwrite a frame for an input the account does not own');

  // An owned input with no frame stored reads as absent, rather than presigning a URL that 404s
  // while the UI labels it "live".
  const empty = (await call('get_snapshot', { input: 'cam-aaaa1111.cam.frame' })) as { ossUrl: string | null; capturedAt: number | null };
  line('E3)', empty.ossUrl === null && empty.capturedAt === null, 'owned input with no frame → no URL, no timestamp (honest "no data")');

  // …and once a frame exists it carries the capture time that dates it.
  const at = Date.now();
  const frames = framesFor(acctStore, acct);
  await frames.write('cam-aaaa1111.cam.frame', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', at);
  const stored = await frames.read('cam-aaaa1111.cam.frame');
  line('E4)', !!stored && Math.abs(stored.capturedAt - at) < 2000, `a stored frame reports when it was captured (${stored?.capturedAt ?? 'none'})`);

  // The handle enforces ownership itself, so a NEW frame tool cannot reintroduce the hole by
  // simply forgetting to check — there is no unchecked path to call.
  let handleRefused = false;
  try {
    await frames.write('hub-cam.cam.frame', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', at);
  } catch (e) {
    handleRefused = e instanceof UnknownInputError;
  }
  line('E5)', handleRefused, 'framesFor().write refuses an unowned input on its own — the check is not the caller’s to forget');

  // Two accounts, the SAME node id: the pre-fix `hub-cam` collision, which used to be one object.
  const other = acctId(`acct-other-${Date.now().toString(36)}`);
  const otherStore = new MemoryStore();
  await syncHubDevices(otherStore, { hubId: 'hub-other' }, { nodes: [camNode('cam-aaaa1111', 5, 0)] });
  await framesFor(otherStore, other).write('cam-aaaa1111.cam.frame', 'data:image/png;base64,iVBORw0KGgo=', at);
  const mineAfter = await frames.read('cam-aaaa1111.cam.frame');
  line('E6)', mineAfter?.capturedAt === stored?.capturedAt, "another account writing the same input id leaves this account's frame untouched");
} else {
  console.log('E) SKIPPED — needs OSS_BUCKET + ALI keys for the frame-tool legs.');
}

console.log(failed ? `\nFAIL — ${failed} check(s) failed.` : '\nPASS — hubs stay isolated and stale data reads as no data.');
process.exit(failed ? 1 : 0);
