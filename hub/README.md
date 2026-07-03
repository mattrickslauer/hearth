# Hearth hub (edge agent)

The hub is the on-prem device (a Raspberry Pi) that runs watches locally and syncs with
Hearth Cloud. Before it can do anything it must be **paired to an account**. This directory
holds a reference client for that pairing handshake — `sim-hub.mjs` simulates the Pi so the
whole flow is demoable on a laptop, and the real Pi agent implements the same four calls.

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

## Run the simulator

Start the backend first (`cd backend && npm run dev` → `:9000`), then:

```bash
node hub/sim-hub.mjs
# → prints a claim code; type it into the dashboard's "Connect a hub" card
```

Options (env):

- `BACKEND_URL` — cloud base URL (default `http://localhost:9000`)
- `HUB_NAME` — display name shown on the dashboard (default `Simulated Pi`)
- `HUB_FW` — reported firmware string
- `--reset` — forget stored identity and enroll fresh

Identity persists to `hub/.sim-hub-state.json` (gitignored), so re-running keeps the same hub.
```
