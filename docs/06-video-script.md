# 06 — Demo Video Script (≤ 3:00) — ECOSYSTEM-UNVEILING cut

Submission video for **Track 5: EdgeAgent**. Target runtime **2:55**. Format: 1080p+, YouTube/Vimeo/Youku.
This cut is an **unveiling of an open-source ecosystem**, told **architecture-first**: the four open layers, the one
self-describing contract that composes them, and the catalog of solutions you can wire up from the same parts. The
real end-to-end hardware loop appears as *proof*, not as the whole story.

**Legend:** `[CAM]` you to camera · `[GFX]` generated graphic/overlay (the architecture diagram is the visual spine) ·
`[SCREEN]` app/terminal capture · `[SHOOT]` real hardware footage · `[VO]` voiceover over B-roll.

---

## The spine: the architecture diagram (build it up layer by layer as you narrate)

The hero graphic. The VO climbs the stack from the edge, so **reveal it bottom-to-top — Nodes → Hub → Cloud → App —**
one layer lighting up per beat, then pull back to the whole stack for the close. A polished, theme-aware web version to
screen-record is published as an Artifact (see "Architecture GFX" below).

```
        YOU ── plain words ─┐
                            ▼
   ┌───────────────────────────────────────────────────┐
   │  APP        web · mobile · zero-hardware simulator  │   describe · watch CRUD · activity feed
   └───────────────────────────┬───────────────────────┘
                               │  HTTPS · MCP
   ┌───────────────────────────▼───────────────────────┐
   │  CLOUD      Hearth on Alibaba Function Compute      │   Qwen brain + MCP tool surface
   │             author_question (NL → watch) ·          │   list_devices · read_input · query_history · notify
   └───────────────────────────┬───────────────────────┘
                               │  pair (claim code) · device + reading sync
   ┌───────────────────────────▼───────────────────────┐
   │  HUB        Raspberry Pi / laptop — the edge agent  │   mDNS discovery · rule engine ·
   │             fires LOCALLY · works OFFLINE           │   actuate + notify on a watch firing
   └──────────────▲───────────────────────┬────────────┘
        _hearth._tcp (discover)           │  POST /actuate
        DESCRIBE · READING (up)           ▼
   ┌───────────────────────────────────────────────────┐
   │  NODES      self-describing ESP32 kit               │   flash → it announces what it can
   │             sense  →  temp · humidity · door ·      │   sense AND do; the hub needs zero
   │             motion · distance · RFID · camera       │   prior knowledge of any node
   │             do     →  relay · LED · servo           │
   └───────────────────────────────────────────────────┘
```

**The one idea that makes it an ecosystem — three open contracts:**
1. **Self-describe** — every node emits `DESCRIBE` (what I sense + do) + a `READING` stream + accepts `/actuate`. Add hardware, nothing upstream changes.
2. **The compiled watch** — Qwen turns plain words into one portable `PredicateNode` spec that runs **unchanged** in the browser sim *and* on the hub.
3. **MCP** — every capability of the home is a standard tool call, so *any* agent (not just Hearth's app) can perceive and act.

---

## Script

| Time | Visual | Audio |
|---|---|---|
| **0:00–0:14** | `[CAM]` You, direct to camera. | "Home automation is closed. Closed hubs, closed clouds, closed protocols — you rent your own house back from whoever sold you the gadget. Today we're opening the whole stack." |
| **0:14–0:24** | `[GFX]` Title: **Hearth — an open-source operating system for your home.** Then the empty architecture frame fades in. | "This is Hearth. Four open layers, held together by one idea: your hardware describes itself, and an AI wires it up." |
| **0:24–0:52** | `[GFX]` **NODES** layer lights up. `[SHOOT]` hands flash an ESP32; `[SCREEN]` serial: `DESCRIBE … can sense: … · can do: …`. `[GFX]` a **node catalog** montage fans out (temp, humidity, door, motion, distance, RFID, camera, relay) — each stamped with the same `DESCRIBE` badge. | `[VO]` "Start at the edge. A Hearth node is a cheap ESP32 you flash — and it introduces itself: here's what I can sense, here's what I can do. Temperature, a door, motion, distance, RFID, a camera, a relay — the same self-describing contract for every one. Add a new sensor, nothing upstream changes." |
| **0:52–1:15** | `[GFX]` **HUB** layer lights up; an animated line shows a node auto-discovering the hub (`_hearth._tcp`). `[SCREEN]` hub terminal: `+ NEW NODE …`. `[GFX]` "rule engine · fires locally · works offline" badges. | `[VO]` "Those nodes find your hub on their own — no addresses, no setup. The hub is the edge agent — a Pi, a spare laptop. It runs the rule engine right there in your house, so your automations fire locally, and keep firing with the internet cut." |
| **1:15–1:45** | `[GFX]` **CLOUD** layer lights up. `[SCREEN]` Describe a wish → **Compile ↵** → **QWEN IS COMPILING** → watch card. `[GFX]` the **MCP tool surface** as a labeled bus (author_question · list_devices · read_input · notify) with an "any agent" arrow tapping in. | `[VO]` "Above the hub sits the brain: Qwen, on Alibaba Cloud. This is where plain words become a running system — you describe what you want, Qwen compiles it into a watch. And every capability of your home is exposed as an MCP tool, so any agent — not just ours — can see your devices and act. Open standard, not a walled garden." |
| **1:45–1:58** | `[GFX]` **APP** layer lights up; quick pan of dashboard (web + mobile) and the `/demo` simulator. Pull back to reveal the **whole stack** glowing. | `[VO]` "And on top, any app — web, mobile, or a full simulator you can try right now with zero hardware." |
| **1:58–2:22** | `[GFX]` **Solutions montage** — the same 4-layer stack re-skinned fast for each use case (icons snapping into the NODES row): warmth+heater · doorway+camera+RFID · motion+light · tank distance at the grid edge. Each ends on the same tag: **plug in · describe · done.** | `[VO]` "Now look what you wire up from the same parts. Warmth and a heater. A doorway, a camera, an RFID tag — so the house knows who's home. Motion and light. A distance sensor watching a tank at the edge of the grid. Every one is the same three moves: plug it in, describe it, done." |
| **2:22–2:40** | **PROOF.** `[SHOOT]` one continuous take: cup the ESP32 in your hand → `[GFX]` temperature climbs → the board's **LED lights** → your **phone buzzes**. Overlay: the diagram's NODES→HUB→(phone) path pulses in sync. | `[VO]` "And it's not a mockup. I warm this board with my hand — the watch fires on the hub, the node lights up, my phone buzzes. The whole stack, end to end, on real hardware." |
| **2:40–2:55** | `[CAM]` You to camera. `[GFX]` end card: **Hearth · open source · built on Qwen Cloud · <repo URL>** over the full architecture diagram. | "Every layer is open source. Self-host it, run it offline, swap the model, build your own node. Clone it — and go wire up your house." |

**Total: ~2:55.** Buffer to trim: the solutions montage (1:58–2:22) can lose ~5s; the app beat (1:45–1:58) ~3s.

---

## Node catalog — showcase honestly (shipped vs buildable)
Show the whole catalog to sell the ecosystem, but keep the split truthful. Everything shares the one `DESCRIBE`/`READING`/`/actuate` contract.

| Node | Senses / does | Status | Notes for the montage |
|---|---|---|---|
| **Board temp** | temperature (built-in) | ✅ shipped | real reading on a bare board; drives the proof shot |
| **DHT11** | temperature + humidity | ✅ shipped | GPIO4, optional |
| **LED / relay** | on/off actuator | ✅ shipped | GPIO2 LED default; relay via `ACTUATOR_PIN` |
| **Door / reed** | open/closed | 🛠 buildable | same contract; not in firmware yet — show as a catalog card, not live |
| **Motion (PIR)** | presence | 🛠 buildable | catalog card |
| **Distance (HC-SR04)** | range / tank level | 🛠 buildable | ties to off-grid / edge monitoring |
| **RFID (RC522)** | identity ("who's home") | 🛠 buildable | pairs with the doorway solution |
| **Camera** | frames for **Qwen-VL** | 🚧 Phase 2 | **do NOT film as live vision** — no camera in firmware, no image sent to a model yet. Present as "the same contract takes a camera next." |

**Honesty guardrail:** ✅ items are filmable as real hardware today. 🛠/🚧 items are shown as **catalog/roadmap cards in the architecture GFX** — the point is the *contract composes*, not that each is wired. Never narrate a buildable node as if it's running.

## Architecture GFX (the hero asset)
A self-contained, theme-aware **web architecture diagram** — the four layers, the node catalog with status, and the three
contracts, in Hearth's ember identity. Source: [`assets/architecture.diagram.html`](assets/architecture.diagram.html).
Live (screen-record this): **https://claude.ai/code/artifact/717df1dd-0654-4bbe-89ee-265825d98c10**
Record a slow reveal (bottom-to-top to match the VO), and key it under the narration. Ask me to tweak layers/labels/colors
and I'll redeploy it to the same URL.

## Beat → rubric map
| Beat | Serves |
|---|---|
| Open-stack hook + layer reveal | **Innovation + Presentation**: it's a platform, not a gadget |
| Self-describing node catalog | **Innovation + Tech**: zero-config, composable edge hardware |
| Hub runs the engine locally / offline | **Tech**: edge autonomy, graceful degradation |
| Qwen NL→watch + MCP tool surface | **Innovation + Tech**: program synthesis + open agent interface |
| Solutions montage | **Impact**: breadth — one architecture, many homes/uses |
| Real hand→LED→phone proof | **Tech**: the whole stack fires on real hardware |
| Open-source close | **Impact + Presentation**: self-hostable, offline, model-swappable |

## Shot list
- `[CAM]` host takes: hook (0:00), close (2:40).
- `[GFX]` architecture diagram with per-layer reveal states; MCP-bus callout; solutions-montage re-skins; end card. (Screen-record the generated web diagram.)
- `[SHOOT]` flashing a board; the **hero proof take** (hand → LED → phone in one frame, several passes).
- `[SCREEN]` serial DESCRIBE, hub `+ NEW NODE`, Describe→Compile watch card, dashboard + `/demo`.

## Production notes
- **Rehearse the whole loop with no hardware:** `node hub/hub.mjs` + `node hub/tools/fake-node.mjs` reproduces fire→LED→push for clean terminal B-roll.
- **Make the LED read on camera:** wire a bigger LED or a relay+lamp to a GPIO (`ACTUATOR_PIN`, `ACTUATOR_ACTIVE_HIGH 0` for active-low). Still 100% real.
- **Phone push:** `export NTFY_TOPIC=hearth-<unique>` + the free ntfy app before recording.
- The browser `/demo` brain reads **"Qwen (simulated)"** by default; set `EXPO_PUBLIC_USE_QWEN=1` if you want the live pill on screen.

## Open calls (yours)
1. **Product name** on the title/end cards — keep "Hearth"?
2. **Voice** — VO in post, or on-camera throughout?
3. **How wide to go on the solutions montage** — the four above are a tight set; add more catalog cards if you want to sell breadth harder (costs a few seconds).
4. **Firmware still needs an on-device flash to verify** the actuator before the proof shot (no ESP toolchain in CI).
