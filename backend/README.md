# Hearth Cloud — the Home MCP server + Qwen brain

The cloud tier of Hearth (docs `01`–`03`): a **Home MCP server** that exposes the
house as typed tools Qwen calls to perceive and act, plus the authoring/runtime
Qwen orchestration. It runs the **same engine + brain + home model** the browser
demo proved (`../frontend/src/demo`) — re-exported via `src/domain.ts`, so there is
one grammar and one evaluator across demo, cloud, and (later) the Pi hub.

Deployable to **Alibaba Function Compute** (custom runtime, web-server mode). Boots
on the in-memory store with the deterministic brain, so it runs with **zero setup**;
add a Qwen key and Tablestore creds to make it real.

## Run locally

```bash
cd backend
npm install
npm run smoke     # end-to-end: describe_home → author → persist → read  (no creds)
npm run dev       # http://localhost:9000
```

Try it:

```bash
curl localhost:9000/health
curl localhost:9000/mcp/tools
curl -XPOST localhost:9000/mcp/call -d '{"tool":"author_question","args":{"wish":"Tell me if someone who isn'\''t family is at the door."}}'
curl -XPOST localhost:9000/mcp/call -d '{"tool":"suggest_runs","args":{}}'
```

## Make it real (in priority order)

1. **Qwen key** — the one true blocker (INVENTORY: "blocks all interesting work").
   Set `QWEN_API_KEY` (+ `QWEN_BASE_URL` for your account region: `dashscope-intl`
   vs `dashscope-us`). Authoring + judging switch from mock to real Qwen instantly;
   nothing else changes.
2. **Tablestore** — `npm i tablestore`, set `HEARTH_STORE=tablestore` +
   `TABLESTORE_ENDPOINT`/`TABLESTORE_INSTANCE` + Alibaba AccessKey. Fill
   `createTablestore()` in `src/store.ts` (tables: `twin`, `readings`, `questions`,
   `records`, `events`; reserved CU=0 for cheap-at-idle).
3. **OSS snapshots** — presigned GET/PUT in `get_snapshot` (currently
   `provisioned:false`). Raw frames stay local; only minimized frames get a temp URL.
4. **IoT device shadow** — `actuate` publishes desired-state to the hub
   (currently `provisioned:false`). This is the edge↔cloud link (docs `01` OD-1).

## Deploy to Function Compute

```bash
npm run build                 # → dist/server.js (single bundle)
npm i -g @serverless-devs/s   # once
s config add                  # Alibaba AccessKey
FC_REGION=us-east-1 QWEN_API_KEY=... s deploy
```

`s.yaml` provisions an HTTP-triggered custom-runtime function running
`node server.js` on :9000. The HTTP trigger URL is your judge-accessible
"Proof of Alibaba Cloud Deployment".

## What's real vs stubbed today

| Piece | State |
|---|---|
| Home MCP tool catalog (11 tools) | ✅ real, typed, tested |
| Authoring (NL → compiled Question) | ✅ real (Qwen w/ key, deterministic fallback) |
| Runtime judge (verdict + reasoning) | ✅ real (Qwen w/ key, fallback) |
| Home Model + readings/events store | ✅ in-memory; Tablestore adapter interface-ready |
| `notify` via Telegram | ✅ works with a bot token (no Alibaba needed) |
| Snapshots (OSS), actuation (IoT shadow) | ⏳ shapes final, `provisioned:false` until account exists |

## Point the app at it

Set the app's `/qwen` calls at this backend (it serves a compatible `POST /qwen`
for `author`/`judge`), so the same UI drives the cloud brain.
