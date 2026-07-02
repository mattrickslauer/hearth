# 00 — Capabilities (neutral, tech-agnostic)

What the system *needs to be able to do*, described without naming any vendor or product.
Stack choices live in `01-infra-alibaba-cloud.md` and are deliberately deferred until this
list feels complete. If a capability here is wrong, fix it here first.

**Global constraints that shape every choice**
- **Scale-to-zero / cheap-at-idle** — a hobby-scale project on a **$40 credit** budget; idle cost must approach zero.
- **Intermittent edge link** — the on-site hub may lose connectivity; nothing may hard-depend on a live cloud link.
- **Privacy-first** — raw video/audio and identities stay local by default; only minimized, event-driven data leaves the home.
- **Judge-accessible without hardware** — the whole system must be demonstrable via a hosted build + a simulated home.
- **English, open-source, original work** (submission rules).

---

## C1 — Reasoning (the brain): text + vision
- Run open-ended reasoning over structured context (the home model + recent data).
- **Authoring:** turn a natural-language intent into a structured deployment (which inputs, logic, action).
- **Runtime:** answer a bound question over live data, including **image understanding** (vision).
- Tool/function calling so the model can *act* through a defined interface.
- Constraint: token-frugal (few, event-driven calls) to survive the credit budget.

## C2 — Backend compute (API + agent orchestration)
- Host the API the app and hub talk to; run the authoring + runtime reasoning orchestration.
- Event/HTTP triggered, **scales to zero**, no always-on VM.
- Runs our language of choice; modest CPU/memory (no model hosting — reasoning is a hosted API).

## C3 — Source-of-truth store: the Home Model ("digital twin")
- Durable, authoritative record of homes → zones → devices → inputs → records → questions/runs → channels → context.
- Read/written by the app (authoring) and read by the hub (config pull).
- Document-shaped (nested JSON), low write volume, needs cheap-at-idle.

## C4 — Observation store: readings, run results, timelines
- Append-heavy time-series of sensor samples + run answers/events (the "recorded" timelines).
- Query by device + time range for the app's scrubbable timeline.
- Retention policy (keep last N per record); cheap at rest.

## C5 — Blob store: snapshots (images / audio clips)
- Store interval snapshots (JPEG frames, short audio) produced by Record policies.
- Serve them to the app via **time-limited, credential-free links** (so the backend stays thin).
- Lifecycle/expiry to control cost; privacy-scoped access.

## C6 — Edge↔cloud sync (hub connectivity)
- Bidirectional, **tolerant of intermittent links**: config flows *down* to the hub, observations flow *up*.
- Buffer + reconcile after reconnect (no data loss, no duplicate actions).
- Lightweight on the hub; ideally a recognized device/twin model with offline shadow semantics.

## C7 — Realtime push to the app
- Push live state, new run answers, and snapshot arrivals to the app without polling.
- Bidirectional or server→client is enough; must work behind mobile networks.

## C8 — Secret / connection storage
- Securely store integration credentials (chat/SMS/email tokens, third-party device creds).
- Runtime retrieval (no secrets in code); rotation-friendly.
- Split: hub-local secrets on the hub; cloud-side secrets in a managed vault.

## C9 — Outbound notification channels (Actions)
- Deliver an Action to the user: **mobile push, SMS, email, chat (e.g. Telegram)**.
- Pluggable — new channels are just adapters. Per-message billing acceptable.

## C10 — Static hosting for the app's web build
- Serve the Expo **web** export (judge-accessible URL) over CDN, cheap at idle.

## C11 — Identity & access (user ↔ home ↔ hub)
- Authenticate a user; authorize them to their home(s) and hub(s).
- Pair a physical hub to an account securely.
- For judging: a demo/guest path into a simulated home with no friction.

## C12 — Observability
- Logs/metrics/traces for the backend and the agent's decisions (also feeds the audit trail).
- Enough to debug a live demo; nothing heavyweight.

---

## Explicit non-goals (v1)
Multi-tenant scale, billing/monetization, high availability/DR, model *hosting* (we call a hosted
model), broad third-party device integration (discover-and-list only), fleet management across
many homes.

## Open questions that affect capabilities (not stack)
1. Does the hub need to *fully* function offline (author new questions offline), or only *run*
   already-deployed ones offline? (Leaning: run-only offline; authoring needs the cloud brain.)
2. Is audio a v1 input or v2? (Affects C1/C5.)
3. Do we need per-user auth for v1, or is a single-home + guest-demo enough? (Affects C11.)
