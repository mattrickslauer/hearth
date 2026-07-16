# 06 — Demo Video Script (≤ 3:00) — "THE WORLD HAS NO JUDGMENT" cut

Submission video for **Track 5: EdgeAgent**. Counted runtime **~2:50** (hard cap 3:00 — see the timing note under the
script table; the margin is ~10s and the counts are checked, not budgeted). Format: 1080p+, YouTube/Vimeo/Youku.

**The thesis (what actually sells this):** every AI you've seen this year lives in the same three boxes — a chat window,
a code editor, a slide deck. Meanwhile the physical world runs on **thresholds**: two numbers, compared. A thermostat
doesn't think. A door sensor doesn't know *who* opened the door. The real world is full of questions a number cannot
answer — *is that my kid or a stranger?* — and until now nothing cheap enough to sit in your hallway could answer them.
**Qwen can.** Hearth is the open-source runtime that puts a **Qwen brain** in hardware you already own.

**Read this before touching the script — it's why this cut exists.** The previous cut demoed
`when temperature over 78 → heater off`, one movement after mocking a world that "runs on dumb thresholds somebody
hard-coded in 2009." That *is* a hard-coded threshold. Qwen just typed it. The whole model contribution was a one-time
translation the judges' own model could have done in 2023 — and then the cut bragged about not needing it
(*"cut the internet, it still fires" · "No cloud required"*), which reads to a Qwen judge as **"we use your model once,
then we're done with you."**

**So the spine is a nervous system, and the ordering is deliberate.** Qwen Cloud is the **brain** — it *looks* at a real
frame and makes a judgment no threshold can make. The hub is the **reflex arc** — fast, dumb, and the reason a lost link
is survivable. Edge is not the flex; it's the **spine that protects the brain**. That framing serves the sponsor *and*
Track 5 at once, and it's the only honest reading of what the code does: a vision watch calls **Qwen-VL on every frame**
(`backend/src/vision-watch.ts`), gated by a cheap local predicate so the cloud call is the exception, not the tax.

**What is on screen is real.** Camera → OSS → Qwen-VL → verdict → actuate → push is a live path, and the feed stamps
**`· qwen`** on the row because `evaluatedBy` is now actually assigned. See **Honesty guardrails** — one leg is unproven
until a key exists, and this document does not pretend otherwise.

**Structure:** five movements, one peak, **PROOF-LAST**. Never explain after the peak.

**Legend:** `[CAM]` you to camera · `[SCREEN]` dashboard capture · `[SHOOT]` real hardware in frame · `[VO]` voiceover.

**The through-line:** one continuous scenario — *"tell me if someone who isn't family is at the door."* You say it, Qwen
compiles it, you show it a photo of Alex, and then **a stranger walks up** and Qwen-VL *looks* and *decides*. The
reflex beat lands last and small, as reassurance, not as a boast.

**Cadence:** three registers — `[CAM]` slow + warm · `[SCREEN]` brisk, pointing · `[PROOF]` slowest, let it breathe.
Rule of three is the metronome ("chat, code, slides" · "Looked, Decided, Told me"). Two golden silences: ~1.5s after
*"…that's not Alex"*, and a full stop before *"Clone it."* Deliver ~135 wpm so the pauses land.

**Tone guardrail — the underdog frame is a *frame*, not a *line*.** Never say "underdog," "smaller," "lesser-known," and
never name a competitor. Judges hear grievance and discount it. The positioning lands entirely through the *close*.

---

## Script

| # · Movement | Time | Visual | Audio |
|---|---|---|---|
| **1 · HOOK** *(thesis)* | **0:00–0:30** | `[CAM]` You, direct to camera. Slow, warm. Optional B-roll flash on "three boxes": a chat window, an editor, a deck — 0.5s each. Then a hard cut to a doorway. | "Every AI this year lives in the same three boxes. A chat window, a code editor, a slide deck. Meanwhile your thermostat compares two numbers, like it's 2009. That's not thinking. The real world is full of questions a number can't answer — *is that my kid, or a stranger?* So we gave the hallway a Qwen brain. Whatever hardware you've got. No code. This is Hearth." |
| **2 · ANY HARDWARE** | **0:30–0:59** | `[SHOOT]` a bare ESP board in your palm → `[SCREEN]` the **one-line flash command** in a terminal → the node **appearing on the dashboard by itself**, capabilities listed. Land on **"Your home"** + live chips (**hubs · devices · sensors · watches**) + green **`live`** badge. | `[VO]` "Hearth isn't a product with a parts list — it's a runtime. One command flashes a board you already own. It boots, and announces itself: *I have a camera. I have a relay.* No drivers. No datasheet. The hub? A Raspberry Pi, an old laptop — whatever's in your drawer. That green dot? A real stream, off the hub in my house." |
| **3 · THE ASK** | **0:59–1:31** | `[SCREEN]` **Describe a new watch**: type *"Tell me if someone who isn't family is at the door."* → **Author →** → watch card tagged **`vision`**. Then `[SCREEN]` **link a memory object**: Alex's photo → attached to the watch. Zoom the **`vision`** tag. | `[VO]` "I don't write code — I just say what I want. *Tell me if someone who isn't family is at the door.* Qwen compiles that into a running watch. Notice what I never gave it: a number — no threshold answers *who*. So I show it my family. That's Alex; Qwen keeps him as memory it reasons over. See the *vision* tag? That watch doesn't check a value. It **looks**." |
| **4 · THE PROOF** *(peak)* | **1:31–2:11** | **One continuous take. Slowest register.** `[SHOOT]` someone walks to the door. `[SCREEN]` the camera tile refreshes on its cadence → the watch card flashes ember → **Activity** streams **`🔥 Fired`** with **`· qwen`** and the real reasoning line. `[SHOOT]` **phone buzzes** — hold ~1.5s. Then `[SHOOT]` **pull the hub's network cable**; the local heat watch still fires. | `[VO]` "So — someone's at the door. Qwen-VL is looking at that frame right now. It compares them against Alex… and — *[phone buzzes]* — …*that's not Alex.* Read that line: that's not a threshold tripping. That's a **judgment**, on a real frame, from the cloud, in my hallway. And when I pull the plug — *[cable out]* — the reflexes Qwen compiled keep running on the hub. The brain is the cloud. The body still has a spine." |
| **5 · CLOSE** | **2:11–2:50** | `[SCREEN]` 4s **wiring-assistant** flash: type *"add a soil sensor"* → Qwen returns a **pin recipe** `VCC→3V3 · GND→GND · signal→GPIO4`. Then `[CAM]` to camera over the end card: **Hearth · open source · any hardware · built on Qwen Cloud · \<repo URL\>**. Full stop before "Clone it." | "Don't know how to wire it? Just ask. *Add a soil sensor.* Qwen tells you which pin goes where — then writes the code that reads it. Any hardware. Any brain — swap the model out, it's yours. Open, from the sensor to the cloud. Qwen doesn't have to win the chat window. It can win the physical world instead — the one you can actually afford to put inside things. Clone it… and go build." |

**Total: ~2:50 against a hard 3:00.** Counted, not budgeted: **349 spoken words** at 135 wpm is **2:35 of speech alone**
(per movement: 67 · 62 · 70 · 74 · 76). The golden silences, the phone buzz and the cable-pull add ~15s, landing at
**~2:50** — about **10s of margin**. The movement ranges above are derived from those counts, so they're internally
consistent rather than aspirational.

**This is the number to distrust.** Every prior cut of this doc under-claimed its own runtime — the DASHBOARD cut said
"~2:40 at 275 words" by assuming ~38s of silence that was actually narrated, and the first draft of *this* cut claimed
"358 words / 2:39" when it was really 407 words and **3:01 of speech alone — over the cap before a single pause**. Recount
after any rewrite; don't trust the header. **Do a timed read-through before shoot day** — at 130 wpm this is 2:56 and you
are betting the submission on ten seconds.

**Buffer if long, in this order:** the B-roll flash in Movement 1 (~2s) → *"No drivers. No datasheet."* in Movement 2
(~3s) → the cable-pull in Movement 4 (~5s — it costs the reflex beat, but the *judgment* is the thesis and survives
without it).
**Never cut:** the *"that's not Alex"* silence, the **`· qwen`** callout (it's the proof the model is in the loop), or
*"any brain — swap the model"*.

---

## What changed from the "QWEN BRAIN" cut, and why

| Old | New | Why |
|---|---|---|
| Hero watch: `when temperature over 78 → heater off` | Hero watch: *"someone who isn't family at the door"* | The old hero **was the thing the hook mocks** — a hard-coded threshold. Qwen's only job was typing it. The new hero is a question no number can answer, so the model is load-bearing instead of decorative. |
| "It runs on the hub, in my house. **Cut the internet, it still fires.**" | "The brain is the cloud. The body still has a spine." | Same fact, opposite argument. The old line sold Qwen as **optional**; a sponsor judge hears "we don't need you." Edge is now the **safety net**, which is what Track 5 actually rewards. |
| "**No cloud required**" (Movement 4) | **cut entirely** | It was the loudest anti-sponsor line in the cut, at the peak, in the sponsor's own track. |
| Qwen appears once, at authoring | Qwen appears **at authoring and on every frame** | This was a lie the code told: cloud/vision watches were filtered out and never evaluated. Fixed in `backend/src/vision-watch.ts` — now it's true, so we can say it. |
| Memory objects: unused | Alex's photo **linked to the watch**, reasoned over | `memoryIds` was stored and never read. Now it narrows the reference set Qwen-VL compares against — a beat that shows *teaching* the model, not configuring it. |
| Proof = a tile climbing `76 → 78 → 79` | Proof = **a verdict with reasoning**, stamped `· qwen` | A climbing number proves a sensor works. A reasoning line proves a **brain** works. |

---

## Honesty guardrails — read before you claim anything on camera

The vision loop is **real code on a real path** (`hub/camera.mjs` → OSS → `backend/src/vision-watch.ts` → `qwen-vl-plus`),
and `npm run vision-watch-check` proves the gate and the cadence floor with no key. But:

1. **The live Qwen-VL leg is UNVERIFIED until a key exists.** `vision-watch-check` reports legs A and D as **SKIPPED**
   without `QWEN_API_KEY` + `OSS_BUCKET` — deliberately, rather than passing on a mock. **Run it green before shoot day.**
   Without a key, `judge()` silently falls back to `mockJudge` and the feed will stamp **`· local`**, not **`· qwen`** —
   which is exactly the beat this cut is built on. *This is the single biggest risk to the shoot.*
2. **"One command flashes a board you already own"** is true for the **ESP32 family**. Say *"a board you already own"* —
   never *"literally any hardware"* on camera. The dashboard/hub layer is genuinely hardware-agnostic; the flash path is not.
3. **Don't say Qwen-VL runs on the hub.** It doesn't, by design — the hub has no Qwen client. The cut says the opposite
   on purpose ("the brain is the cloud"), so this is aligned, but don't improvise around it.
4. **The `vision` tag is a label the authoring model gives itself**, not a fact about execution. What actually routes a
   watch to Qwen-VL is `compiledSpec.kind === 'cloud'`. If the tag and the behaviour disagree on camera, believe the feed.
5. **Do NOT show** the account-menu **`🔥 Live demo`** item or the `/demo` route — its "vision" is `qwen-plus` reading a
   hardcoded English sentence (`use-simulation.ts`), and its Qwen-VL badge is cosmetic. Real dashboard only.

---

## Quick-build features that make the demo sing (in priority order)

| # | Feature | Why it lands on camera | Rough scope |
|---|---|---|---|
| **1 — REQUIRED** | **Live-streaming Activity feed + watch-card "fired" flash.** The feed appends `🔥 Fired · qwen` **without a manual Refresh**, and the firing card pulses ember ~1s. | The 1:22–2:04 payoff. The relay currently only carries `readings` (`frontend/src/lib/live.ts:133`), so a fire needs a Refresh — fatal for the peak. | Add an `events` message to the relay + a `pushEventsToAccount` on the fire path in `/hub/frame`; handle it in `useHubLive`. |
| **2 — REQUIRED** | **Green `vision-watch-check` with a real key.** | Guardrail #1. Everything else is theatre if the model isn't really in the loop. | Provision `QWEN_API_KEY` + OSS, run it. No new code. |
| **3 — REQUIRED** | **Qwen wiring assistant — "Add a device."** *"add a soil sensor"* → wiring recipe + flash command. | Carries the close. **Not built** — `build-a-node.tsx` is static content with no model call. | One Qwen call system-prompted with the ESP32 pin map. NL-in / recipe-out. |
| **4 — REQUIRED** | **Test-fire on each watch card.** A small `Test →` that runs the chain on cue. | Insurance for the hero take — a real fire, hand-triggered, without waiting for a visitor. | Button → `runWatch(id)`; for a vision watch, re-judge the latest frame. |
| **5 — nice** | **Show the reasoning line in the feed, not just the verdict.** | *"that's not Alex"* on screen **is** the peak. If the row only says `Fired`, the judgment is invisible. | The row already carries `reasoning`; surface it on the card. |
| **6 — nice** | **Self-describe toast** when a freshly flashed node checks in (`camera · relay`). | Movement 2's proof — easy to miss on camera. | Toast on the existing node-registration event. |

---

## On-screen strings the presenter points at
Verified against `frontend/src/app/dashboard.tsx`. Match the spoken word to the pixel.

- Header: **`Your home`** · chips **`hubs` `devices` `sensors` `watches`** · **`↻ Refresh`**
- Sensors: live badge **`live`** / `connecting…` / `hub offline`; per-tile **heartbeat**, **TTL bar**, cadence readout `0.5s … 60s`.
- Camera card: snapshot preview + **snap-rate** slider — *this is literally how often Qwen gets to look.* Worth one pointed beat.
- Describe card: **`Describe a new watch`**, button **`Author →`**.
- Watch card: **`when <trigger> → <action>`**, tags **`local`** / `cloud` / `vision`, `Edit` / `Delete`.
- Activity: **`✍️ Authored`** · **`🔥 Fired`** · **`⚡ Actuated`** · **`📨 Notified`** (+ `⏳ Held`), each with `· <model>` and a `5m ago` stamp.

## Movement → rubric map
| Movement | Serves |
|---|---|
| 1 · Hook — "the world has no judgment" | **Innovation + Impact**: a frontier, not a gadget category |
| 2 · Any hardware — flash → self-describe → live | **Impact + Tech**: zero-barrier onboarding on hardware you already own |
| 3 · The ask — a question no number can answer, + memory | **Innovation + Tech**: Qwen as program synthesis *and* as the thing that runs |
| 4 · The proof *(peak)* — Qwen-VL looks → judges → acts → the spine holds | **Tech**: the model is in the runtime loop, on real hardware, on camera |
| 5 · The close — wiring AI + model-swappable + "win the physical world" | **Impact + Innovation**: cheap, open, buildable infrastructure — and a strategy for Qwen itself |

## Shot list
- `[CAM]` host takes: hook (0:00), close (2:04 → to camera over the end card).
- `[SHOOT]` bare board in palm; **the hero take** — someone at the door with the dashboard in one frame, several passes; the **phone buzz** (hold ~1.5s); the **cable pull**.
- `[SCREEN]` flash command + node self-appearing; "Your home" + green `live`; Describe→Author→`vision` card; linking Alex's photo; the proof (camera tile → card flash → `🔥 Fired · qwen` + reasoning); the 4s wiring-assistant flash; end card.

## Production notes
- **Sign in first** — `/dashboard` redirects to `/signin` when signed out; use a clean demo account.
- **Green `vision-watch-check` first.** See guardrail #1. Everything below assumes the feed can stamp `· qwen`.
- **Get the live badge green before rolling** — hub checked in and streaming.
- **Camera:** OBS→RTMP or a real webcam via `hub/camera.mjs`. Set the snap cadence fast enough that the judgment lands within the take (a slow cadence = dead air at the peak).
- **Upload Alex's photo before the shoot**, but **link it to the watch on camera** — the linking beat is the "teach it who your family is" moment.
- **The stranger** should be visually unmistakable from the reference photo. Don't make Qwen-VL's job subtle on the one take that matters.
- **Phone push:** `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` is the only channel that needs no Alibaba setup (`backend/src/notify.ts`); foreground the app before recording.
- **Make the actuator read on camera** — a lamp or relay on `ACTUATOR_PIN` so "it did something" is visible.

## Open calls (yours)
1. **The key.** Guardrail #1 is the whole cut. If `QWEN_API_KEY` + OSS won't land before shoot day, say so now — the fallback is a much weaker cut, and I'd rather rewrite early than film a `· local` stamp.
2. **The Movement 2 flash beat** needs a real unregistered board on shoot day. Confirm, or we narrate over the existing node list (weaker, but survivable).
3. **Scenario** — "someone who isn't family at the door" is the strongest *argument*. Swap the noun (a delivery, a pet on the couch, a car in the drive) if it shoots better, but keep it **a question a number can't answer**.
4. **Voice** — VO in post, or on-camera throughout?
