# Inventory — the Hearth reference kit

Everything on hand for the build. Items marked **⚠️ confirm** are assumptions or missing
specs — please correct.

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
| **Qwen Cloud API key / hackathon credits** | ⚠️ **not yet — sign up ASAP** | Powers authoring + runtime reasoning (incl. Qwen-VL); blocks all interesting work |
| Qwen endpoint | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (OpenAI-compatible) | qwen-plus / qwen-max / qwen-vl |
| **Alibaba Cloud account** | ⚠️ confirm | Required for "Proof of Alibaba Cloud Deployment" (host the dashboard/console) |
| Qwen-Agent / Model Studio Skills | To evaluate | Deeper "used their stack" story |
| Dev tooling | ✅ Node 20, Python 3.14, Docker, git | Build/deploy |
| Arduino IDE / PlatformIO | ⚠️ not installed | ESP32 firmware build + flash |

## Environment & non-hardware assets

| Asset | Role |
|-------|------|
| The developer's own home | Live demo environment for the "describe it" hero demo |
| Senior full-stack developer (solo) | The team |
| ~8 days (deadline 2026-07-09 14:00 PDT) | Timeline |

---

### Open questions this raises
1. **Raspberry Pi model + RAM?** (affects what runs locally, e.g. any local vision)
2. **Relay + servo — how many, what type?** (both are core actuators)
3. **Solar power chain** — panel alone won't run a node; do we have controller + battery + regulator, or is solar "for the photo"?
4. **3rd nRF24, or ESP-NOW/Wi-Fi** for node↔hub transport?
5. **Support parts** (DHT11 pull-up, nRF24 power, external 5 V) — on hand?
