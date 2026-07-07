# 06 — Demo Video Script (≤ 3:00) — DASHBOARD cut

Submission video for **Track 5: EdgeAgent**. Target runtime **~2:40** (hard cap 3:00). Format: 1080p+, YouTube/Vimeo/Youku.
This cut is a **product demo**, told through **one screen**: the Hearth dashboard, in a **PROOF-LAST** structure — five
movements, one peak. We run a single lived scenario, build to the hardware fire as the *final* spectacle, then collapse
**cheap + the Qwen wiring AI + open** into the close as the punchline (never explain after the peak). The dashboard IS
the story; the hardware is the payoff; the "platform you build on" is the last word.

> **Two hero examples now that the vision stack is real (PRs #39/#45/#46, deployed):** the **temperature/actuation** cut
> below (local, offline, real hardware fire), and the **🆕 Vision flagship — "Who's at my door?"** (Qwen-VL tells family
> from strangers off real reference photos on OSS — see the spelled-out beat sheet under the Script table). Shoot **one
> concrete example end-to-end**; the vision flagship is the strongest single story for the two 30% buckets. Pick per what
> films cleanest, or run temp as the spine and the vision flagship as a 60–75s second act.

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

## 🆕 Vision flagship — "Who's at my door?" (the one concrete example, spelled out)

The temperature cut above proves the **local/actuation** half. This is the **cloud-reasoning** half — the Qwen-VL beat the
whole EdgeAgent thesis rests on — and it is now **real and deployed** (PRs #39/#45/#46): a persistent, named, **tagged
reference memory** on **Alibaba OSS**, **Qwen-VL** reading a real doorway frame and telling **family from strangers with no
face-recognition model**, and the raw video **never leaving the house**. Shoot this as the vision half of the film, or as
its own 60–75s short. One scenario, spelled out beat-by-beat so it can be captured clean.

**The one sentence:** *"Tell me if someone who isn't family is at the front door."*

**Pre-shoot setup (all real):**
- **Reference memory** — in **`/memory`**, upload 2–3 photos of household members; **name** each (Alex, Sam) and **tag** them
  **`family`**. They persist to OSS (`hearth-vision-c11d45`); the grid shows their faces + tag chips. This is the "face cloud."
- **Doorway camera** — OBS streams the door to the hub (`HEARTH_CAM=1 node hub/hub.mjs` on `192.168.1.27`, OBS → Custom →
  `rtmp://127.0.0.1:1935/live`); the dashboard **Camera tile** shows a frame snapped on a cadence. (A phone/webcam works too.)
- Sign in on a clean demo account; pre-author nothing you'll type on camera.

| # · Beat | Time | Visual | Audio |
|---|---|---|---|
| **V1 · The memory** | 0:00–0:12 | `[SCREEN]` Open **`/memory`** — a grid of family faces, each tagged **`family`**. Slow pan. | `[VO]` "First I tell my house who belongs — a few photos of my family, named and tagged *family*. That's it. No training, no model." |
| **V2 · The ask** | 0:12–0:34 | `[SCREEN]` Dashboard **Describe** card → type *"Tell me if someone who isn't family is at the front door."* → **Author →**. New watch card, tags **`cloud`** **`vision`**. | `[VO]` "Then I just say it. Qwen compiles it into a watch — and tags it **vision**, because this one has to actually *look*." |
| **V3 · Qwen asks for context** | 0:34–0:50 | `[SCREEN]` The **✨ "To make this work well, Qwen suggests"** card: **🖼️ Upload photos of household members · 🎯 aim at the doorway · 💡 good lighting**. | `[VO]` "And here's the part I love — Qwen tells *me* what it needs: reference photos, where to aim, good light. The agent knows how to do its own job." |
| **V4 · Family → CLEAR** | 0:50–1:10 | `[SHOOT]`+`[SCREEN]` A **household member** steps into the door camera; **Camera tile** shows the live frame. Activity: verdict **`CLEAR`** + reasoning + a **privacy** line. No push. | `[VO]` "My partner walks up. Qwen-VL looks, compares against my family photos… *that's Alex — a household member.* No alert. And notice — only a cropped frame ever left the house." |
| **V5 · Stranger → FIRED** *(peak)* | 1:10–1:34 | `[SHOOT]`+`[SCREEN]` A **stranger** at the door. Camera tile updates; watch card **flashes ember**; Activity streams **`🔥 Fired · 📨 Notified`** + the reasoning; **phone buzzes** — hold ~1.5s. | `[VO]` "Now a stranger. *[beat]* Qwen-VL: *someone at the door who isn't in your household.* The watch fires… *[buzz]* …there's my phone. Real camera, real reasoning — family knows family, and a script never could." |
| **V6 · Close** | 1:34–1:55 | `[CAM]` to camera over the end card. Full stop before the last line. | "No face-recognition model. No cloud lock-in. A few photos, one sentence, and Qwen-VL reasons about who's *really* at my door — raw video staying home. Open, camera to cloud. Clone it… and go build." |

**Why it scores:** sophisticated **Qwen-VL** + multi-image reference reasoning + **MCP tools** + **OSS** = both 30% buckets;
raw-stays-home + on-demand frames + graceful degradation = the EdgeAgent brief verbatim (**Impact + Presentation**).

**Honesty guardrail — read before shooting V4/V5.** The Qwen-VL judge, the reference memory, and OSS are all real and
**verified** (`backend/ npm run household-check`, `npm run oss-check` — Qwen-VL reads the OSS presigned URL and distinguishes
same-subject from a stranger). The one piece **not yet auto-wired** is the hub *automatically* invoking the judge the instant
a person appears (that's **B1**, the runtime wiring on the TODO). To capture V4/V5 as a clean live beat today, either **(a)**
land B1 first, or **(b)** trigger the judge **on cue** against the live OBS frame + the family references — a *real* Qwen-VL
call, just hand-triggered for a clean take (same idea as the "Test fire" button in the temperature cut). Nothing narrated
claims a capability the stack doesn't have.

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

**Vision-flagship strings (real, shipped in PRs #39/#45/#46):**
- Dashboard header: **`◆ Memory`** button (next to `↻ Refresh`); the camera lives in a **`Camera`** section — tile titled **`Doorway camera`**, tags **`vision`** + **`OBS`**/`test source`, a **`snapped HH:MM:SS · every 5s`** stamp, and **`Snap rate`** + **`Quality`** sliders. Placeholder before a stream: **`Waiting for a frame — start OBS streaming to the hub`**.
- Context-suggestion card (after authoring a vision watch): **`✨ To make "<title>" work well, Qwen suggests`** with rows **🖼️ Upload photos of household members · 🎯 Point the camera at the doorway · ⏱️ Snap every ~2s · ✨ higher quality · 💡 lighting**, and a **`＋ Add reference photos →`** button that opens `/memory`.
- **`/memory`** ("Reference memory"): H1 **`Who and what your home knows`**; **`＋ Choose a photo`** drop-zone, a **name** field, tag chips **`family` `pet` `vehicle` `package` `allowed` `watch`** (+ custom), **`Add to memory →`**; the grid shows each object's thumbnail + name + tag chips + **`Remove`**.
- Vision watch card: tags **`cloud`** **`vision`**; Activity verdict lines carry the Qwen-VL **reasoning** ("that's Alex — a household member") and a **privacy** note ("only a cropped frame left the home").

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
| 🆕 Vision flagship — memory → author → context → CLEAR/FIRED | **Innovation + Tech (both 30%)**: sophisticated Qwen-VL, multi-image reference memory, MCP tools, OSS; **Impact + Presentation**: privacy-aware, raw video stays home, family-from-strangers with no face model |

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
