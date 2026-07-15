/**
 * Per-account notification channels — "notify me" made real.
 *
 * A Question authored with `push: true` fires on the hub (hub/runtime.mjs). Until now the
 * only way to get that push onto a phone was env vars on the hub process (NTFY_TOPIC /
 * TELEGRAM_BOT_TOKEN), which meant one hard-coded destination for everyone and nothing a
 * homeowner could set from the dashboard.
 *
 * WHY PER-ACCOUNT, NOT PER-HUB: a person has one Telegram chat and one inbox, not one per
 * hub. Hubs get unpaired and re-claimed (hubs.ts), and re-entering a bot token each time
 * would be absurd. Decisively, the cloud-side `notify` tool (tools.ts) only ever has an
 * accountId in scope — no hub context at all — so per-account is the only place both the
 * hub-fired path and the tool-fired path can read the SAME record.
 *
 * WHY DELIVERY IS CLOUD-SIDE: the hub POSTs a fire to /hub/notify and we fan out from here.
 * That keeps the account's bot token in the cloud instead of shipping a live secret down to
 * every paired hub, and it's the only way email can work at all (the hub has no SMTP creds).
 * These channels do not replace the hub's own env-var ntfy/Telegram — a hub fires both sets on
 * every watch, so a direct push still lands when the cloud is unreachable. See hub/notify.mjs.
 */

import { mailFrom, smtp } from './mailer';
import type { HomeStore } from './store';

/**
 * What we store. `telegram.botToken` is a live secret — never leaves the backend un-redacted.
 *
 * `chatId: null` means "bot registered, channel off" — the token SURVIVES turning Telegram off.
 * Getting a bot token means a round-trip through @BotFather, so a homeowner clearing their chat
 * id to pause notifications must not silently destroy the credential; only an explicit
 * `telegram: null` (remove the bot entirely) does that.
 */
export interface NotifyConfig {
  telegram: { botToken: string; chatId: string | null } | null;
  email: string | null;
  updatedAt: number;
}

/** What the dashboard is allowed to read back — the bot token is reduced to a hint. */
export interface NotifyConfigView {
  telegram: { chatId: string | null; botTokenHint: string } | null;
  email: string | null;
  updatedAt: number;
}

export const emptyNotifyConfig = (): NotifyConfig => ({ telegram: null, email: null, updatedAt: 0 });

/**
 * Telegram bot tokens look like `123456789:AAE...` — a numeric bot id, a colon, then a
 * ~35-char secret. Validating the shape catches a paste of the wrong string (a chat id, an
 * API key) at the form instead of as a silent non-delivery three hours later.
 */
const TG_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
/** A chat id is a signed integer (user/group, groups are negative) or an @publicchannel. */
const TG_CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,})$/;
/** Deliberately permissive — the real proof an address works is the Send test button. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Show enough of the token to recognise WHICH bot, never enough to use it. */
const hint = (token: string): string => {
  const botId = token.split(':')[0] ?? '';
  return `${botId}:…${token.slice(-4)}`;
};

export function redactNotifyConfig(c: NotifyConfig): NotifyConfigView {
  return {
    telegram: c.telegram ? { chatId: c.telegram.chatId, botTokenHint: hint(c.telegram.botToken) } : null,
    email: c.email,
    updatedAt: c.updatedAt,
  };
}

/** Telegram can only send with BOTH halves — a registered bot and somewhere to send. */
const telegramLive = (c: NotifyConfig): c is NotifyConfig & { telegram: { botToken: string; chatId: string } } =>
  Boolean(c.telegram?.chatId);

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Fold a POSTed body into the stored config, validating each channel.
 *
 * Both channels are independently clearable by sending null/"". Because the dashboard only
 * ever SEES a redacted token, a save that omits `botToken` while keeping the same chatId
 * KEEPS the stored token — otherwise every edit of the chat id would silently wipe the bot.
 */
export function applyNotifyConfig(body: Record<string, unknown>, existing: NotifyConfig): { config: NotifyConfig } | { error: string } {
  const next: NotifyConfig = { ...existing, updatedAt: Date.now() };

  if ('telegram' in body) {
    const tg = body.telegram;
    if (tg === null || tg === '') {
      // Explicit removal — forget the bot entirely, token included.
      next.telegram = null;
    } else if (tg && typeof tg === 'object') {
      const raw = tg as Record<string, unknown>;
      // An empty/absent chatId switches the channel OFF but keeps the bot token (see NotifyConfig).
      const chatId = str(raw.chatId) || null;
      // Absent token + an existing one for this account = "keep the token I already saved".
      const botToken = str(raw.botToken) || existing.telegram?.botToken || '';
      if (!botToken) return { error: 'telegram.botToken required (create a bot with @BotFather)' };
      if (!TG_TOKEN_RE.test(botToken)) return { error: 'telegram.botToken looks malformed — expected "<botId>:<secret>" from @BotFather' };
      if (chatId && !TG_CHAT_RE.test(chatId)) return { error: 'telegram.chatId must be a number (e.g. 12345678) or an @channelname' };
      next.telegram = { botToken, chatId };
    } else {
      return { error: 'telegram must be an object or null' };
    }
  }

  if ('email' in body) {
    const email = body.email;
    if (email === null || email === '') {
      next.email = null;
    } else {
      const addr = str(email);
      if (!EMAIL_RE.test(addr)) return { error: 'email is not a valid address' };
      if (addr.length > 254) return { error: 'email is too long' };
      next.email = addr;
    }
  }

  return { config: next };
}

/** Which channels this account has switched on — mirrors hub/notify.mjs notifyChannels(). */
export function notifyChannels(c: NotifyConfig): string[] {
  const on: string[] = [];
  if (telegramLive(c)) on.push('telegram'); // a token with no chat id is registered, not on
  if (c.email) on.push('email');
  return on;
}

export interface DeliveryResult {
  channel: 'telegram' | 'email';
  delivered: boolean;
  status?: number;
  error?: string;
}

async function viaTelegram(c: NotifyConfig, title: string, message: string): Promise<DeliveryResult | null> {
  if (!telegramLive(c)) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${c.telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: c.telegram.chatId, text: `${title}\n${message}` }),
    });
    return { channel: 'telegram', delivered: res.ok, status: res.status };
  } catch (e) {
    return { channel: 'telegram', delivered: false, error: (e as Error).message };
  }
}

async function viaEmail(c: NotifyConfig, title: string, message: string): Promise<DeliveryResult | null> {
  if (!c.email) return null;
  const tx = smtp();
  if (!tx) {
    // Same contract as sendOtpEmail: log it, report delivered:false. Never claim a send.
    console.log(`[notify] DEV: email to ${c.email} — ${title}: ${message} (set ZEPTOMAIL_SMTP_PASS to actually send)`);
    return { channel: 'email', delivered: false, error: 'no ZEPTOMAIL_SMTP_PASS (dev mode — logged to console)' };
  }
  try {
    await tx.sendMail({
      from: mailFrom(),
      to: c.email,
      subject: title,
      text: message,
      html: `<div style="font-family:system-ui,sans-serif"><p style="font-size:18px;font-weight:600;margin:0 0 8px">${esc(title)}</p><p style="margin:0">${esc(message)}</p><p style="color:#888;font-size:12px;margin-top:24px">Sent by your Hearth hub. Change or turn off notifications in the dashboard.</p></div>`,
    });
    return { channel: 'email', delivered: true };
  } catch (e) {
    return { channel: 'email', delivered: false, error: (e as Error).message };
  }
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);

/**
 * Fan one notification out to every channel this account configured, and record it on the
 * activity feed (kind 'notify' — the dashboard already renders that row).
 *
 * Channels are independent: a dead bot token must not stop the email. Nothing is reported
 * delivered unless the provider actually accepted it.
 */
export async function deliverNotification(
  store: HomeStore,
  title: string,
  message: string,
  meta: { questionId?: string } = {},
): Promise<{ ok: boolean; channels: DeliveryResult[]; delivered: number }> {
  // A read blip must not swallow the whole notification: fall back to "no channels" so the
  // caller still gets a shape and the attempt still reaches the activity feed below.
  const config = await store.getNotifyConfig().catch((e) => {
    console.log(`[notify] could not read channels: ${(e as Error).message}`);
    return emptyNotifyConfig();
  });
  const results = (await Promise.all([viaTelegram(config, title, message), viaEmail(config, title, message)])).filter(
    (r): r is DeliveryResult => r !== null,
  );

  for (const r of results) {
    const tag = r.delivered ? '✓' : '✗';
    console.log(`[notify] ${tag} ${r.channel}${r.status ? ` (${r.status})` : ''}${r.error ? ` — ${r.error}` : ''}`);
  }
  if (!results.length) console.log(`[notify] (no channel configured) ${title} — ${message}`);

  const delivered = results.filter((r) => r.delivered).length;
  await store
    .appendEvent({
      id: `ev-notify-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      questionId: meta.questionId ?? 'runtime',
      kind: 'notify',
      reasoning: results.length
        ? `${title} — ${message} → ${results.map((r) => `${r.channel}${r.delivered ? '' : ' (failed)'}`).join(', ')}`
        : `${title} — ${message} (no channel configured)`,
    })
    .catch((e) => console.log(`[notify] could not log event: ${(e as Error).message}`));

  // `ok` is "nothing went wrong", NOT "a message was sent" — an account with no channels is a
  // valid no-op, but a channel that errored is a failure the caller must not read as success.
  return { ok: results.length === 0 || delivered > 0, channels: results, delivered };
}
