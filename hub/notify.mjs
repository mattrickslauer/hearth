/**
 * hub/notify.mjs — real phone notifications from the hub.
 *
 * Two INDEPENDENT sets of channels, both attempted on every fire:
 *
 *   • CLOUD (the normal path) — POST the fire to Hearth Cloud (/hub/notify), which fans it out
 *     to the channels the homeowner saved in the dashboard (Telegram / email, per account).
 *     Nothing to configure on the hub, and their bot token stays in the cloud rather than in a
 *     file on this box. hub.mjs installs the sender — see setCloudNotifier.
 *
 *   • LOCAL env vars — a direct push from this machine, configured by whoever runs the hub:
 *        • ntfy     — install the free ntfy app, subscribe to a topic, done. No account, no
 *                     token. Set NTFY_TOPIC (any hard-to-guess string) to enable.
 *        • Telegram — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable.
 *
 * Both always run, rather than local being a fallback only tried when the cloud fails. Two
 * reasons: an operator who set NTFY_TOPIC must not silently stop getting ntfy pushes the day
 * someone adds an email in the dashboard, and a local channel that always fires is what makes
 * the off-grid guarantee real — no cloud round-trip sits between a fire and the push.
 *
 * If nothing is configured anywhere, notify() is a no-op that logs locally — the fire still
 * happens (actuation, activity), you just don't get a push. Nothing is faked: a channel only
 * reports delivered when the provider accepted the message.
 */

const NTFY_URL = (process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/$/, '');
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';

// Installed by hub.mjs: async (title, message, meta) → { ok, channels, delivered }, or null when
// the call didn't land. Kept as a hook so notify.mjs stays free of cloud/auth deps.
let cloudNotifier = null;
// Whether the cloud path can actually be used right now (i.e. we're paired). Without this,
// notifyChannels() would claim a cloud channel on a hub that has never paired — telling the
// operator notifications are wired up when every fire would silently reach nobody.
let cloudReady = () => false;

/**
 * Point notifications at Hearth Cloud (the account's own channels). `ready` is polled, not
 * captured, so pairing/unpairing is reflected without re-registering. Pass null to unset.
 */
export function setCloudNotifier(fn, { ready } = {}) {
  cloudNotifier = typeof fn === 'function' ? fn : null;
  cloudReady = cloudNotifier ? (typeof ready === 'function' ? ready : () => true) : () => false;
}

export function notifyChannels() {
  const on = [];
  if (cloudNotifier && cloudReady()) on.push('cloud(account channels)');
  if (NTFY_TOPIC) on.push(`ntfy(${NTFY_TOPIC})`);
  if (TG_TOKEN && TG_CHAT) on.push('telegram');
  return on;
}

// HTTP headers are Latin-1 only — strip emoji/multibyte from the ntfy Title
// (the 🔥 still renders via the Tags header; the body keeps full UTF-8).
const headerSafe = (s) => String(s).replace(/[^\x20-\x7E]/g, '').trim() || 'Hearth';

async function viaNtfy(title, message) {
  if (!NTFY_TOPIC) return null;
  try {
    const res = await fetch(`${NTFY_URL}/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: 'POST',
      headers: { Title: headerSafe(title), Priority: 'high', Tags: 'fire' },
      body: message,
    });
    return { channel: 'ntfy', delivered: res.ok, status: res.status };
  } catch (e) {
    return { channel: 'ntfy', delivered: false, error: e.message };
  }
}

async function viaTelegram(title, message) {
  if (!TG_TOKEN || !TG_CHAT) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: `${title}\n${message}` }),
    });
    return { channel: 'telegram', delivered: res.ok, status: res.status };
  } catch (e) {
    return { channel: 'telegram', delivered: false, error: e.message };
  }
}

const logResults = (results, via) => {
  for (const r of results) {
    const tag = r.delivered ? '✓' : '✗';
    console.log(`[notify] ${tag} ${via}:${r.channel}${r.status ? ` (${r.status})` : ''}${r.error ? ` — ${r.error}` : ''}`);
  }
};

/** The account's channels, via the cloud. Never throws — a cloud outage is not a hub crash. */
async function viaCloud(title, message, meta) {
  if (!cloudNotifier) return [];
  try {
    // null = the call never landed (not paired, or the backend said no). Not an error, and not
    // evidence the account has no channels — just nothing delivered this way.
    const r = await cloudNotifier(title, message, meta);
    return r?.channels ?? [];
  } catch (e) {
    console.log(`[notify] cloud notify failed — ${e.message}`);
    return [];
  }
}

/**
 * Deliver a notification over every channel configured anywhere — the account's (via the
 * cloud) and this machine's (via env vars) — concurrently. Returns per-channel results.
 */
export async function notify(title, message, meta = {}) {
  const [cloud, ...local] = await Promise.all([
    viaCloud(title, message, meta),
    viaNtfy(title, message),
    viaTelegram(title, message),
  ]);

  logResults(cloud, 'cloud');
  const localResults = local.filter(Boolean);
  logResults(localResults, 'local');

  const results = [...cloud, ...localResults];
  if (!results.length) console.log(`[notify] (no channel configured) ${title} — ${message}`);
  return results;
}
