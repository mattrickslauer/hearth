/**
 * Realtime sensor stream — cloud-brokered, auto-discovered.
 *
 * When you open a web session it asks the backend "how do I reach my hub live?"
 * (GET /live/ticket, authed by your session). The backend finds the account's hub and,
 * if realtime is provisioned, returns the Alibaba API Gateway `wss` URL, the gateway
 * AppKey, and a short-lived ticket. We then open a secure WebSocket to the gateway and
 * register with that ticket — the gateway relays readings your hub pushes up to the cloud.
 * No LAN, no per-device URL config: autodiscovery falls out of the session → account → hub.
 *
 * The AppSecret never reaches the browser — only the scoped, 90s ticket does; the backend
 * verifies it at register time (see backend/src/server.ts /live/register).
 *
 * Transport is Alibaba API Gateway's WebSocket "two-way communication" control protocol
 * (RG/RO/H1/HO/NF/NO). Alibaba ships no browser SDK, so it's implemented here by hand.
 *
 * ⚠️ Two details can only be finalized against a live, provisioned gateway (see
 *    docs/realtime-apigateway.md): the secure wss PORT, and the exact JSON envelope for
 *    sending the REGISTER api call over the channel. Both are isolated below and marked.
 */

import { useEffect, useRef, useState } from 'react';

import { backendBase } from '@/auth/client';
import type { Reading } from '@/lib/home';

export type LiveStatus = 'off' | 'unconfigured' | 'offline' | 'connecting' | 'live';

interface Ticket {
  enabled: boolean;
  hubId?: string;
  online?: boolean;
  wsUrl?: string;
  appKey?: string;
  ticket?: string;
  hub?: null;
}

async function fetchTicket(token: string | null | undefined): Promise<Ticket | null> {
  try {
    const res = await fetch(`${backendBase}/live/ticket`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    return (await res.json()) as Ticket;
  } catch {
    return null;
  }
}

// Turn a node's {key: value} map into dashboard readings keyed by capability id
// (`${node}.${key}` — the id describe_home / read_input use), dropping non-numeric.
function flatten(node: string, readings: Record<string, unknown> | null | undefined, at: number): Record<string, Reading> {
  const out: Record<string, Reading> = {};
  if (!readings) return out;
  for (const [k, v] of Object.entries(readings)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      const input = `${node}.${k}`;
      out[input] = { input, value: v, ts: at };
    }
  }
  return out;
}

function uuidNoDashes(): string {
  // crypto.randomUUID exists in modern browsers + RN Hermes; fall back to a random hex.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const raw = g.crypto?.randomUUID?.() ?? `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
  return raw.replace(/-/g, '');
}

/**
 * Build the "call an API over the WebSocket channel" envelope the gateway expects for the
 * REGISTER api. Per Alibaba's Call-API guide the channel carries a JSON request descriptor;
 * `x-ca-websocket_api_type: REGISTER` marks it as the register call, `x-ca-deviceid` names
 * this connection, and our ticket rides as the `password` param the backend verifies.
 *
 * ⚠️ VERIFY against your gateway: the field set below ({method,host,path,headers,body,…})
 * follows the documented envelope, but serialization specifics can only be confirmed live.
 * REGISTER_PATH must equal the path you assign the REGISTER api in the console.
 */
const REGISTER_PATH = '/live/register';
function registerEnvelope(host: string, deviceId: string, ticket: string): string {
  return JSON.stringify({
    method: 'POST',
    host,
    path: REGISTER_PATH,
    querys: {},
    headers: {
      'x-ca-websocket_api_type': 'REGISTER',
      'x-ca-deviceid': deviceId,
      'content-type': 'application/json',
    },
    isBase64: 0,
    body: JSON.stringify({ password: ticket }),
  });
}

/**
 * Subscribe to the account's hub readings through the cloud gateway. Calls `onReadings`
 * with { [capabilityId]: Reading } to merge into dashboard state. Returns a status for the
 * UI ('live' / 'connecting' / 'offline' / 'unconfigured' / 'off').
 */
export function useHubLive(
  token: string | null | undefined,
  onReadings: (updates: Record<string, Reading>) => void,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('off');
  const cbRef = useRef(onReadings);
  useEffect(() => {
    cbRef.current = onReadings;
  });

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const cleanupSocket = () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
    };

    // Re-fetch a ticket (it's short-lived) and (re)connect, or back off / mark offline.
    const cycle = async () => {
      if (stopped) return;
      if (!token || typeof WebSocket === 'undefined') {
        setStatus('off');
        return;
      }
      const t = await fetchTicket(token);
      if (stopped) return;

      if (!t || !t.enabled) {
        setStatus('unconfigured'); // realtime not provisioned in the cloud — dashboard uses load+refresh
        return;
      }
      if (!t.hubId || !t.wsUrl || !t.appKey || !t.ticket) {
        setStatus('offline'); // no hub paired yet
        scheduleRetry(15000);
        return;
      }
      if (!t.online) {
        setStatus('offline'); // hub paired but not currently heartbeating
        scheduleRetry(10000);
        return;
      }

      connect(t.wsUrl, t.appKey, t.ticket);
    };

    const connect = (wsUrl: string, appKey: string, ticket: string) => {
      setStatus('connecting');
      const deviceId = `${uuidNoDashes()}@${appKey}`;
      let host = '';
      try {
        host = new URL(wsUrl).host;
      } catch {
        /* leave host empty; envelope still sends */
      }

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        // Step 1: register the connection itself.
        ws?.send(`RG#${deviceId}`);
      };

      ws.onmessage = (ev) => {
        const data = typeof ev.data === 'string' ? ev.data : '';
        if (!data) return;

        if (data.startsWith('RO#')) {
          // Connection registered. Parse keepAlive (ms) → start H1 heartbeat, then send the
          // REGISTER api call over the channel to authenticate with our ticket.
          const parts = data.split('#');
          const keepAlive = Number(parts[2]) || 25000;
          ws?.send(registerEnvelope(host, deviceId, ticket));
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = setInterval(() => ws?.send('H1'), Math.max(5000, keepAlive - 3000));
          attempt = 0;
          setStatus('live');
        } else if (data.startsWith('RF#')) {
          cleanupSocket();
          scheduleRetry(backoff());
        } else if (data.startsWith('NF#')) {
          // A pushed message. Strip the 3-char prefix, parse, patch, and ACK with NO.
          const payload = data.slice(3);
          ws?.send('NO');
          try {
            const msg = JSON.parse(payload) as { type?: string; at?: number; nodes?: { id: string; readings: Record<string, unknown> }[] };
            if (msg.type === 'readings' && Array.isArray(msg.nodes)) {
              const all: Record<string, Reading> = {};
              for (const n of msg.nodes) Object.assign(all, flatten(n.id, n.readings, msg.at ?? Date.now()));
              if (Object.keys(all).length) cbRef.current(all);
            }
          } catch {
            /* ignore malformed push */
          }
        } else if (data === 'OS' || data === 'CR') {
          // Gateway asking us to reconnect (throttled, or connection nearing its request cap).
          cleanupSocket();
          scheduleRetry(1000);
        }
        // 'HO#…' heartbeat acks need no action.
      };

      ws.onclose = () => {
        if (stopped) return;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        scheduleRetry(backoff());
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* onclose will schedule the retry */
        }
      };
    };

    const backoff = () => Math.min(1000 * 2 ** ++attempt, 15000);
    const scheduleRetry = (delay: number) => {
      if (stopped) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void cycle(), delay);
    };

    void cycle();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      cleanupSocket();
    };
  }, [token]);

  return status;
}
