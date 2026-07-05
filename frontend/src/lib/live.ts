/**
 * Realtime sensor stream, straight from the hub's LAN WebSocket (hub/hub.mjs → /live).
 *
 * This is the off-grid path: when the dashboard is on the same network as the hub, the
 * browser talks to it directly, so sensor tiles update the instant a node reports — no
 * cloud round-trip and no polling, and it keeps working with no internet at all. It layers
 * on top of the existing load-on-mount fetch (home.ts): the initial values come from the
 * cloud, then live pushes patch them in place.
 *
 * The hub URL comes from EXPO_PUBLIC_HUB_URL (e.g. ws://hearth-hub.local:8899 or
 * ws://192.168.1.27:8899). When it's unset the hook is inert and the dashboard falls back
 * to its manual-refresh behaviour, so remote/over-internet sessions are unaffected.
 */

import { useEffect, useRef, useState } from 'react';

import type { Reading } from '@/lib/home';

/**
 * Normalise EXPO_PUBLIC_HUB_URL into a /live WebSocket URL. Accepts a bare host:port, an
 * http(s):// base, or a full ws(s):// URL, with or without a trailing /live. Returns null
 * when unconfigured (realtime disabled).
 */
export function hubLiveUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_HUB_URL?.trim();
  if (!raw) return null;
  let u = raw;
  if (u.startsWith('http://')) u = `ws://${u.slice(7)}`;
  else if (u.startsWith('https://')) u = `wss://${u.slice(8)}`;
  else if (!u.startsWith('ws://') && !u.startsWith('wss://')) u = `ws://${u}`;
  u = u.replace(/\/+$/, '');
  if (!/\/live$/.test(u)) u += '/live';
  return u;
}

export type LiveStatus = 'off' | 'connecting' | 'live' | 'reconnecting';

interface ReadingMsg {
  type: 'reading';
  node: string;
  at: number;
  readings: Record<string, number | null>;
}
interface SnapshotMsg {
  type: 'snapshot';
  at: number;
  nodes: { id: string; lastReading: Record<string, number | null> | null }[];
}
type HubMsg = ReadingMsg | SnapshotMsg | { type: string };

// Turn a node's {key: value} map into dashboard readings keyed by capability id
// (`${node}.${key}` — the exact id describe_home / read_input use), dropping non-numeric.
function flatten(node: string, readings: Record<string, number | null> | null, at: number): Record<string, Reading> {
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

/**
 * Subscribe to the hub's live reading stream. Calls `onReadings` with a map of
 * { [capabilityId]: Reading } to merge into dashboard state, both for the initial
 * snapshot and each subsequent push. Auto-reconnects with capped backoff. Returns a
 * status you can surface as a "live" indicator.
 */
export function useHubLive(onReadings: (updates: Record<string, Reading>) => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('off');
  // Keep the latest callback without re-opening the socket when the dashboard re-renders.
  const cbRef = useRef(onReadings);
  useEffect(() => {
    cbRef.current = onReadings;
  });

  useEffect(() => {
    const url = hubLiveUrl();
    // No hub configured (or no WebSocket, e.g. SSR) → stay 'off', which is the initial state.
    if (!url || typeof WebSocket === 'undefined') return;

    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stopped) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
        setStatus('live');
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg: HubMsg;
        try {
          msg = JSON.parse(ev.data) as HubMsg;
        } catch {
          return;
        }
        if (msg.type === 'reading') {
          const m = msg as ReadingMsg;
          const updates = flatten(m.node, m.readings, m.at);
          if (Object.keys(updates).length) cbRef.current(updates);
        } else if (msg.type === 'snapshot') {
          const m = msg as SnapshotMsg;
          const all: Record<string, Reading> = {};
          for (const n of m.nodes ?? []) Object.assign(all, flatten(n.id, n.lastReading, m.at));
          if (Object.keys(all).length) cbRef.current(all);
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        attempt += 1;
        setStatus('reconnecting');
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        // Let onclose drive the reconnect; just close so it fires.
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return status;
}
