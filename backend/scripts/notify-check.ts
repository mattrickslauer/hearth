/**
 * Verifies per-account notification channels end to end:
 *   A) store round-trip — a saved config survives and reads back intact,
 *   B) validation — malformed bot tokens / addresses are rejected at the door, and a save
 *      that omits the bot token KEEPS the stored one (the dashboard only ever sees a hint),
 *   C) redaction — the live bot token never appears in what the dashboard can read,
 *   D) delivery — the Telegram call is shaped right and hits the ACCOUNT's token/chat, each
 *      channel is independent, and a fire is recorded on the activity feed,
 *   E) the real HTTP surface — GET/POST /notify/config and POST /hub/notify, over the actual
 *      server with real session + hub tokens.
 *
 * Runs fully offline: outbound fetch is stubbed, so no message is ever really sent.
 *
 *   npm run notify-check
 */

import '../src/env.ts';

// The server refuses to boot without a session secret; set one before importing anything
// that reads it at module load.
process.env.AUTH_SESSION_SECRET ||= 'notify-check-secret-key-0123456789';
process.env.HEARTH_STORE = 'memory';
delete process.env.ZEPTOMAIL_SMTP_PASS; // force email's dev/console path — never send real mail

const { makeStore } = await import('../src/store.ts');
const { applyNotifyConfig, redactNotifyConfig, deliverNotification, emptyNotifyConfig, notifyChannels } = await import(
  '../src/notify.ts'
);

const TOKEN = '123456789:AAEhBOweik6ad9r_ZoVGoWQdz3jjLhpQTA4';
const TOKEN2 = '987654321:BBFiCPxfjl7be0s_ApWHpXRea4kkMiqRUB5';
const CHAT = '-1001234567890';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// Intercept every outbound call so nothing leaves this process.
interface Sent {
  url: string;
  body: Record<string, unknown>;
}
const sent: Sent[] = [];
let telegramOk = true;
type FetchArgs = Parameters<typeof fetch>;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: FetchArgs[0], init?: FetchArgs[1]) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/')) {
    sent.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: telegramOk }), { status: telegramOk ? 200 : 401 });
  }
  return realFetch(url, init);
}) as typeof fetch;

// ── A) store round-trip ──────────────────────────────────────────────────────
console.log('A) store round-trip');
const store = await makeStore('acct-notify-check');
check('a fresh account has no channels', notifyChannels(await store.getNotifyConfig()).length === 0);
await store.setNotifyConfig({ telegram: { botToken: TOKEN, chatId: CHAT }, email: 'me@example.com', updatedAt: 1 });
const back = await store.getNotifyConfig();
check('telegram + email read back intact', back.telegram?.botToken === TOKEN && back.telegram?.chatId === CHAT && back.email === 'me@example.com');
check('notifyChannels reports both', notifyChannels(back).join(',') === 'telegram,email', notifyChannels(back).join(','));

// ── B) validation + token preservation ───────────────────────────────────────
console.log('\nB) validation');
const err = (body: Record<string, unknown>, existing = emptyNotifyConfig()) => {
  const r = applyNotifyConfig(body, existing);
  return 'error' in r ? r.error : null;
};
check('rejects a malformed bot token', err({ telegram: { chatId: CHAT, botToken: 'not-a-token' } }) !== null);
check('rejects a chat id that is a bot token', err({ telegram: { chatId: TOKEN, botToken: TOKEN } }) !== null);
check('rejects a bad email', err({ email: 'nope' }) !== null);
check('rejects telegram with no token and none stored', err({ telegram: { chatId: CHAT } }) !== null);
check('accepts a well-formed pair', err({ telegram: { chatId: CHAT, botToken: TOKEN }, email: 'a@b.co' }) === null);

const existing = { telegram: { botToken: TOKEN, chatId: CHAT }, email: null, updatedAt: 1 };
const kept = applyNotifyConfig({ telegram: { chatId: '55' } }, existing);
check(
  'omitting botToken keeps the stored one (editing chat id must not wipe the bot)',
  'config' in kept && kept.config.telegram?.botToken === TOKEN && kept.config.telegram?.chatId === '55',
);
const replaced = applyNotifyConfig({ telegram: { chatId: CHAT, botToken: TOKEN2 } }, existing);
check('an explicit botToken replaces the stored one', 'config' in replaced && replaced.config.telegram?.botToken === TOKEN2);
const cleared = applyNotifyConfig({ telegram: null }, existing);
check('telegram: null forgets the bot entirely', 'config' in cleared && cleared.config.telegram === null);
const untouched = applyNotifyConfig({ email: 'x@y.co' }, existing);
check('omitting a key leaves that channel untouched', 'config' in untouched && untouched.config.telegram?.botToken === TOKEN);

// Turning the channel off must NOT destroy the bot token — a token costs a @BotFather round
// trip, and the card tells users to clear the chat id to pause notifications.
const paused = applyNotifyConfig({ telegram: { chatId: null } }, existing);
check(
  'clearing the chat id turns telegram off but KEEPS the bot token',
  'config' in paused && paused.config.telegram?.chatId === null && paused.config.telegram?.botToken === TOKEN,
);
check('a paused telegram is not a live channel', 'config' in paused && !notifyChannels(paused.config).includes('telegram'));
const resumed = applyNotifyConfig({ telegram: { chatId: CHAT } }, 'config' in paused ? paused.config : existing);
check(
  'resuming needs only the chat id back — no re-entering the token',
  'config' in resumed && resumed.config.telegram?.botToken === TOKEN && notifyChannels(resumed.config).includes('telegram'),
);

// ── C) redaction ─────────────────────────────────────────────────────────────
console.log('\nC) redaction');
const view = redactNotifyConfig({ telegram: { botToken: TOKEN, chatId: CHAT }, email: 'me@example.com', updatedAt: 1 });
const serialized = JSON.stringify(view);
check('the live bot token never appears in the dashboard view', !serialized.includes(TOKEN), serialized);
check('the hint still identifies which bot', view.telegram?.botTokenHint === '123456789:…QTA4', view.telegram?.botTokenHint);

// ── D) delivery ──────────────────────────────────────────────────────────────
console.log('\nD) delivery');
sent.length = 0;
const r1 = await deliverNotification(store, '🔥 Garage', 'Left open after dark', { questionId: 'q-1' });
check('one Telegram call went out', sent.length === 1, `${sent.length} call(s)`);
check("it used THIS ACCOUNT's bot token", sent[0]?.url.includes(TOKEN));
check("it used THIS ACCOUNT's chat id", sent[0]?.body.chat_id === CHAT);
check('the message carries title + body', String(sent[0]?.body.text).includes('Garage') && String(sent[0]?.body.text).includes('after dark'));
check('telegram reported delivered', r1.channels.find((c) => c.channel === 'telegram')?.delivered === true);
check(
  'email did NOT claim delivery without SMTP creds',
  r1.channels.find((c) => c.channel === 'email')?.delivered === false,
);
const events = await store.listEvents(10);
check('the fire is on the activity feed', events.some((e) => e.kind === 'notify' && e.questionId === 'q-1'));

// A dead bot token must not take the other channel down with it.
telegramOk = false;
const r2 = await deliverNotification(store, 'x', 'y');
check('a failing telegram is reported, not thrown', r2.channels.find((c) => c.channel === 'telegram')?.delivered === false);
check('the email channel still ran alongside it', r2.channels.some((c) => c.channel === 'email'));
// `ok` must not claim success when nothing left the building — callers branch on it.
check('ok is false when every channel failed', r2.ok === false);
telegramOk = true;

// A store read blip must not swallow the notification or lose the record of the attempt.
const flaky = await makeStore('acct-flaky');
flaky.getNotifyConfig = async () => {
  throw new Error('tablestore read blip');
};
const r4 = await deliverNotification(flaky, 'blip', 'y', { questionId: 'q-blip' });
check('a config-read failure does not throw', r4.channels.length === 0);
check('…and the attempt still reaches the activity feed', (await flaky.listEvents(5)).some((e) => e.questionId === 'q-blip'));

const bare = await makeStore('acct-no-channels');
const r3 = await deliverNotification(bare, 'x', 'y');
check('an account with no channels delivers nothing (and does not throw)', r3.channels.length === 0 && r3.delivered === 0);

// ── E) the real HTTP surface ─────────────────────────────────────────────────
console.log('\nE) HTTP routes');
// server.ts boots itself on import (FC's entrypoint contract) — point it at a test port first.
const PORT = 9387;
process.env.PORT = String(PORT);
await import('../src/server.ts');
const { issueSession, issueHubToken } = await import('../src/auth.ts');
const { getHubStore } = await import('../src/hubs.ts');
await new Promise((r) => setTimeout(r, 250)); // let the listener bind
const base = `http://127.0.0.1:${PORT}`;

const acct = { id: 'acct-http-check', email: 'http@example.com', createdAt: 1, lastLoginAt: 1 };
const session = issueSession(acct);
const call = async (path: string, init: RequestInit = {}) => {
  const res = await realFetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
};
const auth = { authorization: `Bearer ${session}` };

const unauth = await call('/notify/config');
check('GET /notify/config requires a session', unauth.status === 401, `got ${unauth.status}`);

const empty = await call('/notify/config', { headers: auth });
check('GET returns an empty config for a new account', empty.status === 200 && empty.body.channels?.length === 0);

// The server owns its own store instance, so read the feed back the way the dashboard does.
const feed = async (): Promise<{ kind: string; questionId: string }[]> => {
  const r = await call('/mcp/call', { method: 'POST', headers: auth, body: JSON.stringify({ tool: 'list_events', args: { limit: 20 } }) });
  const out = r.body.result ?? r.body;
  return (Array.isArray(out) ? out : (out?.events ?? [])) as { kind: string; questionId: string }[];
};

// A rejected test must leave no trace — an activity row saying "notified" for a 400 is a lie.
const noChan = await call('/notify/test', { method: 'POST', headers: auth });
check('POST /notify/test with no channels 400s', noChan.status === 400, `got ${noChan.status}`);
check('…and writes NO activity row for the rejected test', !(await feed()).some((e) => e.kind === 'notify'));

const bad = await call('/notify/config', { method: 'POST', headers: auth, body: JSON.stringify({ telegram: { chatId: CHAT, botToken: 'junk' } }) });
check('POST rejects a malformed token with 400 + a reason', bad.status === 400 && typeof bad.body.error === 'string', bad.body.error);

const saved = await call('/notify/config', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ telegram: { chatId: CHAT, botToken: TOKEN }, email: 'me@example.com' }),
});
check('POST saves both channels', saved.status === 200 && saved.body.channels?.join(',') === 'telegram,email', JSON.stringify(saved.body.channels));
check('the POST response is redacted', !JSON.stringify(saved.body).includes(TOKEN));

const reread = await call('/notify/config', { headers: auth });
check('GET reads the saved config back, redacted', reread.body.config?.telegram?.chatId === CHAT && !JSON.stringify(reread.body).includes(TOKEN));

sent.length = 0;
const tested = await call('/notify/test', { method: 'POST', headers: auth });
check('POST /notify/test actually sends', tested.status === 200 && sent.length === 1, `${sent.length} call(s)`);
// Positive control: proves the "no row for a rejected test" check above can actually SEE rows,
// rather than passing because the feed read is broken.
check('a test that DID send is on the activity feed', (await feed()).some((e) => e.kind === 'notify'));

// The hub path: a real hub token for a real claimed hub.
const hub = {
  id: 'hub-check-1',
  accountId: acct.id,
  name: 'check-hub',
  enrollTokenHash: 'x',
  claimCode: null,
  claimExpiresAt: null,
  status: 'claimed' as const,
  createdAt: Date.now(),
  lastSeenAt: null,
};
await getHubStore().create(hub);
const hubToken = issueHubToken(hub.id, acct.id);

const noTok = await call('/hub/notify', { method: 'POST', body: JSON.stringify({ title: 't', message: 'm' }) });
check('POST /hub/notify rejects a missing hub token', noTok.status === 401, `got ${noTok.status}`);

const wrongAcct = await call('/hub/notify', {
  method: 'POST',
  headers: { authorization: `Bearer ${issueHubToken(hub.id, 'someone-else')}` },
  body: JSON.stringify({ title: 't', message: 'm' }),
});
check("a hub token for another account can't notify this one", wrongAcct.status === 403, `got ${wrongAcct.status}`);

sent.length = 0;
const fired = await call('/hub/notify', {
  method: 'POST',
  headers: { authorization: `Bearer ${hubToken}` },
  body: JSON.stringify({ title: '🔥 Garage', message: 'Left open after dark', questionId: 'q-hub' }),
});
check('a paired hub fires a notification through the cloud', fired.status === 200 && sent.length === 1, `status ${fired.status}, ${sent.length} call(s)`);
check("it reached the ACCOUNT's telegram, not an env var", sent[0]?.url.includes(TOKEN) && sent[0]?.body.chat_id === CHAT);

console.log(`\n${failures ? `FAIL — ${failures} check(s) failed.` : 'OK — all notification checks passed.'}`);
process.exit(failures ? 1 : 0);
