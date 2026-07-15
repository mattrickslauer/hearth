# Inventory — the Hearth reference kit

Everything on hand for the build. Items marked **⚠️ confirm** were open questions at planning
time; the firmware for the core kit (ESP32 + DHT11 + HC-SR04 + relay) has since shipped and is
flashed on real hardware — see `firmware/src/main.cpp`. The **solar chain remains aspirational**
(panel only; no charge controller/battery), so treat the off-grid outdoor node as a design intent,
not a built node.

---

## Compute

| Qty | Item | Notes | Role in Hearth |
|----|------|-------|----------------|
| 1 | **Raspberry Pi** ⚠️ confirm model/RAM | Full Linux SBC; runs Python + Qwen SDK; SPI/I²C/UART/USB | **The hub** — node registry, deployment runtime, privacy filter, offline fallback, hosts camera/mic |
| 2 | **ESP32-WROOM-32** dev boards | LX6 dual-core @240 MHz, ~520 KB SRAM, Wi-Fi+BLE, ~4 MB flash | **Self-describing sensor/actuator nodes** |
| 1 | **Dev laptop** (macOS, Node 20 / Python 3.14 / Docker) | Build + flashing machine | Development, firmware upload, dashboard dev host |

## Rich perception (the hub's senses — makes Qwen-VL irreplaceable)

| Qty | Item | Notes | Role |
|----|------|-------|------|
| 1 | **USB webcam** | Plugs into the Pi | **Vision node** — frames sent to **Qwen-VL** on events (raw stays local). Guaranteed fallback camera |
| 1 | **USB microphone** | Plugs into the Pi | Audio events / voice interaction |
| 1 | **Insta360 X5** | 360° camera; frames via USB-webcam-mode / RTMP live / periodic stills / SDK | **Optional hero "omni-vision" node** — whole-room awareness for Qwen-VL. ⚠️ integration risk; USB webcam is the fallback |
| 1 | **Sony α7 III (a7iii)** | Full-frame mirrorless; clean HDMI / USB webcam-mode (Imaging Edge) | **Demo-video production camera** (high-quality footage for the 3-min video) + optional high-fidelity vision node |

## Radios & connectivity

| Qty | Item | Notes | Role |
|----|------|-------|------|
| 2 | **nRF24L01** | 2.4 GHz, SPI | Node↔hub link. ⚠️ multi-hop wants a 3rd radio; ESP-NOW/Wi-Fi is the fallback |
| — | ESP32 Wi-Fi / **ESP-NOW** | Built in | Alt node↔hub transport, no extra parts |
| — | Pi Wi-Fi/Ethernet | Built in | Hub uplink to Qwen Cloud |

## Node sensors

| Qty | Item | Measures | Role in a deployment |
|----|------|----------|----------------------|
| 2 | **HC-SR04** | Ultrasonic distance | **Door open/closed**, presence, level |
| 1 | **DHT11** | Temp + humidity | Climate/comfort deployments (heater/fan triggers) |
| 1 | **RFID-RC522** | 13.56 MHz RFID (SPI) | **Household-member identity** (UID hashed before upload) |
| 1 | **GY-NEO6MV2 GPS** | Position (UART) | Optional — outdoor/mobile nodes only |

## Node actuators & outputs

| Qty | Item | Notes | Role |
|----|------|-------|------|
| 1 | **Relay** ⚠️ confirm count/type | Switches mains-ish loads | **Heater / light / appliance** on-off |
| 1 | **Servo** ⚠️ confirm (SG90-class?) | PWM | Camera pan (active sensing), blinds/vent |
| 1 | **QAPASS 16×2 LCD + I²C** | HD44780 + PCF8574 | On-node status readout |

## Power & storage

| Qty | Item | Notes | Role |
|----|------|-------|------|
| 1 | **Solar panel** (~60×55 mm) | Small PV | Off-grid outdoor node story. ⚠️ needs charge controller + battery + regulator — **do we have these, or is solar a demo prop?** |
| 1 | **microSD adapter** | SPI SD breakout | Optional node buffer (hub is primary buffer) |
| — | Pi microSD card | OS/storage | Hub OS + primary event buffer/log |

## Support parts — ⚠️ confirm on hand

Breadboard(s) · jumper wires (M-M / M-F) · **4.7–10 kΩ pull-up** for DHT11 · clean 3.3 V / decoupling
for nRF24 · USB cables for flashing · external 5 V supply for servo/relay · header pins.

## Cloud, software & accounts

| Item | Status | Role |
|------|--------|------|
| **Qwen Cloud API key / hackathon credits** | ✅ **active** | Powers authoring (`qwen-plus`) + Qwen-VL judging. Verify: `cd backend && npm run qwen-check` |
| Qwen endpoint | ✅ `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (OpenAI-compatible) | Shipped models: **qwen-plus**, **qwen-vl-plus** |
| **Alibaba Cloud account** | ✅ **provisioned + deployed** | Function Compute 3.0 (`ap-southeast-1`), Tablestore, OSS (`hearth-vision-c11d45`). Live: `hearth-mcp-gqfuhlkzpo.ap-southeast-1.fcapp.run/health` |
| Qwen-Agent / Model Studio Skills | ❌ not used | We exposed the home as a 21-tool **MCP surface** on FC instead |
| Dev tooling | ✅ Node 20, Python 3.14, Docker, git | Build/deploy |
| PlatformIO | ✅ used | ESP32 firmware build + flash (`firmware/`) |

## Environment & non-hardware assets

| Asset | Role |
|-------|------|
| The developer's own home | Live demo environment for the "describe it" hero demo |
| Senior full-stack developer (solo) | The team |
| Submission deadline **2026-07-20 14:00 PDT** | Timeline |

---

### How the planning questions resolved
1. **Node↔hub transport** — ✅ **Wi-Fi + HTTP with mDNS discovery**, not nRF24. Nodes find the hub
   via mDNS and re-discover after 3 failed posts (`firmware/src/main.cpp`). nRF24 unused.
2. **Relay + servo** — ✅ relay actuation shipped and is the on-camera payoff (`ACTUATOR_PIN`, with
   an active-low option and a node-side safety-veto latch).
3. **Solar power chain** — ❌ **not built.** Panel alone won't run a node and we have no charge
   controller/battery/regulator. Off-grid outdoor node is design intent only; don't claim it.
4. **Sensors shipped** — ESP32 chip temp (`temperatureRead()`), DHT11 temp/humidity, HC-SR04
   distance. **RFID is not implemented** — household identity is done by **Qwen-VL comparing
   reference photos**, which is the better story anyway.
5. **Camera** — ✅ USB webcam via ffmpeg on the hub (`hub/camera.mjs`). Insta360/α7 unused for the
   system; the α7 is the video-production camera.
