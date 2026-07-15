/**
 * Verifies the RUNTIME Qwen-VL loop — the wire from a stored camera frame to a fired
 * watch. This is the thing `household-check` proved in pieces but nothing connected:
 *
 *   A) a cloud/vision watch aimed at a camera input gets judged when a frame lands,
 *      and the fire is stamped `evaluatedBy: 'qwen'` in the audit log,
 *   B) the cheap LOCAL gate runs first and suppresses the cloud call when it's false
 *      (no tokens spent) — the cost-discipline claim,
 *   C) `maxCadence` is a real budget floor, not a comment,
 *   D) linked `memoryIds` actually narrow the reference set Qwen-VL compares against.
 *
 * B and C are checked BEFORE any frame is presigned or any token spent, so they run
 * with no key and no bucket — that half is CI-able as-is. A and D need the real thing:
 *   QWEN_API_KEY=... OSS_BUCKET=... ALI_ACCESS_KEY_ID=... ALI_ACCESS_KEY_SECRET=... \
 *     npm run vision-watch-check
 * Without those it reports A/D as SKIPPED rather than passing on a mock, because a
 * green tick that never called Qwen-VL is exactly the lie this script exists to catch.
 */

import '../src/env.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeStore } from '../src/store.ts';
import { hasKey } from '../src/qwen.ts';
import { ossProvisioned, putFrame } from '../src/oss.ts';
import { judgeFrame } from '../src/vision-watch.ts';
import type { Question } from '../src/domain.ts';

const uri = (rel: string, mime: string) =>
  `data:${mime};base64,${readFileSync(fileURLToPath(new URL(rel, import.meta.url))).toString('base64')}`;
const REF = uri('../../docs/assets/hearth-landing.png', 'image/png'); // the "household member"
const OTHER = uri('../../frontend/assets/images/react-logo.png', 'image/png'); // the "stranger" at the door

// The live legs need a real key AND a real bucket; the discipline legs need neither.
const LIVE = hasKey() && ossProvisioned();
if (!LIVE) {
  console.log(
    `NOTE — live Qwen-VL legs SKIPPED (key=${hasKey() ? 'yes' : 'no'}, oss=${ossProvisioned() ? 'yes' : 'no'}).\n` +
      '       Gate + cadence discipline still verified below; they run before any token is spent.\n',
  );
}

const CAM = 'node-cam.cam.frame';
const store = await makeStore();

// A node must own the input for the frame to be accepted, and for actuates to resolve.
await store.putHubDevices({
  hubId: 'hub-check',
  nodes: [
    {
      id: 'node-cam',
      online: true,
      lastSeen: Date.now(),
      sensors: [{ key: 'cam.frame', kind: 'camera', vision: true }],
      actuators: [{ key: 'siren', kind: 'relay' }],
      readings: {},
    },
  ],
  syncedAt: Date.now(),
});

await store.putHouseholdMember({ id: 'hm-alex', label: 'Alex', tags: ['family'], image: REF, addedAt: 1 });

const watch = (over: Partial<Question>): Question =>
  ({
    id: 'q-vision',
    text: "tell me if someone who isn't family is at the door",
    title: 'Unfamiliar visitor',
    boundInputs: [CAM],
    trigger: "someone at the door who isn't a household member",
    action: 'sound the siren and tell me',
    actuates: ['node-cam.siren'],
    push: false, // don't spam a real channel from a check
    usesVision: true,
    runsLocally: false,
    cost: 'cloud',
    compiledTo: 'cloud_vl',
    compiledSpec: {
      kind: 'cloud',
      cloud: {
        model: 'qwen-vl',
        question: 'Is the person in the live frame NOT one of the household members shown in the reference images?',
      },
    },
    evalOn: 'event',
    fire: { edge: 'rising' },
    ...over,
  }) as Question;

const line = (label: string, ok: boolean, detail: string) =>
  console.log(`${label} ${ok ? 'OK' : 'FAIL'} — ${detail}`);

// ── A) a frame lands → Qwen-VL judges → the fire is attributed to qwen ───────
let aOk = true;
let attributedToQwen = true;
if (LIVE) {
  await store.putQuestion(watch({}));
  await putFrame(CAM, OTHER); // a stranger shows up
  const [a] = await judgeFrame(store, CAM);
  console.log(`A) judged=${a?.judged} fired=${a?.fired} engine=${a?.engine} verdict=${a?.verdict}`);
  console.log(`   → ${a?.reasoning}`);
  const events = await store.listEvents(20);
  const fired = events.find((e) => e.questionId === 'q-vision' && e.kind === 'fired');
  attributedToQwen = fired?.evaluatedBy === 'qwen';
  aOk = a?.judged === true && a?.engine === 'qwen';
  line('A)', aOk, `frame → runtime Qwen-VL call (audit row evaluatedBy=${fired?.evaluatedBy ?? 'none'})`);
  if (a?.fired) line('  ', a.actuated?.includes('node-cam.siren') ?? false, `actuated ${a.actuated?.join(', ') || 'nothing'}`);
} else {
  console.log('A) SKIPPED — needs a live key + bucket.');
}

// ── B) a false gate must suppress the cloud call entirely ────────────────────
await store.putQuestion(
  watch({
    id: 'q-gated',
    compiledSpec: {
      kind: 'cloud',
      cloud: {
        model: 'qwen-vl',
        question: 'Is anyone at the door?',
        // motion is never true here — the gate should hold the wallet shut.
        gate: { op: '==', left: { input: 'node-cam.motion' }, right: true },
      },
    },
  }),
);
const gated = (await judgeFrame(store, CAM)).find((o) => o.questionId === 'q-gated');
line('B)', gated?.judged === false && gated?.skipped === 'gate', `false gate → no cloud call (skipped=${gated?.skipped})`);
await store.deleteQuestion('q-gated');

// ── C) maxCadence is a real floor ────────────────────────────────────────────
// Seeded rather than driven by a real first look, so this leg proves the metering
// itself and stays runnable with no bucket: "we looked a minute ago, the floor is an
// hour → refuse". The floor is checked before the frame is presigned, which is the
// whole point — a metered watch must cost nothing at all.
await store.putQuestion(
  watch({
    id: 'q-metered',
    compiledSpec: {
      kind: 'cloud',
      cloud: { model: 'qwen-vl', question: 'Anyone there?', maxCadence: '1h' },
    },
  }),
);
await store.putRunState({ questionId: 'q-metered', lastJudgedAt: Date.now() - 60_000, lastFiredAt: 0, lastAnswer: false });
const metered = (await judgeFrame(store, CAM)).find((o) => o.questionId === 'q-metered');
line('C)', metered?.judged === false && metered?.skipped === 'cadence', `looked 1m ago, floor 1h → refused before spending (skipped=${metered?.skipped})`);
await store.deleteQuestion('q-metered');

// ── D) memoryIds narrow the reference set ───────────────────────────────────
let dOk = true;
if (LIVE) {
  await store.putHouseholdMember({ id: 'hm-sam', label: 'Sam', tags: ['family'], image: OTHER, addedAt: 2 });
  await store.putQuestion(watch({ id: 'q-linked', memoryIds: ['hm-sam'] }));
  // Frame IS Sam; with only Sam linked, Qwen-VL should recognise a household member → no fire.
  await putFrame(CAM, OTHER);
  const linked = (await judgeFrame(store, CAM)).find((o) => o.questionId === 'q-linked');
  console.log(`D) linked-to-Sam, frame is Sam → fired=${linked?.fired} verdict=${linked?.verdict}`);
  console.log(`   → ${linked?.reasoning}`);
  dOk = linked?.judged === true && linked?.fired === false;
  line('D)', dOk, 'linked memory recognised the subject as household');
} else {
  console.log('D) SKIPPED — needs a live key + bucket.');
}

const ok = aOk && attributedToQwen && dOk && gated?.skipped === 'gate' && metered?.skipped === 'cadence';
console.log(
  `\n${ok ? 'PASS' : 'FAIL'} — ${LIVE ? 'a real frame reaches Qwen-VL at runtime, gated and metered.' : 'gate + cadence discipline verified; run with a key + bucket to prove the Qwen-VL leg.'}`,
);
process.exit(ok ? 0 : 1);
