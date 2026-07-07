#pragma once
// ─── Hearth sensor node — your kit config ──────────────────────────────────
// This is the only file you edit to make the node yours. No secrets are
// required to get a first reading: leave WIFI_SSID empty and the node runs in
// serial-only mode, printing real readings over USB.

// Wi-Fi. Leave SSID as "" to run offline (serial-only). Set it to join your
// network and stream readings to a hub / Hearth Cloud.
#define WIFI_SSID ""
#define WIFI_PASS ""

// Hub endpoint. Normally you leave this EMPTY: the node discovers the hub on the
// LAN over mDNS (it advertises itself as _hearth._tcp) — no address to configure.
// Set it only as a fallback for networks where mDNS/multicast is filtered.
#define HUB_ENDPOINT ""

// DHT temperature/humidity sensor.
//   DHT_PIN  = the GPIO the DHT data line is wired to.
//   Set DHT_PIN to -1 to disable it entirely — the node still reports its
//   built-in chip temperature, so it works with nothing wired at all.
#define DHT_PIN 4
#define DHT_TYPE DHT11

// HC-SR04 ultrasonic distance sensor (optional). TRIG drives the pulse, ECHO times the
// return. Set DIST_TRIG_PIN to -1 to disable — unwired, it simply reports null.
#define DIST_TRIG_PIN 18
#define DIST_ECHO_PIN 19

// Default sample-and-report interval, in milliseconds. This is only the STARTING cadence:
// once the node reaches a hub, the dashboard can retune it at runtime (the hub hands the
// node a new interval in each ingest response — see applyCadence in main.cpp).
#define SAMPLE_INTERVAL_MS 5000

// ─── Actuator (what this node can DO, not just sense) ──────────────────────
// A single on/off output the cloud/hub can drive. The default is GPIO2, the
// built-in LED on most ESP32 dev boards — so a bare board can light up on command
// with nothing wired. Point it at a relay/MOSFET GPIO to switch a real load
// (motor, heater, lamp). Set ACTUATOR_PIN to -1 to disable actuation.
//
// A MOTOR NODE is just this actuator pointed at a relay. Two ways to command it:
//   • a hub-local watch fires  → the hub POSTs /actuate to the node (instant, offline)
//   • the cloud `actuate` tool  → desired state rides the ingest reply, the node
//     converges to it (a device shadow — see applyDesired in main.cpp)
//
// Wiring a bare 12V-coil relay (e.g. Hongfa HKVF4-4C12-B): you CANNOT drive a 12V
// coil from a 3.3V pin. Use an NPN transistor / logic-level MOSFET as a low-side
// switch with a flyback diode across the coil — details in firmware/README.md.
// With that transistor, GPIO HIGH energizes the coil → keep ACTUATOR_ACTIVE_HIGH 1.
#define ACTUATOR_PIN 2
#define ACTUATOR_ACTIVE_HIGH 1  // 1: HIGH = on (built-in LED / transistor-driven coil). 0: active-low relay modules.
#define ACTUATOR_KEY "led"      // the name this output advertises to the hub ("motor" for a motor node)
#define ACTUATOR_PORT 8080      // the node listens here for POST /actuate
// Node-side safety veto: force the output OFF after this many ms of continuous ON, no matter
// what the cloud last commanded, and IGNORE further "on" until it is commanded off (an explicit
// re-arm). A motor you can't see shouldn't run forever on a stuck command. 0 = no limit.
#define ACTUATOR_MAX_ON_MS 0
