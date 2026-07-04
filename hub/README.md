# Hearth hub (edge agent)

The hub is the on-prem device — a Raspberry Pi, a spare laptop, a mini PC — that runs
watches locally and syncs with **Hearth Cloud** (the platform backend on Alibaba Function
Compute).

The hub has two faces:

- **Up to the cloud** — `sim-hub.mjs` runs the pairing handshake that binds the hub to an
  account (a single zero-dependency Node script; **[Pairing flow](#pairing-flow-device-initiated-claim-code)** below).
- **Down to the LAN** — `agent.mjs` **discovers and ingests nodes**. It advertises itself
  over mDNS as `_hearth._tcp`, so ESP32 nodes find it with zero configuration, then it
  receives their `DESCRIBE` + `READING` documents into a live registry
  (**[Nodes](#nodes-auto-discovery--ingest)** below).

## Nodes: auto-discovery + ingest

`agent.mjs` is the node-facing side. You never tell a node where the hub is — the hub
announces itself and the node browses for it:

```
node (ESP32)                         hub (agent.mjs)
 │                          advertise _hearth._tcp.local  (mDNS)
 │  browse _hearth._tcp ──────────▶ resolve hub IP:port
 │  POST /ingest  DESCRIBE ───────▶ register node + its sensor menu
 │  POST /ingest  READING  ───────▶ update latest readings  (every few seconds)
```

Run it (one dependency, `bonjour-service`, for mDNS):

```bash
cd hub && npm install && node agent.mjs      # ingest on :8899, advertises on the LAN
curl http://localhost:8899/nodes             # inspect the live registry
```

Flash a node (see [`../firmware`](../firmware)) with **empty** Wi-Fi/endpoint config beyond
the SSID, and it will discover this hub and start reporting on its own.

### Syncing devices to Hearth Cloud

Once the hub is paired (`node hearth-hub.mjs` → claim it in the dashboard), `agent.mjs`
also pushes its registry **up to Hearth Cloud** every ~15s (and immediately when a new node
appears), authenticated with the hub token from `~/.hearth/hub-state.json`. The cloud folds
each ESP32 into that account's **Home Model** and its readings into the time series — so the
existing MCP tools (`describe_home`, `list_hub_devices`, `read_input`, `query_history`) and
Qwen-authored Questions all operate on **real hardware**. Until the hub is paired it just
logs `not paired` and keeps serving the LAN. Override the target with `BACKEND_URL`.

`sim-hub.mjs` is a single, zero-dependency Node script (Node 18+, global `fetch`). It runs the
same four-call pairing handshake on your laptop today and on the real Pi later.

## Install & run (end users)

```bash
curl -fsSL https://raw.githubusercontent.com/mattrickslauer/hearth/main/hub/install.sh | bash
```

The installer checks for Node 18+, downloads `hearth-hub.mjs` into `~/.hearth/`, and starts
it. The agent prints a **claim code** — open your Hearth dashboard → **"Connect a hub"** and
enter it. Once claimed, the hub heartbeats every 30s and the dashboard shows it **Online**.

Prefer to run it by hand (no `curl | bash`)? Download the one file and run it:

```bash
mkdir -p ~/.hearth && curl -fsSL \
  https://raw.githubusercontent.com/mattrickslauer/hearth/main/hub/hearth-hub.mjs \
  -o ~/.hearth/hearth-hub.mjs
node ~/.hearth/hearth-hub.mjs
```

### Keep it running (daemon)

`hearth-hub.mjs` runs forever in the foreground. To keep it alive across reboots, wrap it in
a service manager — e.g. a `systemd` unit on Linux/Pi:

```ini
# /etc/systemd/system/hearth-hub.service
[Unit]
Description=Hearth hub
After=network-online.target

[Service]
ExecStart=/usr/bin/node %h/.hearth/hearth-hub.mjs
Restart=always

[Install]
WantedBy=default.target
```

`launchd` (macOS), `pm2`, or `nohup … &` work too.

## Pairing flow (device-initiated claim code)

```
hub                          cloud                         user (dashboard)
 │  POST /hub/enroll ───────────▶ mint claim code
 │  ◀─────────── { hubId, claimCode }
 │  print claim code
 │                                                enter code → POST /hub/claim
 │                              bind hub ◀──────────────────────┘
 │  POST /hub/poll ────────────▶ (claimed) → issue hub token
 │  ◀─────────── { hubToken }
 │  POST /hub/heartbeat ───────▶ liveness + revocation check   dashboard shows "Online"
```

- The **enrollment token** is a 32-byte secret the hub generates once and keeps forever. It's
  the only credential that can redeem a hub token, so a guessed claim code can't hijack a hub.
- The **claim code** is short, single-use, and expires in 15 min.
- The **hub token** is a long-lived JWT (`aud: hearth-hub`). Unpairing deletes the hub record,
  which the heartbeat re-checks — so the stateless token is effectively revoked on next beat.

## Options (env)

- `BACKEND_URL` — backend base URL (default: **Hearth Cloud**; set to `http://localhost:9000` for local dev)
- `HUB_NAME` — display name shown on the dashboard (default: the machine's hostname)
- `HEARTH_HOME` — where identity + the agent live (default `~/.hearth`)
- `HUB_FW` — reported firmware string
- `--reset` — forget stored identity and enroll fresh

Identity persists to `~/.hearth/hub-state.json`, so re-running keeps the same hub.

## Local development

Point the agent at a locally-running backend instead of the cloud:

```bash
cd backend && npm run dev            # → http://localhost:9000
BACKEND_URL=http://localhost:9000 node hub/hearth-hub.mjs
```

> **Deploy note:** the downloadable installer points hubs at the deployed Function Compute
> backend, which serves the `/hub/*` routes (verified live). When backend hub code changes,
> redeploy so prod stays current: `cd backend && npm run build && \`
> `export FC_CODE_TEMP_OSS_ENDPOINT=oss-ap-southeast-1.aliyuncs.com && \`
> `set -a; . ./.env; set +a; s deploy -y`. FC uses an in-memory store, so hub pairings do
> not survive cold starts yet — wiring Tablestore (`HEARTH_STORE=tablestore`) makes them durable.
