# 06 — Demo Video Script (≤ 3:00) — DASHBOARD cut

Submission video for **Track 5: EdgeAgent**. Target runtime **~2:40** (hard cap 3:00). Format: 1080p+, YouTube/Vimeo/Youku.
This cut is a **product demo**, told through **one screen**: the Hearth dashboard, in a **PROOF-LAST** structure — five
movements, one peak. We run a single lived scenario, build to the hardware fire as the *final* spectacle, then collapse
**cheap + the Qwen wiring AI + open** into the close as the punchline (never explain after the peak). The dashboard IS
the story; the hardware is the payoff; the "platform you build on" is the last word.

**Legend:** `[CAM]` you to camera · `[SCREEN]` dashboard capture (the visual spine) · `[SHOOT]` real hardware in frame ·
`[VO]` voiceover.

**The through-line:** one continuous scenario — *"keep the nursery under 78."* You describe it, Qwen compiles it into a
**watch**, you warm a real sensor with your hand, and the whole chain lights up **on the dashboard**: the sensor tile
climbs, the watch flashes, the activity feed streams **Fired · Actuated · Notified**, and your phone buzzes. Everything
the viewer sees is a real string on the real screen (`frontend/src/app/dashboard.tsx`).

**Cadence:** three registers — `[CAM]` slow + warm · `[SCREEN]` brisk, pointing · `[PROOF]` slowest, let the hardware
breathe. Rule of three is the metronome ("hubs, clouds, apps" · "76, 78, 79" · "Fired, Actuated, Notified"). Two golden
silences: ~1.5s after *"there's my phone"*, and a full stop before *"Clone it."* Deliver ~135 wpm so the pauses land.

---

## Script

| # · Movement | Time | Visual | Audio |
|---|---|---|---|
| **1 · HOOK** | **0:00–0:14** | `[CAM]` You, direct to camera. Slow, warm. | "Home automation is closed. Closed hubs, closed clouds, closed apps — you rent your own house back from whoever sold you the gadget. So we opened the whole stack. This is Hearth… and this is my home, on one screen." |
| **2 · THE SCREEN** | **0:14–0:44** | `[SCREEN]` One continuous move: land on **"Your home"** + the live chips (**hubs · devices · sensors · watches**), scroll to **Sensors**, point at the green **"live"** badge, a tile's **heartbeat** ping, then drag a **cadence slider** `60s → 0.5s`. | `[VO]` "*Your home.* Everything here is live — my hubs, my devices, my sensors, my watches. See that green dot — *live*? That's a real stream off the hub in my house. Every tile has a heartbeat — watch it pulse when a reading lands. I can dial any sensor right here — once a minute, or twice a second." |
| **3 · THE ASK** | **0:44–1:16** | `[SCREEN]` **Describe a new watch** card. Type *"If the nursery goes over 78, cut the heater and text me."* → **Author →** → a new **watch card**: **`when temperature over 78 → turn heater off, notify me`**, tagged **`local`**. Zoom the **`local`** tag. | `[VO]` "Now, the good part. I don't write code — I just say what I want. *If the nursery goes over seventy-eight, cut the heater and text me.* I hit **Author**… and Qwen turns that one sentence into a running watch. There it is — over seventy-eight, heater off, notify me. See that little *local* tag? That rule runs on the hub, in my house — cut the internet, it still fires." |
| **4 · THE PROOF** *(peak)* | **1:16–1:48** | **One continuous take, hardware + screen in frame. Slowest register — let it breathe.** `[SHOOT]` cup the ESP32; `[SCREEN]` temp tile climbs `76 → 78 → 79`, **watch card flashes ember**, **Activity** streams **`🔥 Fired · ⚡ Actuated · 📨 Notified`**. `[SHOOT]` **phone buzzes** — hold ~1.5s of silence on it. | `[VO]` "So let's make it real. I warm this sensor with my hand… the tile climbs — seventy-six… seventy-eight… seventy-nine — the watch flashes, and the feed lights up: Fired… Actuated… Notified. And — *[phone buzzes]* — …there's my phone. Real sensor. Real rule. Real alert. No cloud required." |
| **5 · CLOSE** | **1:48–2:25** | `[SCREEN]` 3s **wiring-assistant** flash: type *"add a soil sensor"* → Qwen returns a **pin recipe** `VCC→3V3 · GND→GND · signal→GPIO4`. Then `[CAM]` to camera over the end card: **Hearth · open source · built on Qwen Cloud · \<repo URL\>**. Full stop before "Clone it." | "And here's the thing. That whole loop? A five-dollar chip, and one sentence to Qwen. Don't know how to wire it? Just ask — Qwen tells you which pin goes where. It's open, from the sensor to the cloud. This isn't the finished product — it's the platform you build it on. Clone it… and go build." |

**Total: ~2:40 with the pauses** (~275 spoken words; the silences + the board-warming beat carry the rest). Buffer if long:
trim the cadence-slider drag in Movement 2 (~4s) or the wiring flash in Movement 5 (~3s). Don't cut the two golden silences.

---

## Quick-build features that make the demo sing (in priority order)

Small, mostly-frontend wins so the on-camera footage is **real by shoot day** — not narrated over a static screen. The
speech above already assumes #1 and #2; they're the load-bearing ones. Each is scoped to be a same-day build.

| # | Feature | Why it lands on camera | Rough scope |
|---|---|---|---|
| **1 — REQUIRED** | **Live-streaming Activity feed + watch-card "fired" flash.** When a watch fires, the Activity feed appends `🔥 Fired · ⚡ Actuated · 📨 Notified` **without a manual Refresh**, and the firing watch card pulses ember for ~1s. | This is the 1:16–1:45 payoff. Right now the feed only updates on `↻ Refresh` — on camera it must stream so "Fired… Actuated… Notified" appears *as you warm the board*. | Reuse the existing `useHubLive` WebSocket to also push run-events (or poll `listEvents(20)` every ~2s while recording); add an `Animated` ember flash to the card whose `watchId` matches the newest `fired` event. |
| **2 — REQUIRED** | **"Test fire" button on each watch card.** A small `Test →` next to Edit/Delete that triggers the watch's action chain on cue. | Insurance for the hero take: the hand-warm is the star, but a deterministic on-cue trigger means you get clean footage on the first pass and can re-shoot the screen half without re-warming hardware. It's a *real* fire, just hand-triggered. | New button → POST to a `runWatch(id)` endpoint the hub already has the plumbing for (it fires + actuates + notifies + logs the same events). |
| **3 — REQUIRED** | **Qwen wiring assistant — "Add a device."** A dashboard card (or the existing "Build your own node" page) where you type a sensor in plain words (*"add a soil sensor"*) and Qwen returns a short **wiring recipe** — `VCC→3V3 · GND→GND · signal→GPIO4` — plus the one-line flash command and the `DESCRIBE` it'll announce. | Carries the whole 1:45 "baseline infrastructure" beat. Sells Hearth as *cheap + buildable* — anyone can add hardware without a datasheet — which is the platform thesis. | A single Qwen call with a system prompt that maps a requested sensor → GPIO pinout for the ESP32 pin map + the matching firmware flag (`SENSOR_PIN`, `DHT_PIN`, etc.). Pure NL-in / recipe-out; no new hardware path — the node still self-describes on flash. Reuses the existing Qwen client. |
| **4 — nice** | **"Armed" status line under "Your home."** A pill/line like **`Armed · 3 watches running locally`** under the H1. | Gives the presenter a crisp vocal anchor at 0:13 ("every number here is live") and sells *autonomy* at a glance. | Pure copy + one derived count (`watches.filter(runsLocally).length`); reuse the existing `Pill`. |
| **5 — nice** | **Fire toast.** A slide-in toast on a fresh `fired` event: **`🔥 Nursery 79° — heater off. You're notified.`** | A second, unmissable "it just happened" beat for the payoff — reads even on a phone-sized recording. | Small `Animated` toast fed by the same event stream as #1. |
| **6 — optional** | **Big value flash on threshold cross.** The temp tile's number briefly turns ember/red as it crosses the watch's threshold. | Makes the `76 → 78 → 79` climb pop and visually ties the *sensor* to the *rule*. | Compare the incoming reading to the active watch's threshold in `SensorTile`; flash via the existing `pulse` value. |

**Honesty guardrail:** #1–#3 are real behaviors — the hub already fires/actuates/notifies and logs the events, and the
wiring assistant is a thin Qwen prompt over the real ESP32 pin map (the node still self-describes on flash). We're
surfacing what's there and adding an on-cue trigger. Nothing in the speech claims a capability the stack doesn't have.

---

## On-screen strings the presenter points at (all real, all shipped)
Verified against `frontend/src/app/dashboard.tsx`. Match the spoken word to the pixel.

- Header: **`Your home`** · chips **`hubs` `devices` `sensors` `watches`** · **`↻ Refresh`**
- Sensors: live badge reads **`live`** (green, breathing) / `connecting…` / `hub offline`; per-tile **heartbeat** ping, **TTL bar**, **cadence slider** readout `0.5s … 60s`; boolean sensors read **`on`/`off`**.
- Describe card: title **`Describe a new watch`**, placeholder **`Warn me if the garage is left open after dark…`**, button **`Author →`**.
- Watch card: line **`when <trigger> → <action>`**, tags **`local`** / `cloud` / `vision`, buttons `Edit` / `Delete` (+ **`Test →`** once #2 ships). Edit mode button: **`Re-compile →`**.
- Activity: **`✍️ Authored`** · **`🔥 Fired`** · **`⚡ Actuated`** · **`📨 Notified`** (+ `⏳ Held`, `📡 Offline`, `🔌 Reconnected`), each with a `· <model>` and a `5m ago` timestamp.

**Do NOT show on camera:** the account-menu **`🔥 Live demo`** item or the `/demo` route — this cut is the real dashboard only.

---

## Movement → rubric map
| Movement | Serves |
|---|---|
| 1 · Hook — "we opened the whole stack" | **Innovation + Presentation**: a product, not a gadget |
| 2 · The screen — "Your home", live chips, live sensors, cadence slider | **Presentation + Tech**: the whole home at a glance, streaming off the edge, tunable live |
| 3 · The ask — Describe → Author → watch card (`local` tag) | **Innovation + Tech**: plain words → a running rule via Qwen, fires locally/offline |
| 4 · The proof *(peak)* — hand → tile climbs → feed streams → phone buzzes | **Tech**: the whole chain fires on real hardware, on-screen |
| 5 · The close — $5 chip + Qwen wiring AI + open + "platform you build on" | **Impact + Innovation**: cheap, buildable baseline infra; self-hostable, offline, model-swappable |

## Shot list
- `[CAM]` host takes: hook (0:00), close (1:48 → to camera over the end card).
- `[SCREEN]` dashboard capture: "Your home" + chips; Sensors (live badge, heartbeat, cadence-slider drag); Describe→Author→new watch card; the proof (tile climb + card flash + Activity stream); the 3s **wiring-assistant** flash (type a sensor → Qwen returns the pin recipe); end card.
- `[SHOOT]` the **hero proof take** — hand cupping the ESP32 and the dashboard in one frame, several passes; the **phone buzz** (hold ~1.5s). Optional: a **hand-held $5 board + cheap sensor** insert to cut over the close.

## Production notes
- **Sign in first** — `/dashboard` redirects to `/signin` when signed out; the account email shows in the header pill, so use a clean demo account (e.g. `demo@hearth…`).
- **Get the live badge green before rolling:** the hub must be checked in and streaming so Sensors reads **`live`** (not `connecting…` / `hub offline`). Confirm one tile is updating on its own.
- **Pre-author nothing you'll type on camera** — the nursery watch should be authored *live* in Movement 3 so `✍️ Authored` lands in the feed; but pre-create one or two extra watches so the screen isn't empty.
- **Wiring-assistant capture (Movement 5 close):** pre-run the *"add a soil sensor"* prompt once so you know the exact recipe Qwen returns, then capture it clean. Keep it to the **pin recipe only** (3s) — it's a punchline flash under the close, not a teaching beat.
- **Make the actuator read on camera:** wire a bigger LED or a relay+lamp to the actuator GPIO (`ACTUATOR_PIN`, `ACTUATOR_ACTIVE_HIGH 0` for active-low) so "cut the heater" is visible. Still 100% real.
- **Phone push:** `export NTFY_TOPIC=hearth-<unique>` + the free ntfy app, foregrounded, before recording — so the buzz + banner land on the hero take.
- **Ship features #1, #2 and #3 (above) before the shoot** — the live feed + Test button carry the payoff; the wiring assistant carries the "baseline infrastructure" beat. Without them those beats are narrated over a static screen.

## Open calls (yours)
1. **Scenario** — "nursery over 78" is filmable today (board temp + relay + notify). Swap the noun (fridge, greenhouse, garage) if a different room shoots better, but keep it **temperature-based** so it matches the real fire.
2. **Voice** — VO in post, or on-camera throughout?
3. **Which quick-build features to land** — #1, #2 and #3 (wiring assistant) are load-bearing; #4–6 are polish that add vocal punch if there's time.
4. **Firmware still needs an on-device flash to verify** the actuator before the payoff shot (no ESP toolchain in CI).
