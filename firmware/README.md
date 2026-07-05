# Hearth sensor node firmware — *build your own node*

An open-source, self-describing ESP32 sensor node. Flash it and it **introduces
itself** — announcing what it is and what it can measure — then streams readings
as line-delimited JSON over USB, and (optionally) to your hub or Hearth Cloud.

It works the instant it's flashed, with **nothing wired**: the ESP32's built-in
chip-temperature sensor gives a real reading on a bare board. Wire a DHT11 (or
disable it) and add Wi-Fi when you're ready.

## What it emits

On boot — a self-description:

```
DESCRIBE {"type":"hearth.node.describe","id":"node-A1B2C3D4E5F6","fw":"0.1.0",
          "board":"esp32-wroom-32","sensors":[
            {"key":"board.temp","kind":"temperature","unit":"C","wiring":"builtin"},
            {"key":"dht.temp","kind":"temperature","unit":"C","pin":4},
            {"key":"dht.humidity","kind":"humidity","unit":"pct","pin":4}]}
```

Then, every few seconds — a reading (absent sensors report `null`, which is
itself signal):

```
READING {"type":"hearth.node.reading","id":"node-A1B2C3D4E5F6","uptime_ms":5021,
         "readings":{"board.temp":48.9,"dht.temp":null,"dht.humidity":null}}
```

A **motor node** additionally announces an `actuators` menu in its DESCRIBE and
echoes the relay's live state in every reading:

```
DESCRIBE {…,"actuators":[{"key":"motor","kind":"relay","access":"actuate","pin":26,"state":"off"}]}
READING  {…,"readings":{"board.temp":44.1,"motor.state":0}}
```

and reads its command back off the reply to that POST:

```
← {"ok":true,"commands":[{"key":"motor","value":"on"}]}   → relay closes, motor spins
```

## Hardware

- **ESP32-WROOM-32** dev board + USB cable (a real reading needs nothing more).
- Optional **DHT11**: data → GPIO4, `+` → 3V3, `-` → GND. A 4.7–10 kΩ pull-up
  between data and 3V3 improves reliability.

## Make it a *motor node* (the cloud → node direction)

Everything above is a node **reporting** to the cloud. A motor node is the mirror
image: the cloud **commands** it. Wire a relay to `RELAY_PIN` and the node
self-describes a `motor` actuator; the `actuate` MCP tool sets a desired state, the
hub relays it down in the reply to the node's next reading POST, and the node drives
the relay and echoes `motor.state` back up. No inbound connection to the node — the
node's own outbound POST doubles as its command poll.

Flash the second ESP32 with the ready-made env (no source edits):

```bash
pio run -e esp32-motor -t upload      # RELAY_PIN=26, active-high, no auto-off
```

**Wiring — a bare 12 V relay (e.g. Hongfa HKVF4-4C12-B, 12 V coil / 40 A contacts).**
A 12 V coil *cannot* be driven from a 3.3 V GPIO directly. Use a low-side switch:

```
GPIO26 ──[1 kΩ]──┤ base        NPN transistor (e.g. 2N2222 / BC547)
                 │  (or gate of a logic-level MOSFET like 2N7000)
       emitter ──┴── GND (common with the ESP32 ground)
     collector ───── relay coil (−)
   relay coil (+) ── +12 V
                     └──►|── across the coil: FLYBACK DIODE (1N4001),
                          cathode (band) to +12 V. NOT OPTIONAL — the coil's
                          collapse spike will otherwise destroy the transistor/GPIO.
```

With this NPN low-side switch, **GPIO HIGH energizes the coil** → keep
`RELAY_ACTIVE_HIGH=1` (the `esp32-motor` default). The motor + its power source go on
the relay's **switched contacts** (COM/NO), fully isolated from the ESP32. A
pre-built opto-isolated **blue relay module** can instead be driven straight from the
GPIO — those are usually active-LOW, so set `-DRELAY_ACTIVE_HIGH=0`.

Node-side **safety veto**: set `RELAY_MAX_ON_MS` to force the relay off after N ms of
continuous ON regardless of the cloud (0 = off, the current default). A motor you
can't see shouldn't run forever on a stuck command.

## Configure

Everything you'd change lives in [`include/config.h`](include/config.h): Wi-Fi
SSID/password, the hub POST endpoint, the DHT pin (or `-1` to disable it), and
the sample interval. Out of the box Wi-Fi is empty, so it runs **serial-only** —
no network or accounts required for a first reading.

## Build & flash

**Reproducible, zero host toolchain — via Docker** (the board on `/dev/ttyUSB0`):

```bash
docker run --rm --device=/dev/ttyUSB0 -v "$PWD":/w -w /w \
  -v hearth-pio:/root/.platformio python:3.13-slim \
  bash -lc 'pip install -q platformio && pio run -t upload'
```

The `hearth-pio` named volume caches the toolchain so re-flashes are fast.

**Natively**, if you have [PlatformIO](https://platformio.org/):

```bash
pio run -t upload      # compile + flash
pio device monitor     # watch it talk (115200 baud)
```

Headless read-back (used by the flashing pipeline):
`python scripts/monitor.py /dev/ttyUSB0 115200 18`.

## Finding the hub

The node **discovers the hub automatically** — you don't configure an address.
The hub agent (`../hub/agent.mjs`) advertises itself on the LAN over mDNS as
`_hearth._tcp`; on boot the node browses for it, resolves the hub's IP + port,
and POSTs its `DESCRIBE` + readings there. If the hub starts *after* the node,
the node keeps browsing and attaches when it appears. `HUB_ENDPOINT` in
`config.h` is only a fallback for networks that filter multicast.

## Roadmap

- ✅ Relay actuation behind the self-describe contract — the cloud→node direction
  (this doc). Servo/PWM next behind the same `actuators` menu.
- More sensors behind the same self-describe contract (HC-SR04 distance,
  RC522 identity).
- Hub persists the registry + forwards to Hearth Cloud / the rule engine.
- Signed enrollment so a node pairs to an account the way the hub does.
