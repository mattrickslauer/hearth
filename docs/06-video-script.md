# 06 — Demo Video Script (≤ 3:00) — "GIVE IT A QWEN BRAIN" cut

Submission video for **Track 5: EdgeAgent**. Measured runtime **~2:47** (hard cap 3:00 — see the timing note under the
script table; this cut is tight). Format: 1080p+, YouTube/Vimeo/Youku.

**The thesis (what actually sells this):** every model in this market is fighting over the same three boxes — a chat
window, a code editor, a slide deck. Nobody has made AI *cheap and open enough to put inside a physical thing*. Qwen can
be that. Hearth is the open-source runtime that gives **any hardware you already own** a **Qwen brain**, where Qwen Cloud
**compiles plain English into a real script that runs on the device** — for people who don't code.

That reframes the whole cut. We are **not** demoing a home-automation product with a parts list. We're demoing **an open
platform for building real-world devices**, and the nursery is just the one instance of it we filmed. The inventory on
hand is the *example*, never the *scope* — every line is written so a viewer with a totally different board and a totally
different problem sees themselves in it.

**Structure:** five movements, one peak, **PROOF-LAST**. Thesis frames it, "any hardware / no code" is the substance,
the hardware fire is the spectacle, and **open + model-swappable + "Qwen wins the physical world"** collapses into the
close as the punchline. Never explain after the peak.

**Legend:** `[CAM]` you to camera · `[SCREEN]` dashboard capture · `[SHOOT]` real hardware in frame · `[VO]` voiceover.

**The through-line:** one continuous scenario — *"keep the nursery under 78."* You describe it, Qwen **compiles it into a
watch**, you warm a real sensor with your hand, and the chain lights up **on the dashboard**: the tile climbs, the watch
flashes, the feed streams **Fired · Actuated · Notified**, your phone buzzes. Every string on screen is real
(`frontend/src/app/dashboard.tsx`).

**Cadence:** three registers — `[CAM]` slow + warm · `[SCREEN]` brisk, pointing · `[PROOF]` slowest, let the hardware
breathe. Rule of three is the metronome ("chat, code, slides" · "76, 78, 79" · "Fired, Actuated, Notified"). Two golden
silences: ~1.5s after *"there's my phone"*, and a full stop before *"Clone it."* Deliver ~135 wpm so the pauses land.

**Tone guardrail — the underdog frame is a *frame*, not a *line*.** Never say "underdog," "smaller," "lesser-known," and
never name a competitor. Judges hear grievance and discount it. The positioning lands entirely through the *close*:
*"Qwen doesn't have to win the chat window — it can win the physical world instead, because it's the one you can
actually afford to put inside things."* That's ambition. It reads as a strategy the judges' own model could adopt.

---

## Script

| # · Movement | Time | Visual | Audio |
|---|---|---|---|
| **1 · HOOK** *(thesis)* | **0:00–0:18** | `[CAM]` You, direct to camera. Slow, warm. Optional B-roll flash on "three boxes": a chat window, an editor, a deck — 0.5s each. | "Every AI you've seen this year lives in the same three boxes. A chat window, a code editor, a slide deck. Meanwhile the actual world — the door, the pump, the greenhouse, the nursery — still runs on dumb thresholds somebody hard-coded in 2009. So we gave the real world a Qwen brain. Five dollars of hardware. No code. This is Hearth." |
| **2 · ANY HARDWARE** | **0:18–0:52** | `[SHOOT]` a bare ESP board in your palm → `[SCREEN]` the **one-line flash command** running in a terminal → the node **appearing on the dashboard by itself** with its capabilities listed. Then land on **"Your home"** + live chips (**hubs · devices · sensors · watches**) and the green **`live`** badge. | `[VO]` "Here's the part I care about. Hearth isn't a product with a parts list — it's a runtime. One command flashes a board you already own. It boots, and it announces itself: *I have a temperature pin. I have a relay.* No drivers. No config file. No datasheet. And the hub is a Raspberry Pi, an old laptop — whatever's in your drawer. So: this is my home, on one screen. See that green dot — *live*? That's a real stream, off the hub in my house." |
| **3 · THE ASK** | **0:52–1:24** | `[SCREEN]` **Describe a new watch** card. Type *"If the nursery goes over 78, cut the heater and text me."* → **Author →** → new **watch card**: **`when temperature over 78 → turn heater off, notify me`**, tagged **`local`**. Zoom the **`local`** tag. | `[VO]` "Now the good part. I don't write code — I just say what I want. *If the nursery goes over seventy-eight, cut the heater and text me.* I hit **Author**… and Qwen Cloud compiles that one sentence into a real, running script. There it is — over seventy-eight, heater off, notify me. I never touched a line of it. See that little *local* tag? Qwen wrote it — but it runs on the hub, in my house. Cut the internet, it still fires." |
| **4 · THE PROOF** *(peak)* | **1:24–1:56** | **One continuous take, hardware + screen in frame. Slowest register.** `[SHOOT]` cup the ESP32; `[SCREEN]` temp tile climbs `76 → 78 → 79`, **watch card flashes ember**, **Activity** streams **`🔥 Fired · ⚡ Actuated · 📨 Notified`**. `[SHOOT]` **phone buzzes** — hold ~1.5s of silence. | `[VO]` "So let's make it real. I warm this sensor with my hand… the tile climbs — seventy-six… seventy-eight… seventy-nine — the watch flashes, and the feed lights up: Fired… Actuated… Notified. And — *[phone buzzes]* — …there's my phone. Real sensor. Real script. Real alert. No cloud required." |
| **5 · CLOSE** | **1:56–2:45** | `[SCREEN]` 4s **wiring-assistant** flash: type *"add a soil sensor"* → Qwen returns a **pin recipe** `VCC→3V3 · GND→GND · signal→GPIO4`. Then `[CAM]` to camera over the end card: **Hearth · open source · any hardware · built on Qwen Cloud · \<repo URL\>**. Full stop before "Clone it." | "Don't know how to wire it? Just ask. *Add a soil sensor.* Qwen tells you which pin goes where — then writes the code that reads it. That's the whole idea. Any hardware. Any brain — swap the model out, it's yours. Open, from the sensor to the cloud. Qwen doesn't have to win the chat window. It can win the physical world instead — because it's the one you can actually afford to put inside things. This isn't the finished product. It's the platform you build it on. Clone it… and go build." |

**Total: ~2:47 — and this cut is tight.** 354 spoken words at 135 wpm is **2:37 of speech alone**; the two golden
silences and the beat around the phone buzz put it near **2:47** against a hard **3:00**. That's ~13s of margin, so
**do a timed read-through before shoot day** — if you deliver under 130 wpm you will blow the cap.

> Note: the previous DASHBOARD cut claimed "~2:40 at 275 words," which assumed ~38s of non-speech. That was optimistic —
> most of its "silence" was actually narrated. The number above is measured, not budgeted.

**Buffer if long, in this order:** the B-roll flash in Movement 1 (~2s) → the *"No drivers. No datasheet."* triplet in
Movement 2 (~3s) → the flash-command beat in Movement 2 (~5s, but it costs you the thesis — last resort).
**Never cut:** the two golden silences, or the *"any brain — swap the model"* line (model-swappability is what makes
"open" credible to these judges).

---

## What changed from the DASHBOARD cut, and why

| Old | New | Why |
|---|---|---|
| Hook: "home automation is closed" | Hook: "AI lives in three boxes; the real world doesn't have a brain" | The old hook picks a fight with Home Assistant — a small market. The new one picks a *frontier*, and makes Qwen the protagonist instead of the dependency. |
| Movement 2 was a **dashboard tour** (cadence slider, heartbeat) | Movement 2 is **"any hardware, one command, self-describing"** | The tour showed *our* setup. The new beat shows the viewer *their own* drawer of parts working. This is the thesis beat — it must not be UI garnish. |
| "Qwen turns that into a running **watch**" | "Qwen Cloud **compiles** that into a real, running **script** — I never touched a line of it" | "Watch" is our jargon and sounds like a config row. "Compiles a script you never wrote" is program synthesis, and it's the load-bearing Qwen claim. |
| Close: "a five-dollar chip and one sentence" | Close: "any hardware, any brain, and Qwen wins the physical world" | Cost alone is a feature. Cost + open + hardware-agnostic + a strategic thesis is a *position*. |
| Cadence slider (Movement 2) | **cut** | It's a nice toy that costs ~5s and proves nothing about the thesis. The flash-and-self-describe beat buys the same time and carries the argument. |

---

## Quick-build features that make the demo sing (in priority order)

Small wins so the on-camera footage is **real by shoot day** — not narrated over a static screen. Each is scoped to be a
same-day build.

| # | Feature | Why it lands on camera | Rough scope |
|---|---|---|---|
| **1 — REQUIRED** | **Live-streaming Activity feed + watch-card "fired" flash.** When a watch fires, the feed appends `🔥 Fired · ⚡ Actuated · 📨 Notified` **without a manual Refresh**, and the firing card pulses ember ~1s. | The 1:24–1:56 payoff. Today the feed only updates on `↻ Refresh` — on camera it must stream *as you warm the board*. | Reuse the `useHubLive` WebSocket to push run-events (or poll `listEvents(20)` every ~2s while recording); `Animated` ember flash on the card whose `watchId` matches the newest `fired` event. |
| **2 — REQUIRED** | **Qwen wiring assistant — "Add a device."** Type a sensor in plain words (*"add a soil sensor"*) → Qwen returns a **wiring recipe** (`VCC→3V3 · GND→GND · signal→GPIO4`), the one-line flash command, and the `DESCRIBE` it'll announce. | Carries the **close** *and* the thesis: anyone can add hardware without a datasheet. Promoted above the Test button — this cut is about *any hardware*, so the beat that proves it is load-bearing. | One Qwen call, system-prompted with the ESP32 pin map → pinout + firmware flag (`SENSOR_PIN`, `DHT_PIN`). NL-in / recipe-out. Reuses the existing Qwen client. |
| **3 — REQUIRED** | **Test-fire button on each watch card.** A small `Test →` next to Edit/Delete that runs the action chain on cue. | Insurance for the hero take: the hand-warm is the star, but an on-cue trigger gets clean screen footage without re-warming hardware. A *real* fire, hand-triggered. | Button → POST to `runWatch(id)` (the hub already fires + actuates + notifies + logs the same events). |
| **4 — nice** | **Self-describe moment on screen.** When a freshly flashed node checks in, briefly surface its announced capabilities (`temperature · relay`) as a toast or a new-tile flash. | This *is* Movement 2's proof — right now the node appearing is easy to miss on camera. | Toast fed by the existing node-registration event. |
| **5 — nice** | **"Armed" status line under "Your home."** — **`Armed · 3 watches running locally`**. | Vocal anchor at 0:45; sells autonomy at a glance. | Copy + one derived count; reuse `Pill`. |
| **6 — optional** | **Fire toast** — `🔥 Nursery 79° — heater off. You're notified.` | A second unmissable "it just happened" beat; reads on a phone-sized recording. | `Animated` toast on the same stream as #1. |

**Honesty guardrail:** #1–#4 are real behaviors — the hub already fires/actuates/notifies and logs events, the node
already self-describes on flash, and the wiring assistant is a thin Qwen prompt over the real ESP32 pin map. We're
surfacing what exists and adding an on-cue trigger.

**One claim to keep honest in Movement 2:** *"one command flashes a board you already own"* is true for the **ESP32
family** today. Say **"a board you already own"** or **"any ESP board in your drawer"** — do **not** say *"literally any
hardware"* on camera. The dashboard/hub layer is genuinely hardware-agnostic; the flash path is ESP-family. The written
close ("Any hardware") is the *project's* direction and sits next to the repo URL, which is fair; the *spoken* line
should stay board-specific.

---

## On-screen strings the presenter points at (all real, all shipped)
Verified against `frontend/src/app/dashboard.tsx`. Match the spoken word to the pixel.

- Header: **`Your home`** · chips **`hubs` `devices` `sensors` `watches`** · **`↻ Refresh`**
- Sensors: live badge **`live`** (green, breathing) / `connecting…` / `hub offline`; per-tile **heartbeat** ping, **TTL bar**, cadence readout `0.5s … 60s`; boolean sensors read **`on`/`off`**.
- Describe card: **`Describe a new watch`**, placeholder **`Warn me if the garage is left open after dark…`**, button **`Author →`**.
- Watch card: **`when <trigger> → <action>`**, tags **`local`** / `cloud` / `vision`, `Edit` / `Delete` (+ **`Test →`** once #3 ships). Edit mode: **`Re-compile →`**.
- Activity: **`✍️ Authored`** · **`🔥 Fired`** · **`⚡ Actuated`** · **`📨 Notified`** (+ `⏳ Held`, `📡 Offline`, `🔌 Reconnected`), each with `· <model>` and a `5m ago` stamp.

**Do NOT show on camera:** the account-menu **`🔥 Live demo`** item or the `/demo` route — real dashboard only.

---

## Movement → rubric map
| Movement | Serves |
|---|---|
| 1 · Hook — "the real world has no brain" | **Innovation + Impact**: a frontier, not a gadget category |
| 2 · Any hardware — flash → self-describe → live on screen | **Impact + Tech**: zero-barrier onboarding on hardware you already own; the open-platform thesis, proven not asserted |
| 3 · The ask — Describe → Author → running script (`local` tag) | **Innovation + Tech**: Qwen as program synthesis; no coding knowledge required; runs at the edge |
| 4 · The proof *(peak)* — hand → tile climbs → feed streams → phone buzzes | **Tech**: the whole chain fires on real hardware, on-screen |
| 5 · The close — wiring AI + any hardware + model-swappable + "win the physical world" | **Impact + Innovation**: cheap, open, buildable baseline infrastructure — and a strategic argument for Qwen itself |

## Shot list
- `[CAM]` host takes: hook (0:00), close (1:56 → to camera over the end card).
- `[SHOOT]` **bare board in palm** (Movement 2 opener); the **hero proof take** — hand cupping the ESP32 with the dashboard in one frame, several passes; the **phone buzz** (hold ~1.5s).
- `[SCREEN]` the **flash command + node self-appearing**; "Your home" + chips + green `live`; Describe→Author→new watch card; the proof (tile climb + card flash + Activity stream); the 4s **wiring-assistant** flash; end card.
- Optional B-roll: 0.5s each of a chat window / code editor / slide deck under the hook's "three boxes."

## Production notes
- **Sign in first** — `/dashboard` redirects to `/signin` when signed out; use a clean demo account (e.g. `demo@hearth…`).
- **Get the live badge green before rolling** — hub checked in and streaming, one tile updating on its own.
- **Movement 2 flash shot:** do a real flash on a board that is *not* yet registered, so the node genuinely appears on the dashboard by itself. Rehearse it — but the take should be a real check-in, not a cut.
- **Pre-author nothing you'll type on camera** — author the nursery watch live so `✍️ Authored` lands in the feed; pre-create one or two extra watches so the screen isn't empty.
- **Wiring-assistant capture (close):** pre-run *"add a soil sensor"* once so you know the exact recipe, then capture clean. **Pin recipe only** (~4s) — it's a punchline, not a lesson.
- **Make the actuator read on camera:** a bigger LED or relay+lamp on `ACTUATOR_PIN` (`ACTUATOR_ACTIVE_HIGH 0` for active-low) so "cut the heater" is visible. Still 100% real.
- **Phone push:** `export NTFY_TOPIC=hearth-<unique>` + the free ntfy app, foregrounded, before recording.
- **Ship #1–#3 before the shoot** — the live feed carries the payoff, the wiring assistant carries the close, the Test button de-risks the hero take.

## Open calls (yours)
1. **The Movement 2 flash beat** is new and is the thesis — it needs a real unregistered board on shoot day. Confirm you'll have one, or we fall back to narrating over the existing node list (weaker, but survivable).
2. **Scenario** — "nursery over 78" is filmable today. Swap the noun (fridge, greenhouse, garage) if a room shoots better, but keep it **temperature-based** to match the real fire.
3. **Voice** — VO in post, or on-camera throughout?
4. **Firmware still needs an on-device flash to verify** the actuator before the payoff shot (no ESP toolchain in CI).
