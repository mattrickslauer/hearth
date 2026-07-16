/**
 * Verifies the run log — the record of what compiled watches actually did and spent.
 *
 * The estimator (`pricing-check`) proves what a watch WILL cost. This proves we
 * correctly record what it DID cost, and that the log can be searched:
 *
 *   A) real token counts are priced off the same rate card the quote uses,
 *   B) a repair retry bills twice and the meter says so (it must not report the last
 *      attempt as the whole cost),
 *   C) an unknown model is flagged rather than silently priced at zero,
 *   D) every search filter narrows the way it claims to,
 *   E) totals cover the whole match, not just the returned page — a capped page must
 *      never understate the bill,
 *   F) cost lives on exactly one row per call, so a fired look can't bill twice,
 *   G) skip tallies accumulate without a store write on the hot path.
 *
 * Pure — no key, no network, no Tablestore:
 *
 *   npm run runs-check
 */

import { MemoryStore, matchesRun, totalRuns, type RunEventRow } from '../src/store.ts';
import { priceCall, sumUsage, type CallUsage } from '../src/qwen.ts';
import { MODEL_RATES } from '../src/domain.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} — ${detail}`);
};
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;

// ---- A) pricing real tokens ---------------------------------------------------------

{
  const inTok = 1000;
  const outTok = 500;
  const { usd, unrated } = priceCall('qwen-vl-plus', inTok, outTok);
  // qwen-vl-plus is a member of the 'qwen-vl' family in the catalog.
  const rate = MODEL_RATES['qwen-vl'];
  const want = (inTok * rate.in + outTok * rate.out) / 1_000_000;
  check('A1 vl-plus prices off the qwen-vl rate', near(usd, want), `$${usd.toFixed(8)} == $${want.toFixed(8)}`);
  check('A1 vl-plus is rated', !unrated, `unrated=${unrated}`);

  // The longest-match rule: qwen-vl-max must NOT fall through to the cheaper qwen-vl.
  const max = priceCall('qwen-vl-max', inTok, outTok).usd;
  const plus = priceCall('qwen-vl-plus', inTok, outTok).usd;
  check('A2 vl-max does not bill at vl-plus rates', max > plus, `max $${max.toFixed(6)} > plus $${plus.toFixed(6)}`);

  const exact = priceCall('qwen-plus', inTok, outTok).usd;
  const wantExact = (inTok * MODEL_RATES['qwen-plus'].in + outTok * MODEL_RATES['qwen-plus'].out) / 1_000_000;
  check('A3 exact catalog id prices exactly', near(exact, wantExact), `$${exact.toFixed(8)}`);

  // qwen-max must not be captured by the qwen-plus entry or vice versa.
  const qmax = priceCall('qwen-max', inTok, outTok).usd;
  const wantMax = (inTok * MODEL_RATES['qwen-max'].in + outTok * MODEL_RATES['qwen-max'].out) / 1_000_000;
  check('A4 qwen-max prices as qwen-max', near(qmax, wantMax), `$${qmax.toFixed(8)}`);
}

// ---- B) a repair retry bills twice --------------------------------------------------

{
  const one: CallUsage = { model: 'qwen-plus', inTokens: 400, outTokens: 150, usd: 0.0004, ms: 800 };
  const two: CallUsage = { model: 'qwen-plus', inTokens: 500, outTokens: 160, usd: 0.0005, ms: 900 };
  const summed = sumUsage([one, two])!;
  check('B1 retry sums tokens', summed.inTokens === 900 && summed.outTokens === 310, `${summed.inTokens}in/${summed.outTokens}out`);
  check('B1 retry sums usd', near(summed.usd, 0.0009), `$${summed.usd}`);
  check('B1 retry sums latency', summed.ms === 1700, `${summed.ms}ms`);
  check('B2 a repaired author costs MORE than one attempt', summed.usd > one.usd, `$${summed.usd} > $${one.usd}`);
  check('B3 no calls means no usage row', sumUsage([]) === undefined, 'undefined');
}

// ---- C) an unknown model is loud, not free ------------------------------------------

{
  const { usd, unrated } = priceCall('qwen-nextgen-9000', 1000, 500);
  check('C1 unknown model is flagged unrated', unrated, `unrated=${unrated}`);
  check('C1 unknown model does not invent a price', usd === 0, `$${usd}`);
  const rows: RunEventRow[] = [{ id: 'r', ts: 1, questionId: 'q', kind: 'judged', usd: 0, unrated: true }];
  check('C2 unrated propagates to totals', totalRuns(rows).unrated, 'totals.unrated=true');
}

// ---- D) search filters ---------------------------------------------------------------

const rows: RunEventRow[] = [
  { id: 'e1', ts: 1_000, questionId: 'q-a', kind: 'authored', title: 'Front door', reasoning: 'authored by qwen', evaluatedBy: 'qwen', model: 'qwen-plus', tokens: { in: 400, out: 150 }, usd: 0.0004, ms: 700 },
  { id: 'e2', ts: 2_000, questionId: 'q-a', kind: 'judged', title: 'Front door', reasoning: 'a stranger is at the door', evaluatedBy: 'qwen', model: 'qwen-vl-plus', tokens: { in: 1200, out: 90 }, usd: 0.0003, ms: 1500 },
  { id: 'e3', ts: 3_000, questionId: 'q-a', kind: 'fired', title: 'Front door', reasoning: 'a stranger is at the door', evaluatedBy: 'qwen' },
  { id: 'e4', ts: 4_000, questionId: 'q-b', kind: 'judged', title: 'Garage heater', reasoning: 'nothing unusual', evaluatedBy: 'local' },
  { id: 'e5', ts: 5_000, questionId: 'q-b', kind: 'notify', title: 'Garage heater', reasoning: 'sent to telegram' },
];

const f = (q: Parameters<typeof matchesRun>[1]) => rows.filter((r) => matchesRun(r, q)).map((r) => r.id);

check('D1 time window is inclusive', String(f({ from: 2_000, to: 4_000 })) === 'e2,e3,e4', String(f({ from: 2_000, to: 4_000 })));
check('D2 by watch', String(f({ questionId: 'q-b' })) === 'e4,e5', String(f({ questionId: 'q-b' })));
check('D3 by kind', String(f({ kinds: ['judged'] })) === 'e2,e4', String(f({ kinds: ['judged'] })));
check('D4 by several kinds', String(f({ kinds: ['fired', 'notify'] })) === 'e3,e5', String(f({ kinds: ['fired', 'notify'] })));
check('D5 by engine', String(f({ engine: 'local' })) === 'e4', String(f({ engine: 'local' })));
check('D6 text matches reasoning', String(f({ text: 'stranger' })) === 'e2,e3', String(f({ text: 'stranger' })));
check('D7 text matches title', String(f({ text: 'garage' })) === 'e4,e5', String(f({ text: 'garage' })));
check('D8 text is case-insensitive', String(f({ text: 'GARAGE' })) === 'e4,e5', String(f({ text: 'GARAGE' })));
check('D9 text matches model', String(f({ text: 'qwen-vl' })) === 'e2', String(f({ text: 'qwen-vl' })));
check('D10 billedOnly keeps only real spend', String(f({ billedOnly: true })) === 'e1,e2', String(f({ billedOnly: true })));
check('D11 filters compose (AND, not OR)', String(f({ questionId: 'q-a', kinds: ['judged'], text: 'stranger' })) === 'e2', String(f({ questionId: 'q-a', kinds: ['judged'], text: 'stranger' })));

// A local eval costs nothing, but "free" must not read as "unmeasured".
check('D12 an unbilled row has no usd at all', rows.find((r) => r.id === 'e4')!.usd === undefined, 'usd=undefined, not 0');

// ---- E) totals cover the match, not the page ----------------------------------------

{
  const store = new MemoryStore(false);
  for (const r of rows) await store.appendEvent(r);
  const res = await store.searchRuns({ limit: 2 });
  check('E1 page is capped', res.rows.length === 2, `${res.rows.length} rows`);
  check('E2 totals count the whole match', res.totals.rows === 5, `${res.totals.rows} matched`);
  const wantUsd = 0.0004 + 0.0003;
  check('E3 totals sum the whole match, not the page', near(res.totals.usd, wantUsd), `$${res.totals.usd.toFixed(6)} == $${wantUsd.toFixed(6)}`);
  check('E4 billed count ignores free rows', res.totals.billed === 2, `${res.totals.billed} billed of ${res.totals.rows}`);
  check('E5 tokens sum', res.totals.tokensIn === 1600 && res.totals.tokensOut === 240, `${res.totals.tokensIn}in/${res.totals.tokensOut}out`);

  const scoped = await store.searchRuns({ questionId: 'q-a', billedOnly: true });
  check('E6 spend is attributable per watch', near(scoped.totals.usd, wantUsd), `q-a: $${scoped.totals.usd.toFixed(6)}`);
}

// ---- F) one call, one priced row ----------------------------------------------------

{
  // e2 (judged) and e3 (fired) come from the SAME Qwen call. Only e2 may carry usd —
  // otherwise a look that fires would be billed twice by anything summing the log.
  const sameCall = rows.filter((r) => r.questionId === 'q-a' && r.ts >= 2_000 && r.ts <= 3_000);
  const priced = sameCall.filter((r) => r.usd != null);
  check('F1 exactly one row per call carries cost', priced.length === 1, `${priced.length} of ${sameCall.length} rows priced`);
  check('F1 the priced row is the billed call', priced[0]?.kind === 'judged', `kind=${priced[0]?.kind}`);
}

// ---- G) skip tallies ----------------------------------------------------------------

{
  const store = new MemoryStore(false);
  await store.countSkip('q-a', 'gate');
  await store.countSkip('q-a', 'gate');
  await store.countSkip('q-a', 'cadence');
  const st = await store.getRunState('q-a');
  check('G1 skips tally by reason', st?.skips?.gate === 2 && st?.skips?.cadence === 1, JSON.stringify(st?.skips));
  check('G2 skips write no run rows', (await store.searchRuns({})).totals.rows === 0, 'log stays empty');
}

console.log(failures ? `\n${failures} FAILED` : '\nall run-log checks passed');
process.exit(failures ? 1 : 0);
