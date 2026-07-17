/**
 * Realtime sensor stream — cloud-brokered, auto-discovered.
 *
 * When you open a web session it asks the backend "how do I reach my hub live?"
 * (GET /live/ticket, authed by your session). The backend finds the account's hub and, if
 * realtime is provisioned, returns the relay's `wss` URL and a short-lived ticket. We open a
 * secure WebSocket to the relay (hub-ws.agfarms.dev) with that ticket; the relay verifies it,
 * joins us to the account's channel, and streams the readings the hub pushes up via the
 * backend. No LAN, no per-device config — autodiscovery falls out of session → account → hub.
 *
 * The relay is a normal WebSocket server (relay/relay.mjs), so this is a standard client:
 * connect, receive JSON frames, reconnect on drop. When realtime isn't provisioned or the hub
 * is offline, the hook is inert and the dashboard uses its load-on-mount + manual refresh path.
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
  ticket?: string;
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

function withTicket(wsUrl: string, ticket: string): string {
  const sep = wsUrl.includes('?') ? '&' : '?';
  return `${wsUrl}${sep}ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Subscribe to the account's hub readings through the cloud relay. Calls `onReadings` with
 * { [capabilityId]: Reading } to merge into dashboard state. Returns a status for the UI
 * ('live' / 'connecting' / 'offline' / 'unconfigured' / 'off').
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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const scheduleRetry = (delay: number) => {
      if (stopped) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void cycle(), delay);
    };
    const backoff = () => Math.min(1000 * 2 ** ++attempt, 15000);

    // Re-fetch a ticket (short-lived) and (re)connect, or back off / mark offline.
    const cycle = async () => {
      if (stopped) return;
      if (!token || typeof WebSocket === 'undefined') {
        setStatus('off');
        return;
      }
      const t = await fetchTicket(token);
      if (stopped) return;

      if (!t || !t.enabled) {
        setStatus('unconfigured'); // realtime not provisioned — dashboard uses load + refresh
        // Self-heal if realtime gets provisioned later: the effect only re-runs on token
        // change, so without this a session that started unconfigured would never reconnect.
        // A slow re-check (once a minute) is enough — this is the fallback path, not the hot one.
        scheduleRetry(60000);
        return;
      }
      if (!t.hubId || !t.wsUrl || !t.ticket) {
        setStatus('offline'); // no hub paired yet
        scheduleRetry(15000);
        return;
      }
      if (!t.online) {
        setStatus('offline'); // hub paired but not currently heartbeating
        scheduleRetry(10000);
        return;
      }
      connect(withTicket(t.wsUrl, t.ticket));
    };

    const connect = (url: string) => {
      setStatus('connecting');
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
        setStatus('live');
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg: { type?: string; at?: number; nodes?: { id: string; readings: Record<string, unknown> }[] };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'readings' && Array.isArray(msg.nodes)) {
          const all: Record<string, Reading> = {};
          for (const n of msg.nodes) Object.assign(all, flatten(n.id, n.readings, msg.at ?? Date.now()));
          if (Object.keys(all).length) cbRef.current(all);
        }
        // 'hello' just confirms the channel; onopen already set status to live.
      };
      ws.onclose = () => {
        if (stopped) return;
        setStatus('connecting');
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

    void cycle();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [token]);

  return status;
}
