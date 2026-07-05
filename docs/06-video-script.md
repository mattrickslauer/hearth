# 06 — Demo Video Script (≤ 3:00)

Submission video for **Track 5: EdgeAgent**. Target runtime **2:50**. Format: 1080p+, YouTube/Vimeo/Youku.
Base layer = **you on camera** (host segments); everything else is **screen capture**, optional **real hardware footage**,
and **generated overlay graphics** dropped on top.

**Legend:** `[CAM]` you to camera · `[SCREEN]` app screen-capture · `[SHOOT]` real hardware footage (optional flex) ·
`[GFX]` generated graphic/overlay · `[VO]` voiceover over B-roll.

**What changed since the last cut (v1 → v2) — read before you record:**
- **The word is "watch," not "deployment."** The product says *watch* everywhere on screen ("What should your home watch for?",
  "N active watches", "Describe a new watch"). Say **watch**. The button says **Compile ↵** and the console flashes
  **"QWEN IS COMPILING"** — say **compile**, it matches.
- **New beat — change your mind (live).** You can add a vision watch and tune its **Record policy** live (On-event vs Metered,
  frame-rate presets 2s/10s/30s/2m, and a **Model** dropdown). On the dashboard, editing a watch's text and hitting
  **Re-compile →** re-derives the whole thing. This is the strongest new "wow" — it shows synthesis is *interactive*, not one-shot.
- **New beat — the dashboard is real.** `/dashboard` is a live backend on **Alibaba Cloud Function Compute**: sign in, pair a
  real hub with an **8-character code**, and real devices + sensor readings show up. Great credibility close and doubles as
  deployment proof.
- **Honesty fixes (do NOT overclaim):**
  - The browser demo's camera + Qwen-VL is **simulated by default** (brain pill reads "Qwen (simulated)"). Present the vision
    beat as the *demo's* vision watch reasoning — **do not** say "this is a real camera, live Qwen-VL" over screen capture.
    If you want the real-hardware hero shot, it's an **optional `[SHOOT]`** you must actually film (see shot list).
  - **Notifications are push toasts, not email.** Email is only the sign-in code. Say "pinged" / "push," never "email."
  - There is **no raw-vs-redacted split-screen panel** in the UI — only a text privacy note ("nothing left the house").
    Script the words, not a visual that doesn't exist.

**Compliance (from the audit — do not skip):**
- No third-party **trademarks/logos** on screen. Blur any brand logos, plates, house numbers in `[SHOOT]` footage.
- **No unlicensed music.** Royalty-free / original only.
- Naming Qwen / Qwen-VL is required (Stage-1 gate wants visible Qwen use) — that's fine; avoid other companies' logos.
- The **Alibaba Cloud deployment proof** can be a *separate* screen recording, but the live dashboard beat here also shows it.

---

## The one-line spine
Describe your home in plain words → Qwen **compiles** it into a live watch → and it **reasons** about the real world as it runs.

---

## Script

| Time | Visual | Audio |
|---|---|---|
| **0:00–0:10** | `[CAM]` You, direct to camera. Clean room, warm light. Fast, punchy. | "Everyone wants a smart home. Almost nobody has one — because to automate *anything*, you first have to *program* it. Rules, thresholds, if-this-then-that. So the rest of us just… don't." |
| **0:10–0:20** | `[CAM]` → `[GFX]` title card: **Hearth — the home you describe, not program.** | "Hearth kills the rules. You describe your home in plain words — and an AI *compiles* it into something that actually runs." |
| **0:20–0:38** | `[SCREEN]` Landing → `/demo`. The living floor plan: rooms, sensors, actuators, Describe console on the left, Activity feed on the right. | `[VO]` "No login, no hardware — this is running in your browser right now. A whole simulated home: rooms, sensors, actuators, all live. So watch what happens when I just *say* what I want." |
| **0:38–1:05** | `[SCREEN]` Type into the Describe box: *"Warn me if the garage is open after dark and it's cold — and turn on the heater."* Hit **Compile ↵** → **"QWEN IS COMPILING"** dots → the **compiled watch card** animates in (bound-input chips · When/Do rows · `local · offline` + `no tokens` badges). | `[VO]` "'Warn me if the garage is open after dark and it's cold — and turn on the heater.' Compile. I never picked a sensor. I never wrote a rule. Qwen read what this home can sense and do, and compiled my sentence into a working *watch* — the inputs to bind, the trigger, the action. That's program synthesis, not a form." |
| **1:05–1:22** | `[SCREEN]` Add a second watch that needs vision (e.g. *"Tell me if a package is left on the porch"*). Card comes back tagged **Qwen-VL**. Open its **RECORD POLICY**: toggle **Metered**, tap a frame-rate preset, open the **Model** dropdown. `[GFX]` subtle "tuning live" callout. | `[VO]` "And I can change my mind. Let me add one that has to actually *see* — is a package on the porch. Qwen binds the camera and reaches for vision — and I can tune it live: how often it looks, and which model does the looking." |
| **1:22–1:40** | `[SCREEN]` Top-bar world controls: set **Night**, drop **Garage temp** (preset Freezing), open the **Garage door**. Threshold crosses → heater actuator flips **ON**, **push toast** (🔥 …), Activity feed logs **Fired**. | `[VO]` "Now I'll turn the world. Push it past dark, drop the temperature, open the garage — and the watch fires on its own. Heater on. I get pinged. I never touched it." |
| **1:40–2:05** | `[SCREEN]` **At the door** visitor picker → choose a *non-family* person. The vision watch reasons in the feed; `[GFX]` overlay surfaces the plain-language reasoning ("Not a household member — worth a ping"). *(Optional `[SHOOT]` real-entryway B-roll cutaway if you filmed it — see notes.)* | `[VO]` "But some things a threshold can never judge. Someone's at the door — is that family, or not? A dumb sensor trips on any motion. This one *looks*, and reasons: not a household member, worth a ping. That's Qwen-VL — an agent, not a tripwire." |
| **2:05–2:24** | `[SCREEN]` Flip Network to **Offline** → local watches keep firing; cloud checks log **offline** and queue. Flip back **Online** → a **"Back online / SYNC"** event summarizes the catch-up. `[GFX]` quiet "nothing left the house" privacy line (the real on-card note). | `[VO]` "Now cut the network. The simple watches keep running right on the hub — nothing ever left the house. And the moment you're back online, it tells you exactly what it caught up on while you were dark." |
| **2:24–2:40** | `[SCREEN]` Cut to `/dashboard` (signed in): **Connect a hub** with an 8-char code → hub goes **Online**, real **device + sensor tiles** populate, summary chips (hubs · devices · sensors · watches). | `[VO]` "And this isn't a sandbox. Sign in, pair a real hub with a code, and your actual devices show up here — live, running on Alibaba Cloud. Same watches. Real house." |
| **2:40–2:52** | `[CAM]` You, direct to camera. `[GFX]` end card: **Hearth · open source · built on Qwen Cloud · <repo URL>.** | "No rules. No YAML. You describe your home — Qwen compiles the rest. Hearth is open source. Clone it, and stop *programming* your house." |

**Total: ~2:52.** Buffer to trim: the record-policy tuning beat (1:05–1:22) can lose ~5s, and the offline beat (2:05–2:24) can lose ~4s, if you run long.

---

## Word count / pacing
~330 spoken words ≈ 2:50 at a calm 115 wpm, leaving air for the overlays to breathe. If you run long,
cut sentences before cutting beats — every beat below maps to a rubric clause.

## Beat → rubric map (why each shot earns its place)
| Beat | Serves |
|---|---|
| Describe → Compile → watch card | **Innovation + Tech**: NL→config program synthesis; visible, sophisticated Qwen use |
| Add vision watch + tune Record policy live | **Tech + Innovation**: synthesis is *interactive*; metered cost/model control; Qwen-VL binding |
| World controls → watch fires | **Tech**: end-to-end perceive→decide→act loop, judge-runnable with zero hardware |
| Visitor picker → Qwen-VL reasons | **Tech + Innovation**: open-ended reasoning; "agent, not a tripwire" |
| Offline "while you were dark" + on-hub note | Rubric's graceful-degradation + privacy-aware clauses |
| Live dashboard: pair a real hub on Alibaba Cloud | **Impact + Tech**: real deployment, real devices, not a mockup |
| Open-source close | **Impact + Presentation**: accessibility, credibility |

## Shot list to capture (production checklist)
- `[CAM]` 3 host takes: hook (0:00), thesis (0:10), close (2:40). Same framing/wardrobe for continuity.
- `[SCREEN]` clean captures of: landing→/demo, Describe→Compile, add-vision-watch + Record policy tuning, world controls →
  fire event + push toast, visitor-picker vision reasoning, Offline→Online sync, and `/dashboard` hub pairing with real tiles.
- `[SHOOT]` *(optional flex)* entryway: real camera → monitor live playback, one person approaching, good light. **Only use this
  if you actually shot it** — do not narrate "real camera / live Qwen-VL" over the simulated demo. If unshot, cut it; the
  simulated vision watch carries the beat honestly.
- `[GFX]` to generate: title card, "tuning live" callout, VL reasoning-trace overlay, "nothing left the house" line, end card.

## Production notes
- **Pre-seed the demo** so recording is clean: have the garage/heater watch authored, then drive the world controls on camera.
- **Reset ↺** between takes (top bar) to clear watches/activity for a fresh compile shot.
- Use **speed 60×** off-camera to advance time between beats; return to **1×** while the watch fires so the toast reads.
- The brain pill reads **"Qwen (simulated)"** by default. If you want the pill to read live Qwen, set `EXPO_PUBLIC_USE_QWEN=1`
  before capture — otherwise keep the language as "Qwen compiles / Qwen-VL reasons" (true of the design) and don't zoom on the pill.

## Open calls (yours)
1. **Product name** on the title/end cards — keep "Hearth"?
2. **Voice** — VO in post, or on-camera sync sound throughout?
3. **Real-hardware `[SHOOT]`** — film the entryway hero shot, or ship the tighter all-`[SCREEN]` cut? (Lean: all-screen for honesty + speed; add hardware later if you have footage.)
4. **Landing copy** still says "deployment" in ~3 spots while the product says "watch." Worth a one-line copy pass so the site and the video agree — not blocking the recording.
