#!/usr/bin/env node
/**
 * hub/tools/notify-selftest.mjs — prove where a fired watch's push actually goes.
 *
 * The hub has two independent sets of notification channels: the ACCOUNT's (Telegram / email,
 * set in the dashboard, delivered via the cloud) and this MACHINE's (NTFY_TOPIC /
 * TELEGRAM_BOT_TOKEN env vars, pushed direct). Both run on every fire. This asserts the
 * properties that are easy to break and expensive to notice, because the failure mode is
 * silence — a homeowner only finds out when a push they were counting on never arrives:
 *
 *   1. adding an account channel does NOT silently stop the local ntfy push,
 *   2. a cloud outage still delivers locally (the off-grid guarantee),
 *   3. an UNPAIRED hub doesn't claim a cloud channel it can't actually use,
 *   4. nothing is reported delivered unless the provider accepted it.
 *
 * Run:  node hub/tools/notify-selftest.mjs
 * Exits non-zero on failure. No network: outbound fetch is stubbed.
 */

// notify.mjs snapshots its env channels at module load, so the topic must exist BEFORE the
// import is evaluated — hence the dynamic import rather than a static one.
process.env.NTFY_TOPIC ||= 'hearth-selftest';
const { notify, notifyChannels, setCloudNotifier } = await import('../notify.mjs');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// Stub the network: record ntfy/Telegram calls, never leave the process.
const hits = [];
let providerOk = true;
globalThis.fetch = async (url) => {
  hits.push(String(url));
  return new Response('', { status: providerOk ? 200 : 500 });
};

console.log('notify channels');

// 1. The regression that matters most: local + cloud are independent, not fallback.
setCloudNotifier(async () => ({ ok: true, channels: [{ channel: 'email', delivered: true }] }), { ready: () => true });
hits.length = 0;
let results = await notify('🔥 Nursery', 'over 78');
check('the account channel delivers', results.some((r) => r.channel === 'email' && r.delivered));
check('the local ntfy push still fires alongside it', hits.some((u) => u.includes('/hearth-selftest')));
check('both channels are reported', results.length === 2, `${results.length} channel(s)`);

// 2. Off-grid: the cloud is down, the local push must still land.
setCloudNotifier(async () => {
  throw new Error('backend unreachable');
}, { ready: () => true });
hits.length = 0;
results = await notify('🔥 Nursery', 'over 78');
check('a cloud outage still delivers locally', hits.some((u) => u.includes('/hearth-selftest')));
check('a cloud outage does not throw', Array.isArray(results));

// 3. An unpaired hub must not claim a channel it can't use — otherwise the startup log tells
//    the operator notifications are wired up while every fire reaches nobody.
setCloudNotifier(async () => null, { ready: () => false });
check('an unpaired hub reports no cloud channel', !notifyChannels().includes('cloud(account channels)'));
check('…but still reports its local one', notifyChannels().some((c) => c.startsWith('ntfy')));
setCloudNotifier(async () => null, { ready: () => true });
check('a paired hub does report the cloud channel', notifyChannels().includes('cloud(account channels)'));

// 4. Never claim a delivery the provider rejected.
setCloudNotifier(null);
providerOk = false;
results = await notify('🔥 Nursery', 'over 78');
check('a rejected push is reported undelivered', results.every((r) => !r.delivered));
providerOk = true;

console.log(`\n${failures ? `FAIL — ${failures} check(s) failed.` : 'OK — hub notify selftest passed.'}`);
process.exit(failures ? 1 : 0);
