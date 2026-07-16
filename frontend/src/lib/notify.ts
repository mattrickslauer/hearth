/**
 * Notification-channel client — where this account's "notify me" pushes land.
 *
 * Per-account, not per-hub: you have one Telegram chat and one inbox, not one per hub, and
 * a hub you unpair and re-claim shouldn't lose them. Delivery happens cloud-side (the hub
 * POSTs a fire to /hub/notify), so the bot token never leaves the backend — which is why
 * `botTokenHint` is all we ever read back.
 */

import { backendBase } from '@/auth/client';

export interface NotifyConfigView {
  /**
   * null = no bot registered. A non-null `telegram` with `chatId: null` means the bot token is
   * still saved but the channel is off. `botTokenHint` is "<botId>:…<last4>", never the token.
   */
  telegram: { chatId: string | null; botTokenHint: string } | null;
  email: string | null;
  updatedAt: number;
}

export interface DeliveryResult {
  channel: 'telegram' | 'email';
  delivered: boolean;
  status?: number;
  error?: string;
}

/** What a save sends. Omit a key to leave it untouched; send null to clear the channel. */
export interface NotifyConfigInput {
  /**
   * Omit `botToken` to keep the token already stored (the UI only ever saw a hint).
   * `{ chatId: null }` turns Telegram off but KEEPS the bot token; `telegram: null` forgets
   * the bot entirely — only send that when the user means to discard the credential.
   */
  telegram?: { chatId: string | null; botToken?: string } | null;
  email?: string | null;
}

async function req<T>(path: string, init: RequestInit, token?: string | null): Promise<T> {
  const res = await fetch(`${backendBase}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) || `request failed (${res.status})`);
  return data as T;
}

/** Read the account's channels (Telegram bot token redacted to a hint). */
export const getNotifyConfig = (token?: string | null) =>
  req<{ config: NotifyConfigView; channels: string[] }>('/notify/config', { method: 'GET' }, token);

/** Save channels. Rejects with the backend's validation message on a malformed token/address. */
export const setNotifyConfig = (input: NotifyConfigInput, token?: string | null) =>
  req<{ ok: boolean; config: NotifyConfigView; channels: string[] }>(
    '/notify/config',
    { method: 'POST', body: JSON.stringify(input) },
    token,
  );

/** Send a real test push — the only honest proof the token/address actually works. */
export const testNotify = (token?: string | null) =>
  req<{ ok: boolean; channels: DeliveryResult[]; delivered: number }>('/notify/test', { method: 'POST' }, token);
