/**
 * LIVE Tablestore check — exercises the real TablestoreStore adapter against the
 * provisioned instance: create table (idempotent) → put/get/list/delete a Question.
 * Reads creds from env. Not part of CI; run manually after provisioning.
 */
process.env.AUTH_SESSION_SECRET ??= 'ts-live-check-secret-0123456789abcd';

import { makeStore } from '../src/store.ts';
import type { Question } from '../src/domain.ts';

const account = 'ts-live-check';
const store = await makeStore(account);

const q = {
  id: 'q-live-1',
  text: 'Warn me if the garage is left open after dark.',
  title: 'Garage watch',
  boundInputs: ['garage.door'],
  trigger: 'garage open after dark',
  action: 'notify me',
  actuates: [],
  usesVision: false,
  runsLocally: true,
  cost: 'none',
  compiledTo: 'local',
  compiledSpec: { kind: 'local', local: { expr: { op: 'eq', left: { input: 'garage.door' }, right: true } } },
  evalOn: 'event',
  fire: { edge: 'rising', cooldown: '5m' },
} as unknown as Question;

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };

await store.putQuestion(q);
const got = await store.getQuestion('q-live-1');
ok('put→get round-trips through Tablestore', !!got && got.id === 'q-live-1' && got.title === 'Garage watch');

const list = await store.listQuestions();
ok('listQuestions returns the row', list.some((x) => x.id === 'q-live-1'));

const del = await store.deleteQuestion('q-live-1');
ok('delete returns true for existing', del === true);
ok('get after delete is null', (await store.getQuestion('q-live-1')) === null);
ok('delete of missing returns false', (await store.deleteQuestion('q-live-1')) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
