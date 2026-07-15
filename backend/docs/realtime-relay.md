# Realtime: cloud-brokered live readings via the relay

Open a web session anywhere → the dashboard auto-discovers your hub and opens a **secure
WebSocket** to it, brokered through an always-on **relay** (`relay/relay.mjs`) at
`hub-ws.agfarms.dev`. Function Compute is serverless and can't hold the socket itself, so it
stays the control plane and the relay is the data plane.

## Architecture

```
browser ──GET /live/ticket (session JWT)──▶ FC: find account's hub → { wsUrl, ticket, online }
browser ──wss://hub-ws.agfarms.dev/live?ticket=<jwt>──▶ RELAY: verify ticket → account, hold socket
hub ──POST /hub/devices (event-driven, debounced)──▶ FC ──POST /publish {accountId,message}──▶ RELAY ──▶ that account's browsers
```

- **Control plane = Function Compute.** Authenticates the session, finds the account's hub
  (autodiscovery — no client config), reports online/offline from the heartbeat it already
  tracks, and mints a **90s ticket** (`auth.ts` issueWsTicket).
- **Data plane = the relay.** Terminates the browser `wss` (TLS via the front nginx), verifies
  the ticket with the shared `AUTH_SESSION_SECRET`, and fans an account's readings out to its
  connected browsers. The backend pushes via `POST /publish` guarded by `RELAY_PUBLISH_SECRET`.
- **Secrets:** the browser only holds the short-lived ticket. `AUTH_SESSION_SECRET` (ticket
  signing/verifying) and `RELAY_PUBLISH_SECRET` (backend→relay auth) are server-only and must
  match between the backend and the relay.

## Deploy the relay (agfarms server)

The relay is zero-dependency Node stdlib. It runs as a container on a local port; the front
nginx terminates TLS for `hub-ws.agfarms.dev` and proxies to it (WebSocket upgrade).

1. Copy **`relay/` and `hub/`** to the server, keeping them siblings, and run it (Docker, no
   root needed — you're in the `docker` group), binding a local port and passing the two
   secrets. Both dirs are needed because `relay.mjs` imports the one shared RFC 6455
   implementation from `../hub/ws-frame.mjs` — the same one the hub's LAN channel uses, so
   there is a single framing implementation rather than a copy per server. The mount is the
   **parent** dir and the workdir is `relay`, which keeps that relative import resolving
   exactly as it does in the repo:
   ```bash
   # on the server: ~/hearth/{relay/,hub/}
   rsync -a relay hub  server:~/hearth/

   docker run -d --name hearth-relay --restart unless-stopped \
     -p 127.0.0.1:8790:8790 \
     -e AUTH_SESSION_SECRET=<same as backend> \
     -e RELAY_PUBLISH_SECRET=<shared push secret> \
     -v ~/hearth:/app -w /app/relay node:20-alpine node relay.mjs
   ```
   Still zero npm dependencies — `hub/` is here for that one stdlib-only module, nothing else.
2. Add the TLS vhost with `scripts/setup-hub-ws-nginx.sh` (run with sudo) — it writes an
   isolated nginx server block for `hub-ws.agfarms.dev` proxying to `127.0.0.1:8790` with the
   WebSocket upgrade headers, issues a certbot cert, `nginx -t`, and reloads.

## Point the backend at it

Set on the FC deploy env (and `backend/.env` for local dev):
```
RELAY_WS_URL=wss://hub-ws.agfarms.dev/live
RELAY_PUBLISH_URL=https://hub-ws.agfarms.dev/publish
RELAY_PUBLISH_SECRET=<shared push secret>
AUTH_SESSION_SECRET=<same value the relay uses>
```
Unset any `RELAY_*` and realtime is simply **off**: `/live/ticket` returns `{enabled:false}`
and the dashboard uses load-on-mount + manual refresh.

## Verify

- Relay unit/integration test (fan-out, cross-account isolation, forged/expired ticket
  rejection): `cd relay && npm test`.
- Backend `npm run typecheck`; frontend `tsc`/`eslint` clean; `expo export -p web` green.
- End-to-end: with the relay up + `RELAY_*` set, open the dashboard — the Sensors header shows
  **live**, and tiles update within ~1s of a hub reading (hub sync is debounced ~1s).
