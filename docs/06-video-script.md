# 06 — Demo Video Script (≤ 3:00) — REAL-HARDWARE cut

Submission video for **Track 5: EdgeAgent**. Target runtime **2:50**. Format: 1080p+, YouTube/Vimeo/Youku.
This cut leads with **real footage of real hardware being used** — a chip you flash, a board that lights up in
your hand, a phone that buzzes. Everything scripted here is genuinely wired and was tested end-to-end
(see "What's real" below). The browser simulator is the *rehearsal/fallback*, not the hero.

**Legend:** `[CAM]` you to camera · `[SHOOT]` real hardware footage · `[SCREEN]` app/terminal capture ·
`[GFX]` generated graphic/overlay · `[VO]` voiceover over B-roll.

## What's real in this cut (so you can film it honestly)
Built and tested for this cut (`hub/engine.mjs`, `hub/runtime.mjs`, `hub/notify.mjs`, firmware actuator):
- ✅ **Flash a bare ESP32 → it self-describes** (`DESCRIBE`: "can sense: board.temp · can do: led") and streams real temperature.
- ✅ **Hub auto-discovers it** over mDNS, ingests readings, **pairs to the real cloud** with a claim code, shows it on the dashboard.
- ✅ **Real Qwen compiles your plain-English wish** into a watch spec (live `QWEN_API_KEY` in the backend).
- ✅ **The money shot: warm the board → watch fires on the hub → the board's LED lights → your phone buzzes.**
  The hub now runs the real rule engine (ported from the app) and drives a real GPIO + a real push (ntfy/Telegram).
  Verified end-to-end in software via `node hub/tools/selftest.mjs` and a full `hub.mjs` + fake-node run.
- ✅ **Runs offline** — the watch evaluates and fires on the hub with no internet.

**Still simulated — do NOT film as real hardware (Phase 2):**
- ❌ **Qwen-VL on a real camera.** There's no camera in the firmware and no image is sent to a model yet. Script it only as
  "the same contract takes a camera *next*" (future tense), as the read-aloud does. Don't point a lens and claim live vision.
- The browser `/demo` still simulates a door/visitor/vision — fine as a rehearsal or a "try it yourself" beat, not as hardware.

## Before you shoot — one-time setup
1. **Flash the node:** `firmware/` → `pio run -t upload` (LED actuator defaults to GPIO2, the built-in LED — zero extra wiring).
2. **Calibrate the threshold:** run the node, note the idle `board.temp` (it reads warm), set the watch's `right` a few degrees above it.
3. **Author the watch:** describe it in the Hearth app (real Qwen compiles it), or start from `hub/watches.example.json`; put the
   compiled spec in `~/.hearth/watches.json` with your node's id and `actuate` → led.
4. **Turn on phone push:** `export NTFY_TOPIC=hearth-<something-unique>`, install the free **ntfy** app, subscribe to that topic.
5. **Rehearse with no hardware if needed:** `node hub/hub.mjs` + `node hub/tools/fake-node.mjs` reproduces the whole fire→LED→push
   loop on one laptop — good for a dry run and for capturing clean terminal B-roll.

---

## The one-line spine
Plug in a chip → it introduces itself → you say what you want → Qwen compiles it → and it runs on your real hardware, in your home.

---

## Script

| Time | Visual | Audio |
|---|---|---|
| **0:00–0:11** | `[CAM]` You, direct to camera. Fast, punchy. | "Everyone wants a smart home. Almost nobody has one — because to automate *anything*, you first have to *program* it. Rules, thresholds, if-this-then-that. So the rest of us just… don't." |
| **0:11–0:22** | `[CAM]` → `[GFX]` title card: **Hearth — the home you describe, not program.** | "Hearth kills the rules. You plug in a chip, tell your house what you want in plain words, and an AI wires it up — on real hardware, in your actual home." |
| **0:22–0:42** | `[SHOOT]` Hands plug a bare ESP32 into USB. `[SCREEN]` serial monitor scrolls: `=== Hearth sensor node ===`, then `DESCRIBE … can sense: board.temp · can do: led`, then live `READING` lines. `[GFX]` highlight "can sense / can do". | `[VO]` "This is a two-dollar chip. I flash it — and it *introduces itself*. Here's who I am, here's what I can sense, here's what I can do. No driver, no config file. It just starts talking." |
| **0:42–1:05** | `[SCREEN]` Hub terminal: `+ NEW NODE … can sense: board.temp · can do: led`, then the boxed **claim code**. Cut to `[SHOOT]` phone: dashboard → **Connect a hub** → type the code → hub flips **Online**, a **temperature tile** shows the board's real reading. | `[VO]` "My hub finds it on the network on its own — no address to type. I pair the hub to the cloud with one code, and the device shows up on my phone, live, with its real temperature. That's running on Alibaba Cloud." |
| **1:05–1:30** | `[SCREEN]` Type a wish: *"If this gets too warm, turn on the light and text me."* Hit **Compile ↵** → **"QWEN IS COMPILING"** → the compiled **watch card** (bound input `board.temp`, When/Do, `local · offline`). | `[VO]` "Now I just say what I want. 'If this gets too warm, turn on the light and text me.' I hit compile — and Qwen reads what my hardware can actually sense and do, and turns that one sentence into a running watch. I never picked a sensor. I never wrote a rule." |
| **1:30–2:05** | **THE MONEY SHOT.** `[SHOOT]` One continuous take: you cup the ESP32 in your hand; `[GFX]` the temperature number climbs; it crosses the threshold; the board's **LED lights up**; your **phone buzzes** with the push notification. Hold on all three: hand, LED, phone. | `[VO]` "So let's try it for real. I warm the sensor with my hand… the temperature climbs… it crosses the line — and the board lights up, and my phone buzzes. Real sensor, real trigger, a real device switching on." |
| **2:05–2:25** | `[SHOOT]` Pull the ethernet / flip the router off (or airplane-mode the hub's uplink), warm the board again → the **LED still lights**. `[GFX]` "runs on the hub · works offline · nothing leaves home." | `[VO]` "And here's the part that matters: that watch runs right on the hub, in my house. It doesn't need the cloud to fire — cut the internet and it still works. Nothing about my home has to leave my home for the simple stuff." |
| **2:25–2:40** | `[CAM]` You to camera, holding the board. `[GFX]` a camera-module node next to it (or a quick render) to signal "next". | "Today this node senses temperature and switches a light. The exact same self-describing contract takes a *camera* next — so Qwen can reason about what it actually sees. Same chip, same one sentence, richer senses." |
| **2:40–2:52** | `[CAM]` → `[GFX]` end card: **Hearth · open source · built on Qwen Cloud · <repo URL>.** | "No rules. No YAML. You plug it in and tell your house what you want. Hearth is open source — clone it, and go talk to your house." |

**Total: ~2:52.** Buffer to trim: the offline beat (2:05–2:25) can lose ~6s if you run long.

---

## Word count / pacing
~340 spoken words ≈ 2:50 at ~120 wpm. If you run long, cut sentences before cutting beats.

## Beat → rubric map (why each shot earns its place)
| Beat | Serves |
|---|---|
| Flash → self-describing node | **Innovation + Tech**: zero-config, self-describing edge hardware — real, on camera |
| Auto-discover → pair → dashboard on Alibaba Cloud | **Tech + Impact**: real edge→cloud pipeline, real device online |
| Plain-English wish → real Qwen compiles a watch | **Innovation + Tech**: NL→config program synthesis with a live Qwen key |
| Warm the board → LED lights → phone buzzes | **Tech**: end-to-end perceive→decide→act on *real hardware*, filmed live |
| Offline fire | Rubric's graceful-degradation + local/privacy clauses |
| "camera next" close | Honest roadmap; sets up Qwen-VL without overclaiming |
| Open-source close | **Impact + Presentation**: accessibility, credibility |

## Shot list to capture
- `[CAM]` host takes: hook (0:00), thesis (0:11), "camera next" (2:25), close (2:40). Same framing/wardrobe.
- `[SHOOT]` **hero take** (2 min of coverage, multiple passes): the hand-warm → LED → phone-buzz in ONE frame if you can; also singles of each.
- `[SHOOT]` flashing the board + USB; the offline pull-the-plug beat.
- `[SCREEN]` serial monitor (DESCRIBE/READING), hub terminal (NEW NODE + claim code), phone dashboard (hub Online + temp tile), the Describe→Compile watch card.
- `[GFX]` title card, "can sense / can do" callout, climbing-temperature overlay, "works offline / nothing leaves home", end card.

## Production notes
- **Get the LED to read on camera.** GPIO2's built-in LED is small — for a punchier shot, wire a bigger LED or a relay+lamp to a GPIO
  and set `ACTUATOR_PIN` to it (`ACTUATOR_ACTIVE_HIGH 0` for active-low relays). Still 100% real.
- **Make the temperature climb fast.** Cupping the chip works; a brief breath or a hand-warmer speeds it. Keep the threshold just above idle.
- **Frame the phone and the board together** for the money shot so there's no cut between cause and effect — that single unbroken frame is what sells "real."
- **ntfy** shows the 🔥 via its Tags; the push title is ASCII-sanitized (headers can't carry emoji), body keeps full text.

## Open calls (yours)
1. **Product name** on the title/end cards — keep "Hearth"?
2. **Voice** — VO in post, or on-camera sync sound throughout?
3. **Second sensor for the trigger?** Temperature-by-hand is reliable and needs zero wiring. A reed/door switch would be more "home,"
   but it's not in the firmware yet — temperature is the honest, filmable trigger today.
