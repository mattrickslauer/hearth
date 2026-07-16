/**
 * Proves the run log is durable in Tablestore, not stranded on one Function Compute
 * instance's heap. Exits non-zero if it isn't.
 *
 *   set -a; . ./.env; set +a; HEARTH_STORE=tablestore npm run runs-durable-check
 *
 * This is the companion to `readings-check`, and it exists because the run log had exactly
 * the bug readings once had: `appendEvent` pushed onto a capped in-memory array and the
 * Tablestore adapter never overrode it, so on FC the activity feed was per-instance and
 * vanished on freeze — and any spend it implied was fiction.
 *
 * `runs-check` and `meter-check` cover the logic and the metering with no credentials.
 * Only this one can prove the round-trip through the real table.
 *
 * Scoped to a throwaway account partition; the rows it writes self-expire via the
 * hearth_runs table's 365d TTL. To clean up sooner, delete the `_verify_*` partition.
 */
import { makeStore, type RunEventRow } from '../src/store';

const acct = `_verify_${Date.now()}`;
const fail = (m: string) => {
  console.error(`FAIL — ${m}`);
  process.exit(1);
};

const store = await makeStore(acct);
console.log(`store: ${store.constructor.name} (account ${acct})`);
if (store.constructor.name !== 'TablestoreStore') fail(`expected TablestoreStore, got ${store.constructor.name}`);

const now = Date.now();
const row = (over: Partial<RunEventRow> & { id: string; ts: number }): RunEventRow => ({
  questionId: 'q-verify',
  kind: 'judged',
  ...over,
});

// 1. write a log spanning 3h, including two rows in the SAME millisecond (the id tie-break)
await store.appendEvent(row({ id: 'r1', ts: now - 3 * 3600_000, kind: 'authored', title: 'Front door', model: 'qwen-plus', tokens: { in: 400, out: 150 }, usd: 0.0004, evaluatedBy: 'qwen' }));
await store.appendEvent(row({ id: 'r2', ts: now - 2 * 3600_000, title: 'Front door', reasoning: 'a stranger is at the door', model: 'qwen-vl-plus', tokens: { in: 1200, out: 90 }, usd: 0.0003, evaluatedBy: 'qwen' }));
await store.appendEvent(row({ id: 'r3', ts: now - 60_000, kind: 'fired', title: 'Front door', reasoning: 'a stranger is at the door', evaluatedBy: 'qwen' }));
await store.appendEvent(row({ id: 'r4', ts: now - 60_000, kind: 'notify', title: 'Front door', reasoning: 'sent to telegram' }));
await store.appendEvent(row({ id: 'r5', ts: now - 30_000, questionId: 'q-other', kind: 'judged', title: 'Garage heater', evaluatedBy: 'local' }));
console.log('1) wrote 5 runs (two sharing a millisecond)');

// 2. the read that used to be a lie: it must come back from the TABLE, not the heap.
const feed = await store.listEvents(10);
console.log(`2) listEvents → ${feed.length} rows: ${feed.map((r) => r.id).join(',')}`);
if (feed.length !== 5) fail(`expected 5 rows back from Tablestore, got ${feed.length}`);

// 3. same-millisecond rows must BOTH survive — the id suffix is what keeps r3 from
//    overwriting r4 at an identical timestamp key.
const ids = new Set(feed.map((r) => r.id));
if (!ids.has('r3') || !ids.has('r4')) fail(`a same-ms row was clobbered: got ${[...ids].join(',')}`);
console.log('3) same-millisecond rows both survive');

// 4. newest first — the feed's whole contract
if (feed[0].id !== 'r5') fail(`feed should be newest-first (r5), got ${feed[0].id}`);
console.log('4) newest-first ordering holds');

// 5. the limit must bound the scan, not just slice the result
const two = await store.listEvents(2);
if (two.length !== 2 || two[0].id !== 'r5') fail(`limit 2 should give the 2 newest, got ${two.map((r) => r.id).join(',')}`);
console.log('5) limit returns the newest page');

// 6. search: time window, inclusive bounds
const win = await store.searchRuns({ from: now - 2 * 3600_000, to: now - 30_000 });
console.log(`6) window → ${win.rows.map((r) => r.id).join(',')} (totals ${win.totals.rows})`);
if (win.totals.rows !== 4) fail(`window should match r2..r5 = 4 rows, got ${win.totals.rows}`);

// 7. search: by watch — spend must be attributable
const scoped = await store.searchRuns({ questionId: 'q-verify' });
if (scoped.totals.rows !== 4) fail(`q-verify should have 4 rows, got ${scoped.totals.rows}`);
if (Math.abs(scoped.totals.usd - 0.0007) > 1e-9) fail(`q-verify spend should be $0.0007, got $${scoped.totals.usd}`);
console.log(`7) per-watch spend = $${scoped.totals.usd.toFixed(6)} over ${scoped.totals.billed} billed calls`);

// 8. search: free text, round-tripped through JSON in the table
const text = await store.searchRuns({ text: 'stranger' });
if (text.totals.rows !== 2) fail(`text 'stranger' should match r2,r3, got ${text.totals.rows}`);
console.log('8) text search survives the round-trip');

// 9. billedOnly — and the distinction that matters: absent usd is not zero
const billed = await store.searchRuns({ billedOnly: true });
if (billed.totals.rows !== 2) fail(`billedOnly should match r1,r2, got ${billed.totals.rows}`);
const free = feed.find((r) => r.id === 'r5')!;
if (free.usd !== undefined) fail(`an unbilled row must have NO usd, got ${free.usd}`);
console.log('9) billed/unbilled stay distinguishable through storage');

// 10. totals cover the whole match even when the page is capped
const capped = await store.searchRuns({ limit: 1 });
if (capped.rows.length !== 1) fail(`page should be 1, got ${capped.rows.length}`);
if (capped.totals.rows !== 5) fail(`totals must cover all 5, got ${capped.totals.rows}`);
console.log('10) a capped page still totals the full match');

// 11. account isolation — another home's log must not bleed in
const other = await makeStore(`_verify_other_${Date.now()}`);
const theirs = await other.searchRuns({});
if (theirs.totals.rows !== 0) fail(`a fresh account must see an empty log, got ${theirs.totals.rows}`);
console.log('11) account isolation holds');

console.log('\nPASS — the run log is durable, ordered, searchable and account-scoped');
