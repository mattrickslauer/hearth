# Realtime: cloud-brokered live readings over Alibaba API Gateway WebSocket

When you open a web session, the dashboard auto-discovers your hub and opens a **secure
WebSocket** to it, brokered through **Alibaba API Gateway** (Function Compute can't hold a
long-lived socket itself). This doc is the one-time provisioning + how the pieces fit.

## Why this shape

```
browser ──GET /live/ticket (session JWT)──▶ FC: find account's hub → {wsUrl, appKey, ticket, online}
browser ──wss + RG#deviceId, then REGISTER api (ticket as password)──▶ API Gateway ──REGISTER──▶ FC /live/register: verify ticket, store deviceId↔account
hub ──POST /hub/devices (event-driven, debounced)──▶ FC ──NOTIFY api (x-ca-deviceid, App-signed)──▶ API Gateway ──NF#──▶ browser
```

- **Control plane = FC (serverless).** Authenticates the session, finds the account's hub
  (autodiscovery — no client config), mints a **90s ticket**, reports online/offline from the
  heartbeat it already tracks, and records `deviceId ↔ account`.
- **Data plane = API Gateway.** Terminates the browser's `wss`. FC pushes to a specific
  browser by calling the **NOTIFY** api with an `x-ca-deviceid` header, App-signed with the
  gateway AppKey/Secret.
- **Secrets stay server-side.** The browser only ever holds the short-lived ticket and the
  public AppKey. The AppSecret lives only in FC (`backend/src/gateway.ts`).

## Provision the gateway (Traditional API Gateway — the one with App/AppKey/AppSecret)

1. **API group** in your region; **bind an independent (custom) domain**.
2. On that domain: **Group Details → Custom Domain Name → WebSocket Channel Status → Open**.
3. Create **three apis** in the group (they differ by *Request Type*):
   - **REGISTER (WEBSOCKET)** → backend = this **Function Compute** service, path **`/live/register`**.
     Define a request param `password` (this carries our ticket). Auth: no App signature —
     the ticket + our FC check is the authentication.
   - **UNREGISTER (WEBSOCKET)** → backend = FC, path **`/live/unregister`**.
   - **NOTIFY (WEBSOCKET)** → **no backend**; it has the immutable auto-param `x-ca-deviceid`.
     Do **not** authorize the client-facing App to call it (backend-only).
4. Create an **App** → yields **AppKey + AppSecret**. Authorize it for the apis and **publish**
   all three to **RELEASE**.
5. Fill `backend/.env` (and the FC deploy env):
   - `APIGW_WS_URL` = `wss://<independent-domain>:<secure-port>` — **verify the port** (§Gotchas).
   - `APIGW_NOTIFY_URL` = `https://<group-host>/<notify-path>`
   - `APIGW_APP_KEY`, `APIGW_APP_SECRET` = from the App.
6. Run FC with **`HEARTH_STORE=tablestore`** so the `deviceId↔account` registry is shared
   across instances (memory works only within one instance — fine for local dev).

Unset any `APIGW_*` and realtime is simply **off**: `/live/ticket` returns `{enabled:false}`
and the dashboard uses its load-on-mount + manual-refresh path. Nothing else changes.

## What's verified vs. what needs the live gateway

**Verified in isolation** (`cd backend && npm run live-check`):
- The App request signer produces the exact documented string-to-sign + HMAC-SHA256 signature.
- The connection registry scopes/lists/removes per account.
- `notifyDevice` POSTs to the notify URL, targets `x-ca-deviceid`, and is signed.

Backend `npm run typecheck` and the frontend typecheck/lint are clean.

**Can only be confirmed against a provisioned gateway** (both isolated + commented in code):
1. **Secure `wss` port.** Alibaba's docs show `ws://<domain>:8080`; the TLS port for browsers
   isn't stated (commonly **8443**). Set it in `APIGW_WS_URL`. — `frontend/src/lib/live.ts`
2. **REGISTER-over-channel envelope.** After `RG#`/`RO#`, the browser sends the REGISTER api
   call as a JSON envelope over the socket. The field set follows Alibaba's Call-API guide,
   but serialization must be confirmed live. Isolated in `registerEnvelope()` /
   `REGISTER_PATH` in `frontend/src/lib/live.ts`.

## Control-protocol reference (browser ↔ gateway)

Text control frames (`#`-separated). Client sends `RG#<uuid>@<appKey>` to register the
connection; gateway replies `RO#<credential>#<keepAliveMs>` (or `RF#<err>`). Then the client
sends the REGISTER api call (→ FC `/live/register`), heartbeats `H1` every ~25s (gateway acks
`HO#…`), and for each pushed `NF#<body>` parses the body and replies `NO`. `OS`/`CR` mean
reconnect. Implemented in `frontend/src/lib/live.ts`.
