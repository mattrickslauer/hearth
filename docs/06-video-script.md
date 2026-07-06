# 06 — Demo Video Script (≤ 3:00) — DASHBOARD cut

Submission video for **Track 5: EdgeAgent**. Target runtime **2:45**. Format: 1080p+, YouTube/Vimeo/Youku.
This cut is a **product demo**, told through **one screen**: the Hearth dashboard. We run a single lived scenario end to
end — describe a rule in plain words, watch Qwen compile it, then make it **fire on real hardware** — without ever
leaving "Your home." The dashboard IS the story; the hardware is the payoff inside it.

**Legend:** `[CAM]` you to camera · `[SCREEN]` dashboard capture (the visual spine) · `[SHOOT]` real hardware in frame ·
`[VO]` voiceover.

**The through-line:** one continuous scenario — *"keep the nursery under 78."* You describe it, Qwen compiles it into a
**watch**, you warm a real sensor with your hand, and the whole chain lights up **on the dashboard**: the sensor tile
climbs, the watch flashes, the activity feed streams **Fired · Actuated · Notified**, and your phone buzzes. Everything
the viewer sees is a real string on the real screen (`frontend/src/app/dashboard.tsx`).

---

## Script

| Time | Visual | Audio |
|---|---|---|
| **0:00–0:14** | `[CAM]` You, direct to camera. | "Home automation is closed. Closed hubs, closed clouds, closed apps — you buy a gadget, and then you rent your own house back from whoever sold it to you. So we opened the whole stack. This is Hearth — and this is my home, running on one screen." |
| **0:14–0:28** | `[SCREEN]` Cut to the dashboard. Hold on the **"Your home"** header and the four stat chips — **hubs · devices · sensors · watches** — each with a live number. | `[VO]` "One dashboard. *Your home.* Up top — my hubs, my devices, my sensors, my watches. Every number here is live… and every layer underneath is open source." |
| **0:28–0:50** | `[SCREEN]` Scroll to **Sensors**. Point at the green pulsing **"live"** badge. Tiles update on their own — the corner **heartbeat** pings, the **TTL bar** refills. Drag a **cadence slider** from `60s` → `0.5s`; that tile visibly speeds up. | `[VO]` "These are my live sensors. See that green dot — *live*? That's a real stream, straight off the hub in my house. Every tile has a heartbeat — watch it pulse the moment a reading lands. And I can dial any sensor right here — from once a minute… down to twice a second… live." |
| **0:50–1:22** | `[SCREEN]` **Describe a new watch** card. Type: *"If the nursery goes over 78, cut the heater and text me."* Click **Author →** → spinner → a new **watch card** appears reading **`when temperature over 78 → turn heater off, notify me`**, tagged **`local`**. Zoom the **`local`** tag. | `[VO]` "Now the good part. I don't write code — I just say what I want. *If the nursery goes over seventy-eight, cut the heater and text me.* I hit **Author**… and Qwen, on Alibaba Cloud, turns that one sentence into a running watch. There it is — when temperature is over seventy-eight, turn the heater off, notify me. And see that little *local* tag? That rule runs on the hub, in my house — cut the internet, it still fires." |
| **1:22–1:55** | **PAYOFF — one continuous take, hardware + screen in frame.** `[SHOOT]` cup the ESP32 in your hand; `[SCREEN]` the temp tile climbs `76 → 78 → 79`, the **watch card flashes ember**, and the **Activity** feed streams **`🔥 Fired · ⚡ Actuated · 📨 Notified`** in real time. `[SHOOT]` your **phone buzzes**. | `[VO]` "So let's make it real. I warm this sensor with my hand… the tile climbs — seventy-six, seventy-eight, seventy-nine — the watch flashes, and watch the activity feed light up: Fired… Actuated… Notified. And — *[phone buzzes]* — there's my phone. Real sensor, real rule, real alert. Top to bottom, no cloud required." |
| **1:55–2:18** | `[SCREEN]` Slow pan across the other **watch cards** and **sensor tiles**. Optional overlay: a tiny **MCP** tool-list callout keyed over the corner. | `[VO]` "And every sensor, every watch, is a standard MCP tool — so any agent, not just mine, can see my home and act on it. Plug in a new sensor and it introduces itself — what it can sense, what it can do — and it just shows up on this dashboard. No addresses, no setup." |
| **2:18–2:45** | `[CAM]` You to camera. `[SCREEN]` end card: **Hearth · open source · built on Qwen Cloud · \<repo URL\>** over a clean shot of the dashboard. | "So that's a whole home — run from one screen, built on Qwen — and every single layer is open source. Self-host it, run it offline, swap the model, build your own node. Clone it… and go run your house." |

**Total: ~2:45.** Buffer to trim: the Sensors beat (0:28–0:50) can lose ~4s; the MCP/breadth beat (1:55–2:18) ~4s.

---

## Quick-build features that make the demo sing (in priority order)

Small, mostly-frontend wins so the on-camera footage is **real by shoot day** — not narrated over a static screen. The
speech above already assumes #1 and #2; they're the load-bearing ones. Each is scoped to be a same-day build.

| # | Feature | Why it lands on camera | Rough scope |
|---|---|---|---|
| **1 — REQUIRED** | **Live-streaming Activity feed + watch-card "fired" flash.** When a watch fires, the Activity feed appends `🔥 Fired · ⚡ Actuated · 📨 Notified` **without a manual Refresh**, and the firing watch card pulses ember for ~1s. | This is the 1:22–1:55 payoff. Right now the feed only updates on `↻ Refresh` — on camera it must stream so "Fired… Actuated… Notified" appears *as you warm the board*. | Reuse the existing `useHubLive` WebSocket to also push run-events (or poll `listEvents(20)` every ~2s while recording); add an `Animated` ember flash to the card whose `watchId` matches the newest `fired` event. |
| **2 — REQUIRED** | **"Test fire" button on each watch card.** A small `Test →` next to Edit/Delete that triggers the watch's action chain on cue. | Insurance for the hero take: the hand-warm is the star, but a deterministic on-cue trigger means you get clean footage on the first pass and can re-shoot the screen half without re-warming hardware. It's a *real* fire, just hand-triggered. | New button → POST to a `runWatch(id)` endpoint the hub already has the plumbing for (it fires + actuates + notifies + logs the same events). |
| **3 — nice** | **"Armed" status line under "Your home."** A pill/line like **`Armed · 3 watches running locally`** under the H1. | Gives the presenter a crisp vocal anchor at 0:14 ("every number here is live") and sells *autonomy* at a glance. | Pure copy + one derived count (`watches.filter(runsLocally).length`); reuse the existing `Pill`. |
| **4 — nice** | **Fire toast.** A slide-in toast on a fresh `fired` event: **`🔥 Nursery 79° — heater off. You're notified.`** | A second, unmissable "it just happened" beat for the payoff — reads even on a phone-sized recording. | Small `Animated` toast fed by the same event stream as #1. |
| **5 — optional** | **Big value flash on threshold cross.** The temp tile's number briefly turns ember/red as it crosses the watch's threshold. | Makes the `76 → 78 → 79` climb pop and visually ties the *sensor* to the *rule*. | Compare the incoming reading to the active watch's threshold in `SensorTile`; flash via the existing `pulse` value. |

**Honesty guardrail:** #1 and #2 are real behaviors (the hub already fires/actuates/notifies and logs the events) — we're
only surfacing them live and adding an on-cue trigger. Nothing in the speech claims a capability the stack doesn't have.

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

## Beat → rubric map
| Beat | Serves |
|---|---|
| Open-stack hook + "one screen" | **Innovation + Presentation**: a product, not a gadget |
| "Your home" + live chips | **Presentation**: the whole home at a glance |
| Live sensors + cadence slider | **Tech**: real-time streaming off the edge, tunable live |
| Describe → Author → watch card | **Innovation + Tech**: plain words → a running rule via Qwen |
| Hand → tile climbs → feed streams → phone buzzes | **Tech**: the whole chain fires on real hardware, on-screen |
| MCP + self-describing | **Innovation**: open agent interface, zero-config hardware |
| Open-source close | **Impact + Presentation**: self-hostable, offline, model-swappable |

## Shot list
- `[CAM]` host takes: hook (0:00), close (2:18).
- `[SCREEN]` dashboard capture: "Your home" + chips; Sensors (live badge, heartbeat, cadence-slider drag); Describe→Author→new watch card; the payoff (tile climb + card flash + Activity stream); end card.
- `[SHOOT]` the **hero payoff take** — hand cupping the ESP32 and the dashboard in one frame, several passes; the **phone buzz**.

## Production notes
- **Sign in first** — `/dashboard` redirects to `/signin` when signed out; the account email shows in the header pill, so use a clean demo account (e.g. `demo@hearth…`).
- **Get the live badge green before rolling:** the hub must be checked in and streaming so Sensors reads **`live`** (not `connecting…` / `hub offline`). Confirm one tile is updating on its own.
- **Pre-author nothing you'll type on camera** — the nursery watch should be authored *live* so `✍️ Authored` lands in the feed; but pre-create one or two extra watches so the 1:55 pan has cards to show.
- **Make the actuator read on camera:** wire a bigger LED or a relay+lamp to the actuator GPIO (`ACTUATOR_PIN`, `ACTUATOR_ACTIVE_HIGH 0` for active-low) so "cut the heater" is visible. Still 100% real.
- **Phone push:** `export NTFY_TOPIC=hearth-<unique>` + the free ntfy app, foregrounded, before recording — so the buzz + banner land on the hero take.
- **Ship features #1 and #2 (above) before the shoot** — without the live feed and the Test button, the payoff has to be narrated over a static screen.

## Open calls (yours)
1. **Scenario** — "nursery over 78" is filmable today (board temp + relay + notify). Swap the noun (fridge, greenhouse, garage) if a different room shoots better, but keep it **temperature-based** so it matches the real fire.
2. **Voice** — VO in post, or on-camera throughout?
3. **Which quick-build features to land** — #1 and #2 are load-bearing; #3–5 are polish that add vocal punch if there's time.
4. **Firmware still needs an on-device flash to verify** the actuator before the payoff shot (no ESP toolchain in CI).
