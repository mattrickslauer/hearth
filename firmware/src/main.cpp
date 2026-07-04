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
#include <ESPmDNS.h>
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
static String   gHubUrl;                 // resolved hub ingest URL (mDNS, or fallback)
static bool     gMdnsUp     = false;
static uint32_t gLastDiscover = 0;

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

// Best-effort POST to the discovered hub. Returns true on a 2xx/3xx.
static bool postJson(const String& body) {
  if (WiFi.status() != WL_CONNECTED || gHubUrl.length() == 0) return false;
  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  http.begin(gHubUrl);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf("[post] %s -> %d\n", gHubUrl.c_str(), code);
  http.end();
  return code >= 200 && code < 400;
}

// ─── hub discovery (mDNS / DNS-SD) ─────────────────────────────────────────
// The hub advertises itself as _hearth._tcp on the LAN; the node browses for it,
// so you never tell a node the hub's address. Falls back to a configured
// HUB_ENDPOINT if nothing is advertised (empty config = serial-only).
static void mdnsBegin() {
  if (gMdnsUp) return;
  if (MDNS.begin("hearth-node")) gMdnsUp = true;
  else Serial.println("[mdns] responder failed to start");
}

// The hub's ingest URL if one is on the LAN right now, else "".
static String queryHub() {
  if (!gMdnsUp) return "";
  int n = MDNS.queryService("hearth", "tcp");   // _hearth._tcp
  if (n <= 0) return "";
  String url = "http://" + MDNS.IP(0).toString() + ":" + String(MDNS.port(0)) + "/ingest";
  Serial.printf("[mdns] discovered hub at %s\n", url.c_str());
  return url;
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

  // Find the hub on the LAN with zero config; fall back to a configured URL.
  if (WiFi.status() == WL_CONNECTED) {
    mdnsBegin();
    gHubUrl = queryHub();
  }
  if (gHubUrl.length() == 0 && strlen(HUB_ENDPOINT) > 0) {
    gHubUrl = HUB_ENDPOINT;
    Serial.println("[mdns] no hub advertised — using configured HUB_ENDPOINT");
  }
}

void loop() {
  // Keep browsing until we know a hub — it may come online after the node does.
  if (WiFi.status() == WL_CONNECTED && gHubUrl.length() == 0 &&
      millis() - gLastDiscover >= 15000) {
    gLastDiscover = millis();
    gHubUrl = queryHub();
    if (gHubUrl.length() > 0) gAnnounced = false;   // announce to the new hub
  }

  // Announce ourselves once, as soon as we can reach a hub.
  if (!gAnnounced && gHubUrl.length() > 0 && WiFi.status() == WL_CONNECTED) {
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
