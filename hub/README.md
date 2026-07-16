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
- **Watches arrive from the cloud.** Describe one in plain English in the Hearth app; Qwen compiles
  it, and this hub adopts it on its next device sync — debounced onto live readings, so it's running
  on your hardware about a second later. Nothing to copy, nothing to restart. Editing or deleting it
  in the app propagates the same way. Only `kind: "local"` watches run here; vision (cloud) watches
  still run in the app.
  - The set is cached to `~/.hearth/watches.json` (override `HUB_WATCHES_FILE`), so a hub that
    reboots with no internet keeps running the last-known watches. Hand-write that file to run
    **unpaired** or to test without the app — see [`watches.example.json`](watches.example.json).
  - **Reference inputs as `<nodeId>.<sensorKey>`** (e.g. `node-a1b2.board.temp`) — the same id the
    cloud uses. A bare `board.temp` resolves only while exactly one node reports it; with two, the
    hub warns and reads no-data rather than firing on whichever node reported last.
- **Notifications** (`notify.mjs`): set them up in the **dashboard** — *Notify me* takes a Telegram
  chat and/or an email address, saved per account, and every hub you pair uses them. The hub POSTs a
  fire to the cloud (`/hub/notify`), which does the delivery, so your bot token stays in the cloud
  rather than on this box.
  This machine can also push **directly**, configured by whoever runs the hub: set `NTFY_TOPIC`
  (install the free **ntfy** app, no account) or `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`. These
  are independent of the account's channels and **both sets fire on every watch** — so a direct
  push still lands when the cloud is unreachable (the off-grid guarantee), and adding an email in
  the dashboard never silently switches your ntfy push off. With nothing configured anywhere, fires
  still actuate + log; you just don't get a push. Nothing is faked — a channel reports delivered
  only when the provider accepts it. Prove it with `npm run notify-selftest`.
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
- `HUB_BIND` — interface the LAN server binds (default `0.0.0.0`; narrow to a specific interface to reduce exposure)
- `HUB_INGEST_TOKEN` — when set, `/ingest`, `/nodes` and the `/live` WS require it (header `x-hearth-token`, or `?token=` for the browser WS). Unset = open to the LAN (back-compat)
- `HUB_SYNC_MS` — device sync cadence (default `15000`)
- `HUB_FW` — reported firmware string
- `HEARTH_NO_MDNS=1` — install/run without mDNS
- `HUB_WATCHES_FILE` — compiled watches to run (default `~/.hearth/watches.json`)
- `HUB_TICK_MS` — watch re-evaluation cadence for time-based predicates (default `1000`)
- `NTFY_TOPIC` (+ optional `NTFY_URL`) — direct phone push via ntfy on a watch firing
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — direct phone push via Telegram on a watch firing
  (these are this machine's own channels, additional to the account's — set those in the dashboard
  under *Notify me*; both sets fire)
- `HUB_NOTIFY_TIMEOUT_MS` — how long a cloud notify may take before the direct push stops waiting
  on it (default `8000`)
- `--reset` — forget stored identity and enroll fresh

Identity persists to `~/.hearth/hub-state.json`, so restarting keeps the same hub.

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
