// ─── Hearth sensor node ────────────────────────────────────────────────────
// A self-describing edge node. On boot it announces WHAT IT IS and WHAT IT CAN
// MEASURE (the DESCRIBE document), then streams READING documents forever.
// Everything prints over serial as line-delimited JSON; if Wi-Fi is configured
// it also POSTs the same documents to your hub / Hearth Cloud.
//
// The whole point: a node you flash and it introduces itself. No central
// registry has to know about it in advance — it tells you what it offers, and
// an LLM upstream decides what to do with it.

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include "config.h"

#ifndef HEARTH_FW_VERSION
#define HEARTH_FW_VERSION "0.0.0"
#endif

#if DHT_PIN >= 0
DHT dht(DHT_PIN, DHT_TYPE);
#endif

static String   gNodeId;
static uint32_t gLastSample = 0;
static bool     gAnnounced  = false;

// Stable per-chip identity, derived from the factory-burned MAC.
static String nodeId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof(buf), "node-%012llX", (unsigned long long)mac);
  return String(buf);
}

// ESP32 built-in temperature sensor. Uncalibrated (reads warm — it's the die,
// not the room) but it's a REAL reading available with zero wiring, so a
// freshly flashed bare board still has something true to report.
static float chipTempC() {
  return temperatureRead();
}

static bool wifiConfigured() { return strlen(WIFI_SSID) > 0; }

// The self-description: identity + the menu of what this node can sense.
static String describeJson() {
  String s = "{";
  s += "\"type\":\"hearth.node.describe\",";
  s += "\"id\":\"" + gNodeId + "\",";
  s += "\"fw\":\"" HEARTH_FW_VERSION "\",";
  s += "\"board\":\"esp32-wroom-32\",";
  s += "\"sensors\":[";
  s += "{\"key\":\"board.temp\",\"kind\":\"temperature\",\"unit\":\"C\",\"wiring\":\"builtin\"}";
#if DHT_PIN >= 0
  s += ",{\"key\":\"dht.temp\",\"kind\":\"temperature\",\"unit\":\"C\",\"pin\":" + String(DHT_PIN) + "}";
  s += ",{\"key\":\"dht.humidity\",\"kind\":\"humidity\",\"unit\":\"pct\",\"pin\":" + String(DHT_PIN) + "}";
#endif
  s += "]}";
  return s;
}

// A snapshot of current readings. Absent/failed sensors report null rather than
// being dropped — a missing value is itself information the hub can reason about.
static String readingsJson() {
  String s = "{";
  s += "\"type\":\"hearth.node.reading\",";
  s += "\"id\":\"" + gNodeId + "\",";
  s += "\"uptime_ms\":" + String((uint32_t)millis()) + ",";
  s += "\"readings\":{";
  s += "\"board.temp\":" + String(chipTempC(), 1);
#if DHT_PIN >= 0
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  s += ",\"dht.temp\":"     + (isnan(t) ? String("null") : String(t, 1));
  s += ",\"dht.humidity\":" + (isnan(h) ? String("null") : String(h, 1));
#endif
  s += "}}";
  return s;
}

static void connectWifi() {
  if (!wifiConfigured()) {
    Serial.println("[wifi] no SSID configured — running serial-only");
    return;
  }
  Serial.printf("[wifi] connecting to \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(400);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf(" ok, ip=%s\n", WiFi.localIP().toString().c_str());
  else
    Serial.println(" FAILED — continuing serial-only");
}

// Best-effort POST. Returns true on a 2xx/3xx. Never blocks the node for long.
static bool postJson(const String& body) {
  if (WiFi.status() != WL_CONNECTED || strlen(HUB_ENDPOINT) == 0) return false;
  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  http.begin(HUB_ENDPOINT);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf("[post] %s -> %d\n", HUB_ENDPOINT, code);
  http.end();
  return code >= 200 && code < 400;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  gNodeId = nodeId();
  Serial.println();
  Serial.println("=== Hearth sensor node ===");
  Serial.println("fw " HEARTH_FW_VERSION);
  Serial.println("id " + gNodeId);
#if DHT_PIN >= 0
  dht.begin();
#endif
  // Always announce over serial, even offline.
  Serial.println("DESCRIBE " + describeJson());
  connectWifi();
}

void loop() {
  // Announce ourselves once to the hub as soon as we're online.
  if (!gAnnounced && WiFi.status() == WL_CONNECTED) {
    gAnnounced = postJson(describeJson());
  }

  if (millis() - gLastSample >= SAMPLE_INTERVAL_MS) {
    gLastSample = millis();
    String reading = readingsJson();
    Serial.println("READING " + reading);   // serial is the always-on channel
    postJson(reading);                       // network is opt-in
  }

  delay(20);
}
