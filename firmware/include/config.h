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
// A single on/off output the hub can drive when a watch fires. The default is
// GPIO2, the built-in LED on most ESP32 dev boards — so a bare board can light
// up on command with nothing wired. Point it at a relay/MOSFET GPIO to switch a
// real load (heater, lamp). Set ACTUATOR_PIN to -1 to disable actuation.
#define ACTUATOR_PIN 2
#define ACTUATOR_ACTIVE_HIGH 1  // 1: HIGH = on (built-in LED). 0: for active-low relays.
#define ACTUATOR_KEY "led"      // the name this output advertises to the hub
#define ACTUATOR_PORT 8080      // the node listens here for POST /actuate
