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

// Default sample-and-report interval, in milliseconds. This is only the STARTING cadence:
// once the node reaches a hub, the dashboard can retune it at runtime (the hub hands the
// node a new interval in each ingest response — see applyCadence in main.cpp).
#define SAMPLE_INTERVAL_MS 5000
