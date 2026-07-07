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
#include <WebServer.h>
#include <DHT.h>
#include "config.h"

#ifndef HEARTH_FW_VERSION
#define HEARTH_FW_VERSION "0.0.0"
#endif

#if DHT_PIN >= 0
DHT dht(DHT_PIN, DHT_TYPE);
#endif

static String   gNodeId;
static bool     gAnnounced  = false;
static uint32_t gLastAnnounce = 0;    // last time we (re)sent our describe
static uint8_t  gFailStreak   = 0;    // consecutive failed POSTs (→ rediscover the hub)
static const uint32_t ANNOUNCE_INTERVAL_MS = 30000;  // re-announce describe every 30s
static const uint8_t  FAIL_REDISCOVER      = 3;      // this many failures → re-browse mDNS

// ── per-sensor cadence ──────────────────────────────────────────────────────
// Each sensor samples on its OWN timer. Intervals start at the compile-time default but
// the hub retunes them at runtime: every ingest POST comes back with the cadences the
// dashboard set for THIS node's sensors, keyed by sensor key, e.g.
//   {"ok":true,"cadences":{"board.temp":1000,"dht.humidity":5000}}
// so a user can speed up one sensor without touching its siblings — no reflash.
enum { S_BOARD_TEMP, S_DHT_TEMP, S_DHT_HUM, S_DIST, S_COUNT };
static const char* const SENSOR_KEYS[S_COUNT] = { "board.temp", "dht.temp", "dht.humidity", "dist.range" };
static uint32_t sInterval[S_COUNT] = { SAMPLE_INTERVAL_MS, SAMPLE_INTERVAL_MS, SAMPLE_INTERVAL_MS, SAMPLE_INTERVAL_MS };
static uint32_t sLast[S_COUNT]     = { 0, 0, 0, 0 };
// A sensor is enabled only if its hardware is configured; unconfigured ones are never sampled.
static const bool sEnabled[S_COUNT] = { true, (DHT_PIN >= 0), (DHT_PIN >= 0), (DIST_TRIG_PIN >= 0) };
static const uint32_t SAMPLE_MIN_MS = 500;    // floor — matches the backend clamp
static const uint32_t SAMPLE_MAX_MS = 60000;  // ceiling — matches the backend clamp
static String   gHubUrl;                 // resolved hub ingest URL (mDNS, or fallback)
static bool     gMdnsUp     = false;
static uint32_t gLastDiscover = 0;

#if ACTUATOR_PIN >= 0
static WebServer gCmdServer(ACTUATOR_PORT); // listens for POST /actuate from the hub
static bool      gActuatorOn = false;
static uint32_t  gActuatorOnSince = 0;      // millis() when it last went ON (for the safety veto)
static bool      gVetoLatched = false;      // true after the veto tripped — ignore "on" until re-armed by "off"
static bool      gCmdServerUp = false;

// Drive the actuator output, honoring the board's active level.
static void setActuator(bool on) {
  if (on && !gActuatorOn) gActuatorOnSince = millis();
  gActuatorOn = on;
  digitalWrite(ACTUATOR_PIN, (on == !!ACTUATOR_ACTIVE_HIGH) ? HIGH : LOW);
  Serial.printf("[actuate] %s -> %s\n", ACTUATOR_KEY, on ? "ON" : "OFF");
}

// POST /actuate  { "actuator":"led", "value":"on"|"off"|true|false }
// A watch firing on the hub calls this. Body parsing is deliberately forgiving. Honors the
// same safety-veto latch as the cloud desired path: an "off" re-arms; an "on" while vetoed is
// ignored, so the veto holds no matter which side issued the command.
static void handleActuate() {
  String body = gCmdServer.arg("plain");
  bool off = body.indexOf("\"off\"") >= 0 || body.indexOf("false") >= 0 ||
             body.indexOf(":0") >= 0 || body.indexOf("\"0\"") >= 0;
  if (off) gVetoLatched = false;
  if (!(!off && gVetoLatched)) setActuator(!off);
  gCmdServer.send(200, "application/json",
                  String("{\"ok\":true,\"") + ACTUATOR_KEY + "\":" + (gActuatorOn ? "true" : "false") + "}");
}

static void startCmdServer() {
  if (gCmdServerUp) return;
  gCmdServer.on("/actuate", HTTP_POST, handleActuate);
  gCmdServer.on("/", HTTP_GET, []() {
    gCmdServer.send(200, "application/json",
                    String("{\"id\":\"") + gNodeId + "\",\"" + ACTUATOR_KEY + "\":" + (gActuatorOn ? "true" : "false") + "}");
  });
  gCmdServer.begin();
  gCmdServerUp = true;
  Serial.printf("[actuate] command server on :%d (POST /actuate)\n", ACTUATOR_PORT);
}
#endif

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

#if DIST_TRIG_PIN >= 0
// HC-SR04: pulse TRIG high 10µs, time the ECHO high pulse, convert to cm using the speed of
// sound (~58µs per round-trip cm). Returns NAN on timeout (out of range / not wired) → null.
static float distanceCm() {
  digitalWrite(DIST_TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(DIST_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(DIST_TRIG_PIN, LOW);
  unsigned long us = pulseIn(DIST_ECHO_PIN, HIGH, 25000UL);  // ~25ms ≈ 4m round-trip
  if (us == 0) return NAN;
  return us / 58.0f;
}
#endif

static bool wifiConfigured() { return strlen(WIFI_SSID) > 0; }

// The self-description: identity + the menu of what this node can sense.
static String describeJson() {
  String s = "{";
  s += "\"type\":\"hearth.node.describe\",";
  s += "\"id\":\"" + gNodeId + "\",";
  s += "\"fw\":\"" HEARTH_FW_VERSION "\",";
  s += "\"board\":\"esp32-wroom-32\",";
  // Where the hub can reach us for actuator commands (empty until Wi-Fi is up).
  if (WiFi.status() == WL_CONNECTED) s += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  s += "\"sensors\":[";
  s += "{\"key\":\"board.temp\",\"kind\":\"temperature\",\"unit\":\"C\",\"wiring\":\"builtin\"}";
#if DHT_PIN >= 0
  s += ",{\"key\":\"dht.temp\",\"kind\":\"temperature\",\"unit\":\"C\",\"pin\":" + String(DHT_PIN) + "}";
  s += ",{\"key\":\"dht.humidity\",\"kind\":\"humidity\",\"unit\":\"pct\",\"pin\":" + String(DHT_PIN) + "}";
#endif
#if DIST_TRIG_PIN >= 0
  s += ",{\"key\":\"dist.range\",\"kind\":\"distance\",\"unit\":\"cm\",\"pin\":" + String(DIST_ECHO_PIN) + "}";
#endif
  s += "]";
#if ACTUATOR_PIN >= 0
  // What this node can DO — the hub POSTs here when a watch fires.
  s += ",\"actuators\":[{\"key\":\"" ACTUATOR_KEY "\",\"kind\":\"switch\",\"port\":" + String(ACTUATOR_PORT) + ",\"path\":\"/actuate\"}]";
#endif
  s += "}";
  return s;
}

static bool postJson(const String& body);   // fwd decl — sampleDue posts; postJson is below

// One sensor's current value as a JSON scalar. Absent/failed sensors report null rather
// than being dropped — a missing value is itself information the hub can reason about.
static String sensorValue(int i) {
  if (i == S_BOARD_TEMP) return String(chipTempC(), 1);
#if DHT_PIN >= 0
  if (i == S_DHT_TEMP) { float t = dht.readTemperature(); return isnan(t) ? String("null") : String(t, 1); }
  if (i == S_DHT_HUM)  { float h = dht.readHumidity();    return isnan(h) ? String("null") : String(h, 1); }
#endif
#if DIST_TRIG_PIN >= 0
  if (i == S_DIST) { float d = distanceCm(); return isnan(d) ? String("null") : String(d, 1); }
#endif
  return String("null");
}

// Sample every sensor whose own interval has elapsed and, if any are due, emit ONE reading
// document carrying just those keys. Partial docs are fine end-to-end: the hub merges them
// into its snapshot and the dashboard patches tiles per key — so each sensor streams at its
// own cadence. Serial always prints; the network POST is opt-in (only once a hub is known).
static void sampleDue() {
  uint32_t now = millis();
  String body = "{\"type\":\"hearth.node.reading\",\"id\":\"" + gNodeId +
                "\",\"uptime_ms\":" + String(now) + ",\"readings\":{";
  bool any = false;
  for (int i = 0; i < S_COUNT; i++) {
    if (!sEnabled[i] || now - sLast[i] < sInterval[i]) continue;
    sLast[i] = now;
    if (any) body += ",";
    body += "\""; body += SENSOR_KEYS[i]; body += "\":"; body += sensorValue(i);
    any = true;
  }
  if (!any) return;
#if ACTUATOR_PIN >= 0
  // Echo the actuator's ACTUAL state (0/1) — the "reported" half of the device shadow, so the
  // cloud can confirm a command landed and graph it. Rides along whenever a sensor is due.
  body += ",\"" ACTUATOR_KEY ".state\":";
  body += (gActuatorOn ? "1" : "0");
#endif
  body += "}}";
  Serial.println("READING " + body);
  postJson(body);
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

// Retune per-sensor intervals from a hub ingest response carrying the node's cadences, e.g.
//   {"ok":true,"cadences":{"board.temp":1000,"dht.humidity":5000}}
// Hand-parsed (no JSON lib) to keep the node's footprint tiny. A sensor absent from the map
// reverts to the compile-time default, so clearing a cadence in the dashboard restores it.
// When the response has no "cadences" field at all we leave every interval untouched.
static void applyCadence(const String& body) {
  if (body.indexOf("\"cadences\"") < 0) return;
  for (int i = 0; i < S_COUNT; i++) {
    if (!sEnabled[i]) continue;
    uint32_t next = SAMPLE_INTERVAL_MS;                 // default unless the map overrides it
    String needle = String("\"") + SENSOR_KEYS[i] + "\"";
    int k = body.indexOf(needle);
    if (k >= 0) {
      int c = body.indexOf(':', k + needle.length());
      if (c >= 0) {
        long ms = strtol(body.c_str() + c + 1, nullptr, 10);
        if (ms > 0) {
          next = (uint32_t)ms;
          if (next < SAMPLE_MIN_MS) next = SAMPLE_MIN_MS;
          if (next > SAMPLE_MAX_MS) next = SAMPLE_MAX_MS;
        }
      }
    }
    if (next != sInterval[i]) {
      Serial.printf("[cadence] %s %u -> %u ms (set from dashboard)\n", SENSOR_KEYS[i], sInterval[i], next);
      sInterval[i] = next;
    }
  }
}

#if ACTUATOR_PIN >= 0
// Converge the actuator to the cloud's desired state, carried on the ingest reply, e.g.
//   {"ok":true,"desired":{"led":"on"}}
// This is the "desired" half of the device shadow: the cloud sets it, we reconcile our output
// to it every ingest (so a reboot re-converges on the next POST). Hand-parsed, no JSON lib.
// A response with no "desired" field, or one that omits our key, leaves the output alone — so a
// node the cloud has never commanded is still free to be driven by a hub-local watch's /actuate.
static void applyDesired(const String& body) {
  int d = body.indexOf("\"desired\"");
  if (d < 0) return;
  String needle = String("\"" ACTUATOR_KEY "\"");   // literal concat: "\"led\""
  int k = body.indexOf(needle, d);
  if (k < 0) return;                      // our actuator isn't mentioned — don't touch it
  int c = body.indexOf(':', k + needle.length());
  if (c < 0) return;
  String rest = body.substring(c + 1);
  rest.trim();
  // Forgiving, mirrors the node's /actuate parser: anything off-ish is off, else on.
  bool wantOn = !(rest.startsWith("\"off\"") || rest.startsWith("false") ||
                  rest.startsWith("0") || rest.startsWith("\"0\""));
  if (!wantOn) gVetoLatched = false;      // an explicit "off" re-arms the safety veto
  if (wantOn && gVetoLatched) return;     // vetoed until re-armed — ignore the desired "on"
  if (wantOn != gActuatorOn) {
    Serial.printf("[desired] cloud → %s %s\n", ACTUATOR_KEY, wantOn ? "on" : "off");
    setActuator(wantOn);
  }
}
#endif

// Best-effort POST to the discovered hub. Returns true on a 2xx/3xx. Also reads the hub's
// response body, which may carry a dashboard-set sample cadence for this node.
static bool postJson(const String& body) {
  if (WiFi.status() != WL_CONNECTED || gHubUrl.length() == 0) return false;
  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  http.begin(gHubUrl);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf("[post] %s -> %d\n", gHubUrl.c_str(), code);
  bool ok = code >= 200 && code < 400;
  if (ok) {
    String resp = http.getString();
    applyCadence(resp);
#if ACTUATOR_PIN >= 0
    applyDesired(resp);   // converge the actuator to the cloud's desired state (device shadow)
#endif
    gFailStreak = 0;
  } else if (++gFailStreak >= FAIL_REDISCOVER) {
    // The hub stopped answering (down, or moved to a new IP) — drop it and re-browse mDNS
    // on the next loop, then re-announce, so we recover without a node reboot.
    Serial.println("[hub] no response — will rediscover");
    gHubUrl = "";
    gAnnounced = false;
    gFailStreak = 0;
  }
  http.end();
  return ok;
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
#if ACTUATOR_PIN >= 0
  pinMode(ACTUATOR_PIN, OUTPUT);
  setActuator(false); // start OFF
#endif
#if DIST_TRIG_PIN >= 0
  pinMode(DIST_TRIG_PIN, OUTPUT);
  pinMode(DIST_ECHO_PIN, INPUT);
  digitalWrite(DIST_TRIG_PIN, LOW);
#endif
  // Always announce over serial, even offline.
  Serial.println("DESCRIBE " + describeJson());
  connectWifi();

  // Find the hub on the LAN with zero config; fall back to a configured URL.
  if (WiFi.status() == WL_CONNECTED) {
    mdnsBegin();
    gHubUrl = queryHub();
#if ACTUATOR_PIN >= 0
    startCmdServer(); // accept actuator commands from the hub
#endif
  }
  if (gHubUrl.length() == 0 && strlen(HUB_ENDPOINT) > 0) {
    gHubUrl = HUB_ENDPOINT;
    Serial.println("[mdns] no hub advertised — using configured HUB_ENDPOINT");
  }
}

void loop() {
#if ACTUATOR_PIN >= 0
  if (gCmdServerUp) gCmdServer.handleClient(); // service any actuator command from the hub
#if ACTUATOR_MAX_ON_MS > 0
  // Node-side safety veto: independent of the cloud. If the output has been ON longer than the
  // limit, force it off and LATCH — a stuck/lost command can't run a motor forever. Requires an
  // explicit "off" (which clears the latch) before it will turn on again.
  if (gActuatorOn && millis() - gActuatorOnSince >= (uint32_t)ACTUATOR_MAX_ON_MS) {
    Serial.println("[actuate] safety veto — max-on time exceeded, forcing OFF (re-arm with an off command)");
    setActuator(false);
    gVetoLatched = true;
  }
#endif
#endif

  const bool online = WiFi.status() == WL_CONNECTED;

  // (Re)discover the hub whenever we don't have one — on boot, or after we lost contact
  // (postJson clears gHubUrl after repeated failures). The node keeps browsing forever.
  if (online && gHubUrl.length() == 0 && millis() - gLastDiscover >= 15000) {
    gLastDiscover = millis();
    gHubUrl = queryHub();
    if (gHubUrl.length() > 0) gAnnounced = false;   // (re)announce to the (re)discovered hub
#if ACTUATOR_PIN >= 0
    startCmdServer(); // Wi-Fi may have come up after boot; ensure the server is live
#endif
  }

  // Announce ourselves on first contact AND periodically thereafter, so a hub that restarted
  // (and forgot us) re-learns our capabilities on its own — no node reboot needed.
  if (online && gHubUrl.length() > 0 &&
      (!gAnnounced || millis() - gLastAnnounce >= ANNOUNCE_INTERVAL_MS)) {
    if (postJson(describeJson())) {
      gAnnounced = true;
      gLastAnnounce = millis();
    }
  }

  sampleDue();   // each sensor emits on its own interval (serial always; network when paired)

  delay(20);
}
