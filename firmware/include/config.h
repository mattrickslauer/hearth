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
#ifndef DHT_PIN
#define DHT_PIN 4
#endif
#define DHT_TYPE DHT11

// ─── Relay / motor actuator (the cloud→node direction) ─────────────────────
// This is what makes a MOTOR NODE: wire a relay to RELAY_PIN and the node
// self-describes an actuator the cloud can command on/off. It's the mirror
// image of the sensors above — instead of the node telling the cloud a value,
// the cloud tells the node to do something, and the node echoes back what it did.
//
//   RELAY_PIN = the GPIO that drives the relay. Set to -1 to disable (a pure
//               sensor node — the default, so existing nodes are unchanged).
//
// A bare 12V-coil relay (e.g. Hongfa HKVF4-4C12-B) CANNOT be driven straight
// from a 3.3V ESP32 pin — see firmware/README.md for the transistor + flyback
// diode wiring. Pre-built blue relay MODULES can be driven directly.
#ifndef RELAY_PIN
#define RELAY_PIN -1
#endif

// Drive polarity. 1 = GPIO HIGH energizes the relay (the natural sense when you
// switch a bare coil through an NPN transistor / logic-level MOSFET low-side).
// 0 = GPIO LOW energizes (most opto-isolated blue relay MODULES are active-LOW).
#ifndef RELAY_ACTIVE_HIGH
#define RELAY_ACTIVE_HIGH 1
#endif

// Node-side safety veto: force the relay OFF after this many ms of continuous ON,
// no matter what the cloud last commanded — a motor you can't see shouldn't run
// forever on a stuck command. 0 = no limit (run until commanded off).
#ifndef RELAY_MAX_ON_MS
#define RELAY_MAX_ON_MS 0
#endif

// How often to sample and report, in milliseconds.
#ifndef SAMPLE_INTERVAL_MS
#define SAMPLE_INTERVAL_MS 5000
#endif
