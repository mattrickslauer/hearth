/**
 * hub/notify.mjs — real phone notifications from the hub.
 *
 * Two zero-friction channels, both genuinely reaching a phone:
 *   • ntfy   — install the free ntfy app, subscribe to a topic, done. No account,
 *              no token. Set NTFY_TOPIC (any hard-to-guess string) to enable.
 *   • Telegram — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable. Mirrors the
 *              backend's notify tool so the same message can land in a chat.
 *
 * If neither is configured, notify() is a no-op that logs locally — the fire
 * still happens (LED, activity), you just don't get a push. Nothing is faked:
 * a channel only reports delivered when the provider accepted the message.
 */

const NTFY_URL = (process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/$/, '');
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';

export function notifyChannels() {
  const on = [];
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

/** Fan a notification out to every configured channel. Returns per-channel results. */
export async function notify(title, message) {
  const results = (await Promise.all([viaNtfy(title, message), viaTelegram(title, message)])).filter(Boolean);
  for (const r of results) {
    const tag = r.delivered ? '✓' : '✗';
    console.log(`[notify] ${tag} ${r.channel}${r.status ? ` (${r.status})` : ''}${r.error ? ` — ${r.error}` : ''}`);
  }
  if (!results.length) console.log(`[notify] (no channel configured) ${title} — ${message}`);
  return results;
}
