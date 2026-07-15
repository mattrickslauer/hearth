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
3. **Tablestore (data plane: home/watches)** — ✅ **shipped.** `createTablestore()` →
   `TablestoreStore.open()` in `src/store.ts` is fully implemented (it only throws if the
   SDK is missing). The `hearth_home` table auto-creates on first use; hub pairings live in
   its `_hubs` partition. Live health reports `store:"tablestore"`. Use `HEARTH_STORE=file`
   locally if you'd rather not hit the cloud.
4. **OSS snapshots** — ✅ **shipped.** Real `ali-oss` client in `src/oss.ts`, bucket
   `hearth-vision-c11d45` (provision with `npm run oss-provision`), presigned GET/PUT in
   `get_snapshot`. Stores camera frames + household reference photos Qwen-VL reads.
   Unset `OSS_BUCKET` → images fall back to inline base64.
   ⚠️ **Frames are stored raw** — the `transform: crop|redact|downscale` policy field is
   accepted but **not yet enforced**. Don't describe this as a privacy filter.
5. **Device shadow** — ✅ shipped, but **DIY, not Alibaba IoT Platform**. `actuate` writes
   desired-state via `store.setDesired()`; the hub polls and applies it (`hub/hub.mjs`
   `applyDesired`) and the firmware honors its safety veto. Docs `01` OD-1 planned IoT
   Platform; we didn't build it.

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
| Home MCP tool catalog (**20 tools** live) | ✅ real, typed, tested |
| Authoring (NL → compiled Question) | ✅ real — `qwen-plus` w/ key, deterministic fallback |
| Runtime judge (verdict + reasoning) | ✅ real — routes to **`qwen-vl-plus`** when frames/reference photos are passed |
| Accounts + OTP store (signups) | ✅ real (Tablestore) |
| Home Model + watches store | ✅ real (Tablestore, `hearth_home`); file/in-memory fallback |
| Snapshots (OSS) | ✅ real (bucket `hearth-vision-c11d45`, presigned URLs) |
| Actuation (DIY device shadow) | ✅ real (`setDesired` → hub poll → firmware, safety veto honored) |
| `notify` via Telegram / ntfy | ✅ works with a bot token (no Alibaba needed) |
| **Judge auto-invoked from a camera frame** | ⏳ **not wired.** `judge()` works and is proven by `npm run qwen-vl-check`, but no code path automatically feeds a stored frame to it — `POST /qwen` is manual. |
| **Frame minimization / redaction** | ⏳ **not implemented.** `transform` is stored, never applied. |

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
