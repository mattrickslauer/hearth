# Hearth hub (edge agent)

The hub is the on-prem device — a Raspberry Pi, a spare laptop, a mini PC — that runs
watches locally and syncs with **Hearth Cloud** (the platform backend on Alibaba Function
Compute).

## Install & run (end users)

```bash
curl -fsSL https://raw.githubusercontent.com/mattrickslauer/hearth/main/hub/install.sh | bash
```

That's it — no Docker. The installer checks for Node 18+, drops the hub into `~/.hearth`,
starts it **in the background**, and prints a **claim code**. Open your Hearth dashboard →
**"Connect a hub"** and enter it. Once claimed, the hub advertises itself on your LAN,
ingests your ESP32 nodes, and the dashboard shows the hub **Online** with its devices.

Manage the service any time:

```bash
~/.hearth/hearthctl status     # running? paired? how many nodes ingested?
~/.hearth/hearthctl code       # reprint the pairing claim code (if still unpaired)
~/.hearth/hearthctl logs       # follow the log
~/.hearth/hearthctl restart    # e.g. after a reboot
~/.hearth/hearthctl stop
```

To start on boot, add `~/.hearth/hearthctl start` to your crontab (`@reboot`) or a login script.

### One process, both faces

Everything runs in a **single Node process** (`hub.mjs`) so there is nothing to desync:

- **Up to the cloud** — pairs the hub to your account (enroll → claim code → hub token) and
  heartbeats. The hub token is held **in memory** and used directly by the device sync.
- **Down to the LAN** — advertises `_hearth._tcp` over mDNS so ESP32 nodes discover it with
  zero config, ingests their `DESCRIBE` + `READING` documents, and syncs the live registry
  up to the cloud every ~15s (immediately when a new node appears).

```
node (ESP32)                         hub (hub.mjs)                    Hearth Cloud
 │                          advertise _hearth._tcp.local (mDNS)
 │  browse _hearth._tcp ──────────▶ resolve hub IP:port
 │  POST /ingest  DESCRIBE ───────▶ register node + sensor menu
 │  POST /ingest  READING  ───────▶ update latest readings ──────▶ POST /hub/devices
                                    curl :8899/nodes to inspect      (per-account, → Qwen/MCP)
```

> **Why one process?** An earlier design split pairing and node-ingest into two scripts that
> handed the hub token off through `~/.hearth/hub-state.json`. That file-based handoff desynced
> whenever the path/mount changed underneath the reader (e.g. a recreated directory behind a
> Docker bind mount) — the hub would show **Online** (pairing fine) but sync **zero devices**
> (ingest couldn't see the token). Merging both into `hub.mjs` with an in-memory token removes
> the race entirely.

### Watches run here — fire → actuate → notify

The hub doesn't just collect readings; it **runs the rule engine** and acts. `runtime.mjs`
loads your compiled watches, evaluates them against live node readings every tick (and on every
fresh reading), and on a rising edge it **fires**: it drives a real actuator on the node and
sends you a real phone notification.

```
node (ESP32)                      hub (hub.mjs + runtime.mjs)
 │  POST /ingest  READING ───────▶ ReadingStore → evaluate(watch.expr)   engine.mjs
 │                                   │ rising edge + cooldown → FIRE
 │  ◀── POST /actuate {led:on} ──────┤ actuate: drive the node's GPIO
 │      (LED lights / relay flips)   └ notify: push to your phone ──────▶ ntfy / Telegram
```

- **`engine.mjs`** is a faithful port of the browser demo's evaluator
  (`frontend/src/demo/engine/*`) — it interprets the exact `PredicateNode` grammar Qwen emits,
  so a watch authored in the cloud runs unchanged on the hub, against **real wall-clock time**.
- **Watches** are read from `~/.hearth/watches.json` (override `HUB_WATCHES_FILE`). Author one in
  plain English in the Hearth app (real Qwen compiles the spec) and drop it in, or start from
  [`watches.example.json`](watches.example.json). Only `kind: "local"` watches run on the hub;
  vision (cloud) watches still run in the app.
- **Notifications** (`notify.mjs`): set `NTFY_TOPIC` (install the free **ntfy** app, no account) or
  `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`. With neither set, fires still actuate + log; you just
  don't get a push. Nothing is faked — a channel reports delivered only when the provider accepts it.
- **It works offline.** Evaluation and actuation happen on the hub; cutting the internet doesn't stop a local watch from firing.

Try the whole loop with no hardware:

```bash
node hub/tools/selftest.mjs                       # asserts fire-once + actuate ON (exits non-zero on failure)
node hub/hub.mjs & node hub/tools/fake-node.mjs   # a software node that heats up until a watch fires
```

### mDNS is optional

mDNS auto-discovery needs the `bonjour-service` package; the installer pulls it via `npm`.
If npm is missing or the install fails, the hub still pairs, ingests, and syncs — nodes just
have to be pointed at it explicitly via `HUB_ENDPOINT` (see [`../firmware`](../firmware))
instead of discovering it. Set `HEARTH_NO_MDNS=1` on the installer to skip it deliberately.

### Run it by hand (no installer)

```bash
mkdir -p ~/.hearth
curl -fsSL https://raw.githubusercontent.com/mattrickslauer/hearth/main/hub/hub.mjs -o ~/.hearth/hub.mjs
cd ~/.hearth && npm init -y >/dev/null && npm install bonjour-service   # optional (mDNS)
node ~/.hearth/hub.mjs                                                  # foreground
curl http://localhost:8899/nodes                                       # inspect the registry
```

## Pairing flow (device-initiated claim code)

```
hub                          cloud                         user (dashboard)
 │  POST /hub/enroll ───────────▶ mint claim code
 │  ◀─────────── { hubId, claimCode }
 │  print claim code (→ claim-code.txt)
 │                                                enter code → POST /hub/claim
 │                              bind hub ◀──────────────────────┘
 │  POST /hub/poll ────────────▶ (claimed) → issue hub token
 │  ◀─────────── { hubToken }
 │  POST /hub/heartbeat ───────▶ liveness + revocation check   dashboard shows "Online"
 │  POST /hub/devices  ────────▶ device registry + readings    dashboard shows devices
```

- The **enrollment token** is a 32-byte secret the hub generates once and keeps forever. It's
  the only credential that can redeem a hub token, so a guessed claim code can't hijack a hub.
- The **claim code** is short, single-use, and expires in 15 min.
- The **hub token** is a long-lived JWT (`aud: hearth-hub`). Unpairing deletes the hub record,
  which heartbeat **and** device sync re-check — so the stateless token is effectively revoked
  on the next beat/sync (401/403 → the hub drops it and re-enrolls, surfacing a fresh code).

## Options (env)

- `BACKEND_URL` — backend base URL (default: **Hearth Cloud**; `http://localhost:9000` for local dev)
- `HUB_NAME` — display name shown on the dashboard (default: the machine's hostname)
- `HEARTH_HOME` — where the hub, identity, logs, and PID live (default `~/.hearth`)
- `HUB_PORT` — LAN ingest port (default `8899`)
- `HUB_SYNC_MS` — device sync cadence (default `15000`)
- `HUB_FW` — reported firmware string
- `HEARTH_NO_MDNS=1` — install/run without mDNS
- `HUB_WATCHES_FILE` — compiled watches to run (default `~/.hearth/watches.json`)
- `HUB_TICK_MS` — watch re-evaluation cadence for time-based predicates (default `1000`)
- `NTFY_TOPIC` (+ optional `NTFY_URL`) — phone push via ntfy on a watch firing
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — phone push via Telegram on a watch firing
- `--reset` — forget stored identity and enroll fresh

Identity persists to `~/.hearth/hub-state.json`, so restarting keeps the same hub.

## Legacy split scripts

`hearth-hub.mjs` (pairing only) and `agent.mjs` (node ingest only) are the original
two-process scripts, kept for local development and reference. **Prefer `hub.mjs`** — it is
what the installer ships and what avoids the token-handoff desync described above.

## Local development

```bash
cd backend && npm run dev                      # → http://localhost:9000
BACKEND_URL=http://localhost:9000 node hub/hub.mjs
```

> **Deploy note:** the installer points hubs at the deployed Function Compute backend, which
> serves the `/hub/*` routes. When backend hub code changes, redeploy so prod stays current:
> `cd backend && npm run build && export FC_CODE_TEMP_OSS_ENDPOINT=oss-ap-southeast-1.aliyuncs.com && \`
> `set -a; . ./.env; set +a; s deploy -y`. FC uses an in-memory store, so hub pairings and
> synced devices do not survive cold starts yet — wiring Tablestore (`HEARTH_STORE=tablestore`)
> makes them durable.
