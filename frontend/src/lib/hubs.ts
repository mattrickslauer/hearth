/**
 * Hub client — pairing a physical edge hub to the signed-in account. Unlike home.ts
 * (which speaks the MCP tool surface), hub pairing is a small REST surface on the same
 * backend: claim a code the hub prints, list connected hubs, and unpair.
 *
 * The device-facing half (enroll / poll / heartbeat) lives on the hub itself, not here —
 * see hub/hub.mjs for the reference client (and hub/install.sh for how users get it).
 */

import { backendBase } from '@/auth/client';

export interface HubView {
  id: string;
  name: string;
  status: 'unclaimed' | 'claimed';
  online: boolean;
  lastSeenAt: number | null;
  createdAt: number;
  fw?: string;
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

/** Redeem the 8-character code shown on the hub, binding it to this account. */
export const claimHub = (claimCode: string, token?: string | null) =>
  req<{ ok: boolean; hub: HubView }>('/hub/claim', { method: 'POST', body: JSON.stringify({ claimCode }) }, token).then(
    (r) => r.hub,
  );

/** List the account's connected hubs. */
export const listHubs = (token?: string | null) =>
  req<{ hubs: HubView[] }>('/hubs', { method: 'GET' }, token).then((r) => r.hubs);

/** Unpair (remove) a hub. Revokes its token on the hub's next heartbeat. */
export const unpairHub = (id: string, token?: string | null) =>
  req<{ ok: boolean }>(`/hubs/${encodeURIComponent(id)}`, { method: 'DELETE' }, token);
