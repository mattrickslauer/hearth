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

// Seed the legacy demo world so describe_home/list_inputs have zones+devices to
// assert against (a fresh per-account home is intentionally empty — see MemoryStore).
// The hub-sync block at the end covers the empty-home → real-device path.
const ctx: ToolCtx = { store: new MemoryStore(true) };
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

// ---- watch CRUD: edit recompiles in place, delete removes --------------------
const made = (await call('author_question', {
  wish: 'Warn me if the garage is left open for more than 5 minutes.',
})) as { questionId: string; question: { compiledTo: string } };
ok('author returns an id', typeof made.questionId === 'string' && made.questionId.length > 0);
ok('authored watch is local', made.question.compiledTo === 'local');
const beforeCount = (await ctx.store.listQuestions()).length;

// edit the SAME watch with a vision wish → must recompile (local → cloud_vl) + keep id
const upd = (await call('update_question', {
  id: made.questionId,
  wish: "Tell me if someone who isn't family is at the front door.",
})) as { questionId: string; question: { compiledTo: string; usesVision: boolean } };
ok('update keeps the same id', upd.questionId === made.questionId);
ok('update recompiles the plan (local → cloud_vl)', upd.question.compiledTo === 'cloud_vl' && upd.question.usesVision === true);
ok('update does not add a new watch', (await ctx.store.listQuestions()).length === beforeCount);
const stored = await ctx.store.getQuestion(made.questionId);
ok('update persisted the recompiled watch', !!stored && stored.compiledTo === 'cloud_vl');
let updThrew = false;
try {
  await call('update_question', { id: 'q-nope', wish: 'x' });
} catch {
  updThrew = true;
}
ok('update of unknown id throws', updThrew);

// delete removes it (and only it)
const del = (await call('delete_question', { id: made.questionId })) as { ok: boolean };
ok('delete returns ok', del.ok === true);
ok('delete removed the watch', (await ctx.store.getQuestion(made.questionId)) === null);
ok('delete decremented the count', (await ctx.store.listQuestions()).length === beforeCount - 1);
let delThrew = false;
try {
  await call('delete_question', { id: made.questionId });
} catch {
  delThrew = true;
}
ok('delete of unknown id throws', delThrew);

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

// JWT hardening: standard 3-segment HS256, alg pinned, iss/aud/exp enforced
const { createHmac } = await import('node:crypto');
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mkJwt = (payload: object, header: object = { alg: 'HS256', typ: 'JWT' }) => {
  const si = `${b64(header)}.${b64(payload)}`;
  return `${si}.${createHmac('sha256', process.env.AUTH_SESSION_SECRET!).update(si).digest('base64url')}`;
};
const nowS = Math.floor(Date.now() / 1000);
const base = { sub: 'x', email: 'e@x.co', iss: 'hearth', aud: 'hearth-app', iat: nowS, exp: nowS + 100 };

ok('token is a 3-part JWT', session.split('.').length === 3);
{
  const hdr = JSON.parse(Buffer.from(session.split('.')[0], 'base64url').toString());
  ok('JWT header is HS256/JWT', hdr.alg === 'HS256' && hdr.typ === 'JWT');
}
ok('valid crafted JWT accepted', verifySession(mkJwt(base))?.sub === 'x');
ok('alg:none forgery rejected', verifySession(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(base)}.`) === null);
ok('alg mismatch in header rejected', verifySession(mkJwt(base, { alg: 'HS512', typ: 'JWT' })) === null);
ok('expired JWT rejected', verifySession(mkJwt({ ...base, iat: nowS - 200, exp: nowS - 10 })) === null);
ok('wrong audience rejected', verifySession(mkJwt({ ...base, aud: 'evil-app' })) === null);
ok('wrong issuer rejected', verifySession(mkJwt({ ...base, iss: 'evil' })) === null);
ok('missing sub rejected', verifySession(mkJwt({ ...base, sub: '' })) === null);
{
  // signature from a DIFFERENT secret must not verify
  const si = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(base)}`;
  const forged = `${si}.${createHmac('sha256', 'some-other-secret-key-1234').update(si).digest('base64url')}`;
  ok('wrong-secret signature rejected', verifySession(forged) === null);
}

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

// ---- hub → cloud device sync: a paired hub's REAL nodes flow into an EMPTY home,
//      and become visible/queryable through the existing tools -------------------
const { syncHubDevices } = await import('../src/hub-devices.ts');
const hubStore = new MemoryStore(); // an empty production home
const hubCtx: ToolCtx = { store: hubStore };
const hcall = (tool: string, args: Record<string, unknown> = {}) => TOOL_BY_NAME.get(tool)!.handler(args, hubCtx);

const payload = {
  platform: 'linux',
  nodes: [
    {
      id: 'node-A442FB38BCD8',
      describe: {
        board: 'esp32-wroom-32',
        fw: '0.1.0',
        sensors: [
          { key: 'board.temp', kind: 'temperature', unit: 'C' },
          { key: 'dht.temp', kind: 'temperature', unit: 'C' },
        ],
      },
      lastReading: { 'board.temp': 46.7, 'dht.temp': null },
    },
    {
      // A MOTOR NODE: self-describes an actuator the cloud can command (cloud→node).
      id: 'node-MOTOR001',
      describe: {
        board: 'esp32-wroom-32',
        fw: '0.1.0',
        sensors: [{ key: 'board.temp', kind: 'temperature', unit: 'C' }],
        actuators: [{ key: 'motor', kind: 'relay', state: 'off' }],
      },
      lastReading: { 'board.temp': 44.1, 'motor.state': 0 },
    },
  ],
};
const HUB_ID = 'hub-mr5m9h8j-1';
const sync = await syncHubDevices(hubStore, { hubId: HUB_ID, hubName: 'Simulated Pi' }, payload);
ok('syncHubDevices registers both nodes', sync.nodes === 2);
ok('syncHubDevices writes numeric readings only (skips null)', sync.readings === 3); // board.temp×2 + motor.state
ok('sync returns an (empty) command downlink', Array.isArray(sync.commands) && sync.commands.length === 0);

const hhome = (await hcall('describe_home')) as { nodes: { id: string }[]; capabilities: { id: string }[] };
ok('describe_home surfaces the real node', hhome.nodes.some((n) => n.id === 'node-A442FB38BCD8'));
ok('describe_home surfaces its capability', hhome.capabilities.some((c) => c.id === 'node-A442FB38BCD8.board.temp'));

const hdev = (await hcall('list_hub_devices')) as { hubId: string; nodes: { id: string }[] }[];
ok('list_hub_devices returns the paired hub + node', hdev.length === 1 && hdev[0].nodes[0]?.id === 'node-A442FB38BCD8');

const hread = (await hcall('read_input', { input: 'node-A442FB38BCD8.board.temp', agg: 'latest' })) as { value: number } | null;
ok('read_input returns the live hardware reading', !!hread && hread.value === 46.7);

const hinputs = (await hcall('list_inputs', { filter: 'sensor' })) as { id: string }[];
ok('list_inputs includes the hub sensor (bindable by Qwen)', hinputs.some((c) => c.id === 'node-A442FB38BCD8.board.temp'));

// ---- cloud → node actuation: the motor node's relay is commandable end to end ----
const hact = (await hcall('list_inputs', { filter: 'actuator' })) as { id: string; kind: string }[];
ok('list_inputs surfaces the motor actuator', hact.some((c) => c.id === 'node-MOTOR001.motor' && c.kind === 'actuator'));
ok('describe_home carries the actuator capability', hhome.capabilities.some((c) => c.id === 'node-MOTOR001.motor'));

// actuate a REAL hub node → queues a desired command (not the unprovisioned stub)
const on = (await hcall('actuate', { input: 'node-MOTOR001.motor', value: 'on', reason: 'demo: spin the fan' })) as {
  status: string;
  provisioned: boolean;
  hubId: string;
  desired: string;
};
ok('actuate on a live node is provisioned + queued', on.status === 'queued' && on.provisioned === true);
ok('actuate resolves the owning hub', on.hubId === HUB_ID && on.desired === 'on');

// the desired state is stored and flows to THIS hub as a downlink command
const pending = await hubStore.listCommands(HUB_ID);
ok('desired command is stored for the hub', pending.length === 1 && pending[0].nodeId === 'node-MOTOR001' && pending[0].on === true);
const sync2 = await syncHubDevices(hubStore, { hubId: HUB_ID, hubName: 'Simulated Pi' }, payload);
ok('next sync hands the hub the motor command', sync2.commands.length === 1 && sync2.commands[0].value === 'on');
ok('downlink targets the motor node', sync2.commands[0].nodeId === 'node-MOTOR001' && sync2.commands[0].key === 'motor');

// commanding OFF overwrites the desired state (device-shadow upsert, not append)
await hcall('actuate', { input: 'node-MOTOR001.motor', value: false, reason: 'demo: stop' });
const off = await hubStore.listCommands(HUB_ID);
ok('actuate off upserts (still one command, now off)', off.length === 1 && off[0].on === false);

// actuating an input with no live hub actuator falls back to the recorded-intent stub
const stub = (await hcall('actuate', { input: 'node-MOTOR001.nope', value: 'on', reason: 'no such actuator' })) as {
  status: string;
  provisioned: boolean;
};
ok('unknown actuator falls back to recorded intent', stub.status === 'sent' && stub.provisioned === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
