# 06 — Demo Video Script (≤ 3:00)

Submission video for **Track 5: EdgeAgent**. Target runtime **2:45**. Format: 1080p+, YouTube/Vimeo/Youku.
Base layer = **you on camera** (host segments); everything else is **screen capture**, **real hardware footage**,
and **generated overlay graphics** dropped on top.

**Legend:** `[CAM]` you to camera · `[SCREEN]` app screen-capture · `[SHOOT]` real hardware footage ·
`[GFX]` generated graphic/overlay · `[VO]` voiceover over B-roll.

**Compliance (from the audit — do not skip):**
- No third-party **trademarks/logos** on screen. Blur any brand logos, plates, house numbers in `[SHOOT]` entryway footage.
- **No unlicensed music.** Royalty-free / original only.
- Naming Qwen / Qwen-VL is required (Stage-1 gate wants visible Qwen use) — that's fine; avoid other companies' logos.
- The **Alibaba Cloud deployment proof** is a *separate* screen recording, not this video.

---

## The one-line spine
Describe your home in plain words → an AI wires it up → and it reasons about the real world as it runs.

---

## Script

| Time | Visual | Audio |
|---|---|---|
| **0:00–0:13** | `[CAM]` You, direct to camera. Clean room, warm light. | "Home automation has a problem. To automate *anything*, you have to *program* it — rules, thresholds, if-this-then-that. So ninety-nine percent of us never automate a single thing." |
| **0:13–0:24** | `[CAM]` → `[GFX]` title card: **Hearth — the open-source, AI-native home.** | "So we built Hearth. You don't write rules. You just *say what you want* — and an AI wires it up." |
| **0:24–0:40** | `[SCREEN]` Landing → `/demo`. A living software home: zones, sensors, actuators. Drag a sensor into a room. | `[VO]` "This is the platform, running in your browser — the same software that drives real devices. So anyone can try it, it ships with a simulated home: zones, sensors, actuators, all drag-and-drop." |
| **0:40–1:05** | `[SCREEN]` Type into the Describe box: *"Warn me if the garage is open after dark and it's cold — and turn on the heater."* `[GFX]` the **compiled deployment card** animates in (inputs it chose · local-vs-cloud · action · cost · privacy). | `[VO]` "Watch. I type what I want. Qwen reads what this home can *sense* and *do*, and synthesizes the whole deployment — which sensors to bind, the logic, the action. I never wrote a rule. That's program synthesis, not a form." |
| **1:05–1:25** | `[SCREEN]` The world panel: dials for **time of day, temperature, humidity.** `[GFX]` data-flow line: reading → typed → stored, with a live "where your data lives" callout. | `[VO]` "Every reading is typed and stored — you can see exactly where your data lives. And I can turn the world: push it past dark, drop the temperature—" |
| **1:25–1:38** | `[SCREEN]` The world crosses the threshold → `[GFX]` deployment fires; heater actuator flips ON; phone push toast. | `[VO]` "—and the deployment fires on its own. Heater on. Notified. It just *works*." |
| **1:38–2:05** | `[SHOOT]` Real camera on your entryway feeding a monitor; live playback. `[GFX]` overlay: bounding box + a quiet left-rule **reasoning trace** appearing as text. Someone walks up. | `[VO]` "But the real magic is reasoning about the messy real world. This is a *real* camera on my entryway, on real hardware. Live, Qwen-VL watches the scene." |
| **2:05–2:25** | `[SHOOT]`+`[GFX]` overlay reasons in plain language: *"Not a household member. First frame unclear — looked closer."* box tightens on the face. | `[VO]` "It doesn't fire a dumb motion alarm. It *reasons*: do I know this person? The frame was unclear, so it looked closer — then it decides if this is even worth interrupting me for. That's an agent, not a sensor." |
| **2:25–2:38** | `[SCREEN]`/`[GFX]` split: kill-network toast → local watches still green; then a **"while you were dark"** summary. Side-by-side: **raw local frame vs. minimized/redacted frame sent to cloud.** | `[VO]` "Cut the network — the simple watches keep running locally, and it tells you what it missed. And the raw video never leaves home. Only a minimized, redacted frame is ever sent." |
| **2:38–2:52** | `[CAM]` You, direct to camera. `[GFX]` end card: **Hearth · open source · built on Qwen Cloud · <repo URL>.** | "No rules. No YAML. You describe your home — it figures out the rest. Hearth is open source. Clone it, and go talk to your house." |

**Total: ~2:52.** Buffer to trim: the world-dial beat (1:05–1:25) can lose ~5s if long.

---

## Word count / pacing
~300 spoken words ≈ 2:45 at a calm 110–120 wpm, leaving air for the overlays to breathe. If you run long,
cut sentences before cutting beats — every beat above maps to a rubric clause.

## Beat → rubric map (why each shot earns its place)
| Beat | Serves |
|---|---|
| Describe → compiled card | **Innovation + Tech**: NL→config program synthesis; visible, sophisticated Qwen use |
| World dials → deployment fires | **Tech**: end-to-end loop, judge-runnable with zero hardware |
| Real camera + Qwen-VL reasoning trace | **Tech + Innovation**: real edge perceive→reason→act; "agent, not sensor" |
| Offline "while you were dark" | Rubric's graceful-degradation clause |
| Raw-vs-sent privacy reveal | Rubric's privacy-aware data-handling clause |
| Open-source close | **Impact + Presentation**: accessibility, credibility |

## Shot list to capture (production checklist)
- `[CAM]` 3 host takes: hook (0:00), thesis (0:13), close (2:38). Same framing/wardrobe for continuity.
- `[SCREEN]` clean capture of: landing→/demo, drag-in, Describe→compile, world dials, fire event, offline + privacy reveal.
- `[SHOOT]` entryway: camera→monitor live playback, one person approaching, good light. Shoot several passes.
- `[GFX]` to generate: title card, compiled-deployment card, data-flow/storage callout, VL bounding box + reasoning trace, raw-vs-sent split, end card.

## Open calls (yours)
1. **Product name** on the title/end cards — keep "Hearth"?
2. **Voice** — VO in post, or on-camera sync sound throughout?
3. Show the **second** hardware example if time allows, or keep the single camera demo for tightness? (Lean: single, tighter.)
