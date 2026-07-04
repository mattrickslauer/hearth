# Hearth Cloud — the Home MCP server + Qwen brain

The cloud tier of Hearth (docs `01`–`03`): a **Home MCP server** that exposes the
house as typed tools Qwen calls to perceive and act, plus the authoring/runtime
Qwen orchestration. It runs the **same engine + brain + home model** the browser
demo proved (`../frontend/src/demo`) — re-exported via `src/domain.ts`, so there is
one grammar and one evaluator across demo, cloud, and (later) the Pi hub.

Deployable to **Alibaba Function Compute** (custom runtime, web-server mode). Boots
on the in-memory store with the deterministic brain, so it runs with **zero setup**;
add a Qwen key and Tablestore creds to make it real.

The root `.env` (`QWEN_API_KEY`, `ALI_ACCESS_KEY_ID/SECRET`) is auto-loaded by
`src/env.ts` in dev, so real Qwen is already active locally. On Function Compute
the same vars come from `s.yaml`.

## Run locally

```bash
cd backend
npm install
npm run smoke        # hermetic: describe_home → author → persist → read (mock brain, no network)
npm run qwen-check   # LIVE: real Qwen authors + judges (uses root .env)
npm run dev          # http://localhost:9000
```

Try it:

```bash
curl localhost:9000/health
curl localhost:9000/mcp/tools
curl -XPOST localhost:9000/mcp/call -d '{"tool":"author_question","args":{"wish":"Tell me if someone who isn'\''t family is at the door."}}'
curl -XPOST localhost:9000/mcp/call -d '{"tool":"suggest_runs","args":{}}'
```

## Make it real (in priority order)

1. **Qwen key** — ✅ done. Present in root `.env`; International region
   (`dashscope-intl`, the default) verified via `npm run qwen-check`. Authoring +
   judging are real. Override `QWEN_BASE_URL` only if the account moves to `us`.
2. **Tablestore (control plane: signups)** — ✅ wired. The account + OTP stores
   persist to Tablestore so signups survive restarts and verify across FC instances
   (the in-memory OTP store breaks when request-otp and verify-otp hit different
   instances). Set `HEARTH_STORE=tablestore` + `TABLESTORE_ENDPOINT` /
   `TABLESTORE_INSTANCE` + `ALI_ACCESS_KEY_ID` / `ALI_ACCESS_KEY_SECRET`, then create
   these tables in the Tablestore console (reserved read/write CU = 0 → cheap-at-idle):

   | Table | Primary key | Attributes | Notes |
   |---|---|---|---|
   | `accounts` | `id` STRING | `email` STRING, `createdAt` INTEGER, `lastLoginAt` INTEGER | hot path (GET /auth/me) |
   | `account_email` | `email` STRING | `id` STRING | email→id login lookup |
   | `auth_otp` | `email` STRING | `codeHash` STRING, `expiresAt` INTEGER, `attempts` INTEGER | set table **TTL ≈ 1 day**; max versions 1 |

   The `tablestore` SDK is bundled into `dist/server.cjs` at build (esbuild), so no
   `node_modules` is needed on the function. Code lives in `src/tablestore.ts` +
   `src/auth.ts`.
3. **Tablestore (data plane: home/readings)** — ⏳ remaining. `createTablestore()` in
   `src/store.ts` still throws (loud). The Home Model + append-heavy readings/events are
   a time-series shape — implement on `src/tablestore.ts` (tables `twin`, `readings`,
   `questions`, `records`, `events`) or point at a TSDB (Lindorm). Use `HEARTH_STORE=file`
   locally until then.
4. **OSS snapshots** — presigned GET/PUT in `get_snapshot` (currently
   `provisioned:false`). Raw frames stay local; only minimized frames get a temp URL.
5. **IoT device shadow** — `actuate` publishes desired-state to the hub
   (currently `provisioned:false`). This is the edge↔cloud link (docs `01` OD-1).

## Deploy to Function Compute

Live: **https://hearth-mcp-gqfuhlkzpo.ap-southeast-1.fcapp.run** (region `ap-southeast-1`,
chosen to colocate with the Singapore-hosted DashScope-Intl backend — see the region
note below).

```bash
npm i -g @serverless-devs/s   # once
s config add                  # once: Alibaba AccessKey (stored in ~/.s/access.yaml)

npm run build                 # → dist/server.cjs (single CommonJS bundle)

# s.yaml reads FC_REGION + QWEN_API_KEY from a project .env via ${env('...')}:
printf 'FC_REGION=ap-southeast-1\nQWEN_API_KEY=%s\n' "$QWEN_API_KEY" > .env

# fc3 hardcodes the -internal OSS endpoint for code upload (unreachable from outside
# Alibaba) — force the public one, or the upload times out:
export FC_CODE_TEMP_OSS_ENDPOINT=oss-ap-southeast-1.aliyuncs.com

s deploy -y
```

`s.yaml` provisions an HTTP-triggered custom-runtime function that runs
`/var/fc/lang/nodejs20/bin/node server.cjs` on `0.0.0.0:9000`. The HTTP trigger URL is
your judge-accessible "Proof of Alibaba Cloud Deployment".

**Deploy gotchas (all handled in the repo, noted so they're not re-discovered):**
- `${env.X}` dot-form isn't supported by this `s` build — use `${env('X')}`.
- `custom.debian10` has node at `/var/fc/lang/nodejs20/bin/node`, not on `$PATH`.
- Bundle must be CommonJS (`.cjs`) — the FC code dir has no `package.json`.
- Code upload needs `FC_CODE_TEMP_OSS_ENDPOINT` set to the public OSS endpoint.
- The trigger is `authType: anonymous` (public) — fine for a judge demo, but anyone
  with the URL can spend Qwen tokens. Add auth / a rate cap before wider exposure.

## What's real vs stubbed today

| Piece | State |
|---|---|
| Home MCP tool catalog (11 tools) | ✅ real, typed, tested |
| Authoring (NL → compiled Question) | ✅ real (Qwen w/ key, deterministic fallback) |
| Runtime judge (verdict + reasoning) | ✅ real (Qwen w/ key, fallback) |
| Accounts + OTP store (signups) | ✅ real (Tablestore w/ `HEARTH_STORE=tablestore`); in-memory/file otherwise |
| Home Model + readings/events store | ✅ in-memory/file; Tablestore HomeStore still a stub (data plane) |
| `notify` via Telegram | ✅ works with a bot token (no Alibaba needed) |
| Snapshots (OSS), actuation (IoT shadow) | ⏳ shapes final, `provisioned:false` until account exists |

## Auth (passwordless email OTP)

```
POST /auth/request-otp  { email }         → emails a 6-digit code (ZeptoMail from hearth@agfarms.dev)
POST /auth/verify-otp   { email, code }    → { token, account }  (account created on first verify)
GET  /auth/me           Bearer <token>     → { account }
```

Codes are held in a short-lived store (TTL ~10 min), stored **hashed**, one-time-use,
and attempt-limited (5). `request-otp` is rate-limited per email (5 / 15 min) and per
client IP (30 / 15 min). Session tokens are HMAC-signed (30-day).

**`AUTH_SESSION_SECRET` is required — there is no fallback.** The server refuses to
boot without it (a missing/weak secret would let anyone forge session tokens). Use the
**same** value in dev and prod: put it in `backend/.env` (gitignored) and source that
same file into the deploy env. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Protected endpoints:** everything under `/mcp/*` and `/qwen` now requires a valid
`Authorization: Bearer <token>` session. Only `/health` and the `/auth/*` endpoints are
anonymous. (The guest demo is unaffected — it uses the app's own same-origin `/qwen`
route, not this backend.)

Email goes over ZeptoMail **SMTP** (`smtp.zeptomail.com`) — all optional; with no SMTP
pass set, the OTP is logged to the server console and the flow is fully testable:

| Var | Purpose |
|---|---|
| `AUTH_SESSION_SECRET` | **Required.** HMAC secret for session tokens (>=16 chars, same in dev+prod, no fallback). |
| `ZEPTOMAIL_SMTP_PASS` | ZeptoMail SMTP password / send-mail token. Unset → console fallback. |
| `ZEPTOMAIL_SMTP_USER` | default `emailapikey` |
| `ZEPTOMAIL_SMTP_HOST` / `_PORT` | default `smtp.zeptomail.com` / `465` (SSL; `587` = STARTTLS) |
| `ZEPTOMAIL_FROM` | sender, default `hearth@agfarms.dev` (a verified sender on the domain) |
| `HEARTH_OTP_STORE` | `memory` (default) or `tablestore` (short-lived NoSQL, per-row TTL) |

Verify the mail path without wiring the whole flow:

```bash
npm run mail-check you@example.com   # SMTP verify() + one real send
```

For durable OTP storage set `HEARTH_OTP_STORE=tablestore` (or just `HEARTH_STORE=tablestore`,
which flips both OTP and accounts). Requires the `auth_otp` table above + the Tablestore
env vars. This is what makes verification work across FC instances — see "Make it real" §2.

## Point the app at it

Set the app's `/qwen` calls at this backend (it serves a compatible `POST /qwen`
for `author`/`judge`), so the same UI drives the cloud brain.
