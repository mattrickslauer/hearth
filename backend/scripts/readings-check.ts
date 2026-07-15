/**
 * Proves live readings are durable in Tablestore, not stranded on one Function Compute
 * instance's heap. Exits non-zero if they aren't.
 *
 *   set -a; . ./.env; set +a; HEARTH_STORE=tablestore npm run readings-check
 *
 * Scoped to a throwaway account partition; the rows it writes self-expire via the
 * hearth_readings table's 24h TTL, so there is nothing to clean up.
 */
import { makeStore } from '../src/store';

const acct = `_verify_${Date.now()}`;
const fail = (m: string) => {
  console.error(`FAIL — ${m}`);
  process.exit(1);
};

const store = await makeStore(acct);
console.log(`store: ${store.constructor.name} (account ${acct})`);
if (store.constructor.name !== 'TablestoreStore') fail(`expected TablestoreStore, got ${store.constructor.name}`);

const now = Date.now();
const input = 'node1.board_temp';

// 1. write a series spanning 3h
await store.appendReading(input, 20, now - 3 * 3600_000);
await store.appendReading(input, 22, now - 2 * 3600_000);
await store.appendReading(input, 24, now - 60_000);
await store.appendReading('node1.other', 99, now - 60_000); // must not bleed into node1.board_temp
console.log('1) wrote 4 readings');

// 2. latest (backward scan, limit 1) — the dashboard hot path
const latest = await store.readInput(input, 'latest', 0, now);
console.log(`2) latest = ${JSON.stringify(latest)}`);
if (latest?.value !== 24) fail(`latest should be 24 (newest), got ${latest?.value}`);

// 3. latest must not leak the neighbouring input's row
const other = await store.readInput('node1.other', 'latest', 0, now);
if (other?.value !== 99) fail(`neighbour input isolation broken, got ${other?.value}`);
console.log('3) input isolation holds');

// 4. windowed aggregate — only the last 90m of rows should count
const mean90 = await store.readInput(input, 'mean', 90 * 60_000, now);
console.log(`4) mean(90m) = ${JSON.stringify(mean90)}`);
if (mean90?.value !== 24) fail(`mean over 90m should see only the 24 sample, got ${mean90?.value}`);

const mean4h = await store.readInput(input, 'mean', 4 * 3600_000, now);
console.log(`   mean(4h) = ${JSON.stringify(mean4h)}`);
if (mean4h?.value !== 22) fail(`mean over 4h should be (20+22+24)/3=22, got ${mean4h?.value}`);

// 5. latest outside the window must be null, not a stale value
const stale = await store.readInput(input, 'latest', 30_000, now);
if (stale !== null) fail(`latest within 30s window should be null, got ${JSON.stringify(stale)}`);
console.log('5) out-of-window latest correctly null');

// 6. history inclusive bounds
const hist = await store.history(input, now - 3 * 3600_000, now);
console.log(`6) history = ${hist.map((r) => r.value).join(',')}`);
if (hist.length !== 3) fail(`history should return 3 rows, got ${hist.length}`);
if (hist[0].value !== 20 || hist[2].value !== 24) fail('history must be chronological');

// 7. cross-instance durability: a SECOND store object = a different FC instance's heap
const store2 = await makeStore(acct);
const fromOtherInstance = await store2.readInput(input, 'latest', 0, Date.now());
console.log(`7) fresh store sees: ${JSON.stringify(fromOtherInstance)}`);
if (fromOtherInstance?.value !== 24) fail('readings did NOT survive a fresh store — still instance-local!');

console.log('\nPASS — readings are durable, ordered, window-correct, and instance-independent.');
