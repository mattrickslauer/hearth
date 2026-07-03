/**
 * Smoke test — exercises the real store + tool catalog + (mock) brain end to end.
 * No Alibaba creds, no network: proves the authoring→persist→read round trip that
 * the cloud deploy will run unchanged (with Qwen + Tablestore swapped in).
 */

// Auth has no fallback secret — give the hermetic run a fixed one (a real env wins).
process.env.AUTH_SESSION_SECRET ??= 'smoke-test-session-secret-0123456789';

import { MemoryStore } from '../src/store.ts';
import { TOOL_BY_NAME, type ToolCtx } from '../src/tools.ts';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) pass++;
  else {
    fail++;
    console.log('  ✗ ' + name);
  }
};

const ctx: ToolCtx = { store: new MemoryStore() };
const call = (tool: string, args: Record<string, unknown> = {}) => TOOL_BY_NAME.get(tool)!.handler(args, ctx);

const home = (await call('describe_home')) as { zones: unknown[]; nodes: unknown[]; capabilities: unknown[] };
ok('describe_home returns zones', home.zones.length > 0);
ok('describe_home returns nodes', home.nodes.length > 0);
ok('describe_home returns capabilities', home.capabilities.length > 0);

const inputs = (await call('list_inputs', { filter: 'sensor' })) as { id: string; kind: string }[];
ok('list_inputs sensors only', inputs.length > 0 && inputs.every((c) => c.kind === 'sensor'));
ok('list_inputs includes garage.door', inputs.some((c) => c.id === 'garage.door'));

// authoring: a temporal LOCAL question
const g = (await call('author_question', { wish: 'Warn me if the garage is left open for more than 5 minutes.' })) as {
  question: { compiledTo: string; compiledSpec: { kind: string }; runsLocally: boolean };
};
ok('garage wish → local compile', g.question.compiledTo === 'local' && g.question.compiledSpec.kind === 'local');
ok('garage wish runs locally', g.question.runsLocally === true);

// authoring: a VISION cloud question carries a Record policy (the frame rate)
const v = (await call('author_question', { wish: "Tell me if someone who isn't family is at the front door." })) as {
  question: { compiledTo: string; usesVision: boolean; record?: { every: string; mode: string } };
};
ok('door wish → cloud_vl compile', v.question.compiledTo === 'cloud_vl' && v.question.usesVision === true);
ok('cloud question has a Record policy (frame rate)', !!v.question.record && !!v.question.record.every);

// reading round trip
await ctx.store.appendReading('garage.temp', 3, Date.now());
const r = (await call('read_input', { input: 'garage.temp', agg: 'latest' })) as { value: number } | null;
ok('read_input latest garage.temp', !!r && r.value === 3);

// record policy edit
const rec = (await call('set_record', { inputId: 'camera.frame', mode: 'interval', every: '2s', retain: 12 })) as {
  record: { mode: string; every: string; retain: number };
};
ok('set_record persists metered policy', rec.record.mode === 'interval' && rec.record.every === '2s' && rec.record.retain === 12);

// suggestions + persistence count
const sug = (await call('suggest_runs')) as { suggestions: string[] };
ok('suggest_runs proposes questions', sug.suggestions.length >= 2);
const qs = await ctx.store.listQuestions();
ok('two questions persisted', qs.length === 2);

// actuate + notify report their (unprovisioned) shapes without throwing
const act = (await call('actuate', { input: 'garage.door', value: 'closed', reason: 'coyote in frame' })) as { status: string };
ok('actuate returns a shadow-command shape', act.status === 'sent');
const not = (await call('notify', { channelId: 'expo_push', message: 'hi' })) as { ok: boolean };
ok('notify returns ok', not.ok === true);

// ---- auth: OTP verify + session (hermetic; email uses console fallback) --------
const { MemoryOtpStore, MemoryAccountStore, requestOtp, verifyOtp, issueSession, verifySession, normalizeEmail } =
  await import('../src/auth.ts');

ok('normalizeEmail lowercases + trims', normalizeEmail('  Foo@Bar.COM ') === 'foo@bar.com');
ok('normalizeEmail rejects junk', normalizeEmail('nope') === null);

const session = issueSession({ id: 'acct-1', email: 'a@b.co', createdAt: 0, lastLoginAt: 0 });
const decoded = verifySession(session);
ok('session roundtrips', decoded?.sub === 'acct-1' && decoded?.email === 'a@b.co');
ok('tampered session rejected', verifySession(session.slice(0, -2) + 'xx') === null);
ok('missing session rejected', verifySession(undefined) === null);

// full OTP flow: capture the console-logged dev code, then verify
const authDeps = { otp: new MemoryOtpStore(), accounts: new MemoryAccountStore() };
let devCode = '';
const origLog = console.log;
console.log = (...a: unknown[]) => {
  const m = a.join(' ').match(/= (\d{6})/);
  if (m) devCode = m[1];
};
const req = await requestOtp(authDeps, 'user@hearth.test');
console.log = origLog;
ok('requestOtp ok (dev console fallback)', req.ok === true && req.delivered === false);
ok('captured a 6-digit dev code', /^\d{6}$/.test(devCode));
const bad = await verifyOtp(authDeps, 'user@hearth.test', '000000');
ok('wrong code rejected', bad.ok === false);
const good = await verifyOtp(authDeps, 'user@hearth.test', devCode);
ok('correct code → token + account', good.ok === true && !!good.token && good.account?.email === 'user@hearth.test');
const reuse = await verifyOtp(authDeps, 'user@hearth.test', devCode);
ok('code is one-time-use', reuse.ok === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
