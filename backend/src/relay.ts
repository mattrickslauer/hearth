/**
 * Realtime relay client (backend side).
 *
 * Function Compute is serverless and can't hold a browser's WebSocket, so an always-on
 * relay (relay/relay.mjs, deployed at hub-ws.agfarms.dev) holds them instead. This is the
 * thin backend half: when a hub syncs readings we POST them to the relay's /publish, and the
 * relay fans them out to that account's connected browsers. The browser got here via a
 * ticket we minted (auth.ts issueWsTicket) and the relay verified.
 *
 * Env-gated on RELAY_*: unset ⇒ realtime is off, /live/ticket reports {enabled:false}, and
 * the dashboard falls back to load-on-mount + manual refresh. Nothing else is affected.
 */

export interface RelayConfig {
  wsUrl: string; // wss URL the browser connects to (e.g. wss://hub-ws.agfarms.dev/live)
  publishUrl: string; // https URL we POST readings to (e.g. https://hub-ws.agfarms.dev/publish)
  secret: string; // shared bearer the relay checks on /publish
}

export function relayConfig(): RelayConfig | null {
  const wsUrl = process.env.RELAY_WS_URL;
  const publishUrl = process.env.RELAY_PUBLISH_URL;
  const secret = process.env.RELAY_PUBLISH_SECRET;
  if (!wsUrl || !publishUrl || !secret) return null;
  return { wsUrl, publishUrl, secret };
}

export function relayEnabled(): boolean {
  return relayConfig() !== null;
}

/**
 * Push a message to an account's connected browsers via the relay. Best-effort: resolves
 * false on any failure (unconfigured, network, non-2xx) rather than throwing, so a relay
 * hiccup never breaks the hub sync that triggered it.
 */
export async function publishToRelay(accountId: string, message: string, cfg = relayConfig()): Promise<boolean> {
  if (!cfg) return false;
  try {
    const res = await fetch(cfg.publishUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.secret}` },
      body: JSON.stringify({ accountId, message }),
    });
    return res.ok;
  } catch (e) {
    console.log(`[live] relay publish failed: ${(e as Error).message}`);
    return false;
  }
}
