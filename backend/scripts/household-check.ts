/**
 * Verifies household reference recognition end to end:
 *   A) the store CRUD for household members (add / list / remove),
 *   B) Qwen-VL actually reasons over a REFERENCE image vs a LIVE frame — the
 *      "facial recognition" without a face model: same subject → match, a
 *      different subject → not a match,
 *   C) the production judge() path accepts references + a frame and returns a
 *      structured verdict.
 * Uses two distinct real repo images as stand-ins for a family photo vs a
 * stranger at the door (real portraits come from the user's uploads at demo time).
 *
 *   QWEN_API_KEY=... npm run household-check
 */

import '../src/env.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeStore } from '../src/store.ts';
import { probeVision, judge, hasKey } from '../src/qwen.ts';

const uri = (rel: string, mime: string) =>
  `data:${mime};base64,${readFileSync(fileURLToPath(new URL(rel, import.meta.url))).toString('base64')}`;
const REF = uri('../../docs/assets/hearth-landing.png', 'image/png'); // "family" reference
const OTHER = uri('../../frontend/assets/images/react-logo.png', 'image/png'); // a "stranger"

// ── A) store CRUD ────────────────────────────────────────────────────────────
const store = await makeStore();
await store.putHouseholdMember({ id: 'hm-a', label: 'Alex', image: REF, addedAt: 1 });
await store.putHouseholdMember({ id: 'hm-b', label: 'Sam', image: OTHER, addedAt: 2 });
const two = await store.listHousehold();
await store.deleteHouseholdMember('hm-b');
const one = await store.listHousehold();
const storeOk = two.length === 2 && one.length === 1 && one[0].label === 'Alex';
console.log(`A) store: added 2 → listed ${two.length}, after delete → ${one.length} (${one[0]?.label}). ${storeOk ? 'OK' : 'FAIL'}\n`);

if (!hasKey()) {
  console.error('FAIL — no QWEN_API_KEY; cannot verify Qwen-VL reference reasoning.');
  process.exit(1);
}

// ── B) reference-vs-live reasoning (the recognition primitive) ───────────────
const Q = 'Image 1 is a reference photo of a known person. Does image 2 show the SAME subject as image 1? Reply JSON {same: boolean, why: string}.';
const same = await probeVision([REF, REF], Q);
const diff = await probeVision([REF, OTHER], Q);
console.log(`B) same subject → ${JSON.stringify(same.answer)}`);
console.log(`   diff subject → ${JSON.stringify(diff.answer)}`);
const recognises = same.answer.same === true && diff.answer.same === false;
console.log(`   recognition distinguishes match vs stranger: ${recognises ? 'OK' : 'FAIL'}\n`);

// ── C) production judge() with references + a live frame ─────────────────────
const { judgment, engine } = await judge({
  title: 'Unfamiliar visitor',
  trigger: "someone at the door who isn't a household member",
  questions: ['is the person in the live frame NOT one of the household members?'],
  scene: '(live camera frame attached)',
  visitor: null,
  references: [{ label: 'Alex', image: REF }],
  images: [OTHER],
});
console.log(`C) judge [${engine}] fired=${judgment.fired} verdict=${judgment.verdict}`);
console.log(`   → ${judgment.reasoning}`);
const judgeOk = engine === 'qwen' && typeof judgment.verdict === 'string';

const ok = storeOk && recognises && judgeOk;
console.log(`\n${ok ? 'PASS' : 'FAIL'} — household reference recognition works end to end.`);
process.exit(ok ? 0 : 1);
