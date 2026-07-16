/**
 * Outbound notification — the "…and then it told me" half of a fire.
 *
 * Lifted out of the `notify` MCP tool so the tool and the runtime Qwen-VL loop
 * deliver through exactly one path. Telegram is the only channel that needs no
 * Alibaba setup (bot token + chat id); every other channel is logged until it's
 * wired, which keeps a fire honest — the event row says `delivered:false` rather
 * than pretending.
 */

export interface DeliveryResult {
  ok: boolean;
  channel: string;
  delivered: boolean;
  error?: string;
  note?: string;
}

/** The channel a runtime fire pushes to when the watch doesn't name one. */
export const defaultChannel = (): string => process.env.NOTIFY_CHANNEL ?? 'telegram';

/** Deliver `message` to `channelId`. Never throws — a dead channel must not kill a fire. */
export async function deliver(channelId: string, message: string): Promise<DeliveryResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (channelId.startsWith('telegram') && token && chat) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: message }),
      });
      return { ok: res.ok, channel: channelId, delivered: res.ok };
    } catch (e) {
      return { ok: false, channel: channelId, delivered: false, error: (e as Error).message };
    }
  }
  return {
    ok: true,
    channel: channelId,
    delivered: false,
    note: 'logged; wire Expo Push / SMS / DirectMail channels next.',
  };
}
