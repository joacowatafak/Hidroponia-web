#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <EEPROM.h>
#include <WiFiUdp.h>
#include <time.h>
#include <sntp.h>

// WiFi
const char* ssid = "Flia Romero";
const char* password = "Frajoafed1377";

// MQTT
const char* mqttHost = "af728765e4064e5780c59ff3b8cb9509.s1.eu.hivemq.cloud";
const int mqttPort = 8883;
const char* mqttUser = "hidroweb";
const char* mqttPassword = "Frajoafed1377";

// Pines
#define PIN_LUZ 5    // D1
#define PIN_BOMBA 4  // D2
#define PIN_DHT 12   // D6 (GPIO12), evita el conflicto con GPIO0/boot
#define DHT_TYPE DHT11

struct AutoConfig {
  bool autoMode;
  char lightsStart[6];
  char lightsEnd[6];
  int humThreshold;
  int pumpOnMinutes;
  int pumpOffMinutes;
  bool valid;
};

DHT dht(PIN_DHT, DHT_TYPE);
WiFiClientSecure espClient;
PubSubClient client(espClient);
ESP8266WebServer server(80);
WiFiUDP ntpUDP;

AutoConfig autoConfig;
bool timeSynced = false;
char currentScheduleTime[6] = "00:00";
unsigned long epochSeconds = 0;
unsigned long lastNtpSync = 0;
unsigned long lastFallbackClockUpdate = 0;
unsigned long lastAutoCheck = 0;
unsigned long lastTelemetria = 0;
unsigned long lastReconnect = 0;
unsigned long lastWiFiReconnect = 0;
unsigned long pumpStartedAt = 0;
bool pumpRunning = false;
unsigned long pumpCycleTickAt = 0;
bool pumpCyclePhaseOn = false;
bool pumpCycleEnabled = false;
unsigned long bootMillis = 0;
unsigned long lastPumpActivation = 0;
const long TZ_OFFSET_SECONDS = -3 * 3600L;
const unsigned long AUTO_CHECK_INTERVAL_MS = 1000;
const unsigned long PUMP_DURATION_MS = 10000;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;
const int FALLBACK_TIME_MAGIC_ADDR = 480;
const int FALLBACK_TIME_VALUE_ADDR = 481;
const byte FALLBACK_TIME_MAGIC = 0xA5;

void resetPumpCycleCounter(bool forcePumpOff) {
  pumpCycleEnabled = false;
  pumpCyclePhaseOn = false;
  pumpCycleTickAt = 0;
  pumpRunning = false;
  pumpStartedAt = millis();

  if (forcePumpOff) {
    digitalWrite(PIN_BOMBA, HIGH);
  }
}

void conectarWiFi() {
  WiFi.mode(WIFI_STA);
  Serial.print("Conectando a WiFi...");
  WiFi.begin(ssid, password);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 20000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi conectado. IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nNo se pudo conectar a WiFi");
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  String mensaje = "";
  for (unsigned int i = 0; i < length; i++) {
    mensaje += (char)payload[i];
  }
  Serial.println("Mensaje recibido [" + String(topic) + "]: " + mensaje);

  String mensajeUpper = mensaje;
  mensajeUpper.toUpperCase();

  if (String(topic) == "hidroponia/config") {
    applyConfigFromEncodedPayload(mensaje);
    runAutoControl();
    return;
  }

  if (String(topic) == "hidroponia/commands/luz") {
    if (autoConfig.autoMode) {
      autoConfig.autoMode = false;
      saveConfig();
      Serial.println("Comando manual luz: modo auto desactivado");
    }
    if (mensajeUpper == "ON") {
      digitalWrite(PIN_LUZ, LOW);
      Serial.println("Luz encendida");
    } else if (mensajeUpper == "OFF") {
      digitalWrite(PIN_LUZ, HIGH);
      Serial.println("Luz apagada");
    }
  }

  if (String(topic) == "hidroponia/commands/bomba") {
    if (autoConfig.autoMode) {
      autoConfig.autoMode = false;
      saveConfig();
      Serial.println("Comando manual bomba: modo auto desactivado");
    }
    if (mensajeUpper == "ON") {
      digitalWrite(PIN_BOMBA, LOW);
      Serial.println("Bomba encendida");
    } else if (mensajeUpper == "OFF") {
      digitalWrite(PIN_BOMBA, HIGH);
      Serial.println("Bomba apagada");
    }
  }
}

void conectarMQTT() {
  espClient.setInsecure();
  client.setServer(mqttHost, mqttPort);
  client.setCallback(callback);

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (client.connected()) {
    return;
  }

  Serial.print("Conectando a MQTT...");
  String clientId = "ESP8266-" + String(random(0xffff), HEX);
  if (client.connect(clientId.c_str(), mqttUser, mqttPassword)) {
    Serial.println("Conectado al broker MQTT");
    client.subscribe("hidroponia/commands/luz");
    client.subscribe("hidroponia/commands/bomba");
    client.subscribe("hidroponia/config");
  } else {
    Serial.println("Error MQTT: " + String(client.state()));
  }
}

void mantenerWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  unsigned long now = millis();
  if (now - lastWiFiReconnect < WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }

  lastWiFiReconnect = now;
  Serial.println("WiFi desconectado, reintentando...");
  WiFi.reconnect();
}

String getCurrentTimeString() {
  if (!timeSynced) {
    return "sin-hora";
  }

  time_t now = time(nullptr);
  struct tm timeInfo;
  localtime_r(&now, &timeInfo);

  char buffer[24];
  snprintf(buffer, sizeof(buffer), "%02d:%02d:%02d",
           timeInfo.tm_hour,
           timeInfo.tm_min,
           timeInfo.tm_sec);
  return String(buffer);
}

String getCurrentTimeForSchedule() {
  if (timeSynced) {
    time_t now = time(nullptr);
    struct tm timeInfo;
    localtime_r(&now, &timeInfo);

    char buffer[6];
    snprintf(buffer, sizeof(buffer), "%02d:%02d", timeInfo.tm_hour, timeInfo.tm_min);
    return String(buffer);
  }

  return String(currentScheduleTime);
}

int parseHour(const String& value) {
  int separator = value.indexOf(':');
  if (separator < 0) return 0;
  return value.substring(0, separator).toInt();
}

int parseMinute(const String& value) {
  int separator = value.indexOf(':');
  if (separator < 0) return 0;
  return value.substring(separator + 1).toInt();
}

bool isTimeInRange(const String& nowTime, const String& startTime, const String& endTime) {
  int nowTotal = parseHour(nowTime) * 60 + parseMinute(nowTime);
  int startTotal = parseHour(startTime) * 60 + parseMinute(startTime);
  int endTotal = parseHour(endTime) * 60 + parseMinute(endTime);

  if (startTotal == endTotal) {
    return true;
  }

  if (startTotal <= endTotal) {
    return nowTotal >= startTotal && nowTotal < endTotal;
  }
  return nowTotal >= startTotal || nowTotal < endTotal;
}

void saveFallbackScheduleTimeToEeprom() {
  EEPROM.write(FALLBACK_TIME_MAGIC_ADDR, FALLBACK_TIME_MAGIC);
  for (int i = 0; i < 6; i++) {
    EEPROM.write(FALLBACK_TIME_VALUE_ADDR + i, currentScheduleTime[i]);
  }
  EEPROM.commit();
}

void loadFallbackScheduleTimeFromEeprom() {
  byte magic = EEPROM.read(FALLBACK_TIME_MAGIC_ADDR);
  if (magic != FALLBACK_TIME_MAGIC) {
    return;
  }

  char loaded[6];
  for (int i = 0; i < 6; i++) {
    loaded[i] = static_cast<char>(EEPROM.read(FALLBACK_TIME_VALUE_ADDR + i));
  }
  loaded[5] = '\0';

  String timeValue = String(loaded);
  timeValue.trim();
  int separator = timeValue.indexOf(':');
  if (separator < 0) return;

  int hours = timeValue.substring(0, separator).toInt();
  int minutes = timeValue.substring(separator + 1).toInt();
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return;

  snprintf(currentScheduleTime, sizeof(currentScheduleTime), "%02d:%02d", hours, minutes);
  Serial.println("Hora fallback recuperada de EEPROM: " + String(currentScheduleTime));
}

void updateFallbackScheduleTimeFromString(const String& value) {
  String timeValue = value;
  timeValue.trim();
  int separator = timeValue.indexOf(':');
  if (separator < 0) return;

  int hours = timeValue.substring(0, separator).toInt();
  int minutes = timeValue.substring(separator + 1).toInt();
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return;

  snprintf(currentScheduleTime, sizeof(currentScheduleTime), "%02d:%02d", hours, minutes);
  saveFallbackScheduleTimeToEeprom();
}

void advanceFallbackScheduleTime() {
  int hours = parseHour(String(currentScheduleTime));
  int minutes = parseMinute(String(currentScheduleTime));
  minutes += 1;
  if (minutes >= 60) {
    minutes = 0;
    hours += 1;
    if (hours >= 24) {
      hours = 0;
    }
  }
  snprintf(currentScheduleTime, sizeof(currentScheduleTime), "%02d:%02d", hours, minutes);
}

void setDefaultAutoConfig() {
  autoConfig.autoMode = false;
  strncpy(autoConfig.lightsStart, "08:00", sizeof(autoConfig.lightsStart));
  strncpy(autoConfig.lightsEnd, "20:00", sizeof(autoConfig.lightsEnd));
  autoConfig.humThreshold = 60;
  autoConfig.pumpOnMinutes = 2;
  autoConfig.pumpOffMinutes = 10;
  autoConfig.valid = true;
}

String urlDecode(const String& value) {
  String decoded = "";
  decoded.reserve(value.length());

  for (unsigned int i = 0; i < value.length(); i++) {
    char c = value[i];
    if (c == '+') {
      decoded += ' ';
      continue;
    }

    if (c == '%' && (i + 2) < value.length()) {
      char hi = value[i + 1];
      char lo = value[i + 2];
      char hex[3] = { hi, lo, '\0' };
      int ascii = strtol(hex, nullptr, 16);
      decoded += static_cast<char>(ascii);
      i += 2;
      continue;
    }

    decoded += c;
  }

  return decoded;
}

bool payloadHasKey(const String& payload, const String& key) {
  return payload.indexOf(key + "=") >= 0;
}

String payloadGetValue(const String& payload, const String& key) {
  int keyIndex = payload.indexOf(key + "=");
  if (keyIndex < 0) return "";

  int start = keyIndex + key.length() + 1;
  int end = payload.indexOf('&', start);
  if (end < 0) end = payload.length();
  return urlDecode(payload.substring(start, end));
}

void applyConfigFromEncodedPayload(const String& payload) {
  bool previousAutoMode = autoConfig.autoMode;
  int previousPumpOnMinutes = autoConfig.pumpOnMinutes;
  int previousPumpOffMinutes = autoConfig.pumpOffMinutes;

  if (payloadHasKey(payload, "resetAuto")) {
    String resetValue = payloadGetValue(payload, "resetAuto");
    if (resetValue == "1" || resetValue.equalsIgnoreCase("true")) {
      setDefaultAutoConfig();
      if (payloadHasKey(payload, "currentTime")) {
        updateFallbackScheduleTimeFromString(payloadGetValue(payload, "currentTime"));
      }
      saveConfig();
      resetPumpCycleCounter(true);
      Serial.println("Configuracion automatica limpiada (MQTT)");
      return;
    }
  }

  if (payloadHasKey(payload, "mode")) {
    String modeValue = payloadGetValue(payload, "mode");
    autoConfig.autoMode = modeValue == "1" || modeValue.equalsIgnoreCase("true");
  }

  if (payloadHasKey(payload, "lightsStart")) {
    String startValue = payloadGetValue(payload, "lightsStart");
    startValue.trim();
    if (startValue.length() > 0) {
      startValue.toCharArray(autoConfig.lightsStart, sizeof(autoConfig.lightsStart));
    }
  }

  if (payloadHasKey(payload, "lightsEnd")) {
    String endValue = payloadGetValue(payload, "lightsEnd");
    endValue.trim();
    if (endValue.length() > 0) {
      endValue.toCharArray(autoConfig.lightsEnd, sizeof(autoConfig.lightsEnd));
    }
  }

  if (payloadHasKey(payload, "humThreshold")) {
    autoConfig.humThreshold = payloadGetValue(payload, "humThreshold").toInt();
  }

  if (payloadHasKey(payload, "pumpOnMinutes")) {
    autoConfig.pumpOnMinutes = payloadGetValue(payload, "pumpOnMinutes").toInt();
  }

  if (payloadHasKey(payload, "pumpOffMinutes")) {
    autoConfig.pumpOffMinutes = payloadGetValue(payload, "pumpOffMinutes").toInt();
  }

  if (payloadHasKey(payload, "currentTime")) {
    updateFallbackScheduleTimeFromString(payloadGetValue(payload, "currentTime"));
  }

  if (autoConfig.pumpOnMinutes < 1) autoConfig.pumpOnMinutes = 2;
  if (autoConfig.pumpOffMinutes < 1) autoConfig.pumpOffMinutes = 10;
  autoConfig.valid = true;
  saveConfig();

  bool modeChanged = previousAutoMode != autoConfig.autoMode;
  bool pumpTimingChanged = previousPumpOnMinutes != autoConfig.pumpOnMinutes || previousPumpOffMinutes != autoConfig.pumpOffMinutes;

  if (!autoConfig.autoMode) {
    if (modeChanged) {
      resetPumpCycleCounter(false);
    }
    if (previousAutoMode) {
      Serial.println("Auto desactivado: se conserva estado manual de luces y bomba");
    }
  } else {
    if (!previousAutoMode || pumpTimingChanged) {
      resetPumpCycleCounter(true);
      Serial.println("Auto activado: bomba en espera hasta completar el ciclo inicial");
    }
  }

  Serial.println("Config MQTT recibida: modo=" + String(autoConfig.autoMode) + " luces=" + String(autoConfig.lightsStart) + "-" + String(autoConfig.lightsEnd) + " umbral=" + String(autoConfig.humThreshold) + " bombaOn=" + String(autoConfig.pumpOnMinutes) + " bombaOff=" + String(autoConfig.pumpOffMinutes));
}

void loadConfig() {
  EEPROM.begin(512);
  EEPROM.get(0, autoConfig);
  if (!autoConfig.valid) {
    setDefaultAutoConfig();
    saveConfig();
  }

  loadFallbackScheduleTimeFromEeprom();
}

void saveConfig() {
  EEPROM.put(0, autoConfig);
  EEPROM.commit();
}

void applyConfigFromRequest() {
  bool previousAutoMode = autoConfig.autoMode;
  int previousPumpOnMinutes = autoConfig.pumpOnMinutes;
  int previousPumpOffMinutes = autoConfig.pumpOffMinutes;

  if (server.hasArg("resetAuto") && (server.arg("resetAuto") == "1" || server.arg("resetAuto").equalsIgnoreCase("true"))) {
    setDefaultAutoConfig();
    if (server.hasArg("currentTime")) {
      updateFallbackScheduleTimeFromString(server.arg("currentTime"));
    }
    saveConfig();
    resetPumpCycleCounter(true);
    Serial.println("Configuracion automatica limpiada");
    return;
  }

  if (server.hasArg("mode")) {
    autoConfig.autoMode = server.arg("mode") == "1" || server.arg("mode").equalsIgnoreCase("true");
  }
  if (server.hasArg("lightsStart")) {
    String startValue = server.arg("lightsStart");
    startValue.trim();
    if (startValue.length() > 0) {
      startValue.toCharArray(autoConfig.lightsStart, sizeof(autoConfig.lightsStart));
    }
  }
  if (server.hasArg("lightsEnd")) {
    String endValue = server.arg("lightsEnd");
    endValue.trim();
    if (endValue.length() > 0) {
      endValue.toCharArray(autoConfig.lightsEnd, sizeof(autoConfig.lightsEnd));
    }
  }
  if (server.hasArg("humThreshold")) {
    autoConfig.humThreshold = server.arg("humThreshold").toInt();
  }
  if (server.hasArg("pumpOnMinutes")) {
    autoConfig.pumpOnMinutes = server.arg("pumpOnMinutes").toInt();
  }
  if (server.hasArg("pumpOffMinutes")) {
    autoConfig.pumpOffMinutes = server.arg("pumpOffMinutes").toInt();
  }
  if (server.hasArg("currentTime")) {
    updateFallbackScheduleTimeFromString(server.arg("currentTime"));
  }
  if (autoConfig.pumpOnMinutes < 1) autoConfig.pumpOnMinutes = 2;
  if (autoConfig.pumpOffMinutes < 1) autoConfig.pumpOffMinutes = 10;
  autoConfig.valid = true;
  saveConfig();

  bool modeChanged = previousAutoMode != autoConfig.autoMode;
  bool pumpTimingChanged = previousPumpOnMinutes != autoConfig.pumpOnMinutes || previousPumpOffMinutes != autoConfig.pumpOffMinutes;

  if (!autoConfig.autoMode) {
    if (modeChanged) {
      resetPumpCycleCounter(false);
    }
    if (previousAutoMode) {
      Serial.println("Auto desactivado: se conserva estado manual de luces y bomba");
    }
  } else {
    if (!previousAutoMode || pumpTimingChanged) {
      resetPumpCycleCounter(true);
      Serial.println("Auto activado: bomba en espera hasta completar el ciclo inicial");
    }
  }

  Serial.println("Config recibida: modo=" + String(autoConfig.autoMode) + " luces=" + String(autoConfig.lightsStart) + "-" + String(autoConfig.lightsEnd) + " umbral=" + String(autoConfig.humThreshold) + " bombaOn=" + String(autoConfig.pumpOnMinutes) + " bombaOff=" + String(autoConfig.pumpOffMinutes));
}

void handleCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void applyManualDeviceCommand(int pin, bool turnOn, const char* deviceLabel) {
  if (autoConfig.autoMode) {
    autoConfig.autoMode = false;
    saveConfig();
    Serial.println(String("Comando manual ") + deviceLabel + ": modo auto desactivado");
  }

  digitalWrite(pin, turnOn ? LOW : HIGH);

  if (pin == PIN_BOMBA) {
    resetPumpCycleCounter(false);
  }

  Serial.println(String(deviceLabel) + (turnOn ? " encendida" : " apagada"));
}

void handleLuzOn() {
  handleCors();
  applyManualDeviceCommand(PIN_LUZ, true, "Luz");
  server.send(200, "application/json", "{\"ok\":true,\"luz\":\"ON\"}");
}

void handleLuzOff() {
  handleCors();
  applyManualDeviceCommand(PIN_LUZ, false, "Luz");
  server.send(200, "application/json", "{\"ok\":true,\"luz\":\"OFF\"}");
}

void handleBombaOn() {
  handleCors();
  applyManualDeviceCommand(PIN_BOMBA, true, "Bomba");
  server.send(200, "application/json", "{\"ok\":true,\"bomba\":\"ON\"}");
}

void handleBombaOff() {
  handleCors();
  applyManualDeviceCommand(PIN_BOMBA, false, "Bomba");
  server.send(200, "application/json", "{\"ok\":true,\"bomba\":\"OFF\"}");
}

void handleConfig() {
  Serial.println("GET/POST /config recibido");
  handleCors();
  applyConfigFromRequest();
  runAutoControl();
  String payload = "{\"ok\":true,\"serverTime\":\"" + getCurrentTimeString() + "\"}";
  server.send(200, "application/json", payload);
}

void handleStatus() {
  handleCors();
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  String tempStr = isnan(temp) ? "null" : String(temp, 1);
  String humStr = isnan(hum) ? "null" : String(hum, 1);
  String payload = "{\"temp\":" + tempStr +
                   ",\"hum\":" + humStr +
                   ",\"luz\":\"" + (digitalRead(PIN_LUZ) == LOW ? "ON" : "OFF") + "\"" +
                   ",\"bomba\":\"" + (digitalRead(PIN_BOMBA) == LOW ? "ON" : "OFF") + "\"" +
                   ",\"autoMode\":" + (autoConfig.autoMode ? "true" : "false") +
                   ",\"lightsStart\":\"" + String(autoConfig.lightsStart) + "\"" +
                   ",\"lightsEnd\":\"" + String(autoConfig.lightsEnd) + "\"" +
                   ",\"humThreshold\":" + String(autoConfig.humThreshold) +
                   ",\"pumpOnMinutes\":" + String(autoConfig.pumpOnMinutes) +
                   ",\"pumpOffMinutes\":" + String(autoConfig.pumpOffMinutes) +
                   ",\"serverTime\":\"" + getCurrentTimeString() + "\"}";
  server.send(200, "application/json", payload);
}

void handleTime() {
  handleCors();
  String payload = "{\"serverTime\":\"" + getCurrentTimeString() + "\"}";
  server.send(200, "application/json", payload);
}

unsigned long sendNTPpacket(IPAddress& address) {
  byte packetBuffer[48] = {0};
  packetBuffer[0] = 0b11100011;
  packetBuffer[1] = 0;
  packetBuffer[2] = 6;
  packetBuffer[3] = 0xEC;
  packetBuffer[4] = 0x31;
  packetBuffer[5] = 0xA3;
  packetBuffer[6] = 0;
  packetBuffer[7] = 0;
  packetBuffer[8] = 0;
  packetBuffer[9] = 0;
  packetBuffer[10] = 0xA3;
  packetBuffer[11] = 0x4E;
  packetBuffer[12] = 0x4E;
  packetBuffer[13] = 0x54;
  packetBuffer[14] = 0x50;
  packetBuffer[15] = 0x48;
  ntpUDP.beginPacket(address, 123);
  ntpUDP.write(packetBuffer, 48);
  ntpUDP.endPacket();
  return 0;
}

void syncTimeFromNtp() {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.println("Sincronizando hora NTP...");
  configTime(TZ_OFFSET_SECONDS, 0, "pool.ntp.org", "time.nist.gov");

  unsigned long start = millis();
  while (millis() - start < 10000) {
    time_t now = time(nullptr);
    if (now > 1000000000L) {
      timeSynced = true;
      Serial.println("Hora NTP sincronizada");
      return;
    }
    delay(200);
  }

  timeSynced = false;
  Serial.println("No se pudo sincronizar la hora NTP, usando hora local");
}

void runAutoControl() {
  if (!autoConfig.autoMode) {
    resetPumpCycleCounter(false);
    return;
  }

  bool lightsAreOn = digitalRead(PIN_LUZ) == LOW;

  String nowTime = getCurrentTimeForSchedule();
  bool shouldLightsBeOn = false;

  if (nowTime.length() > 0) {
    shouldLightsBeOn = isTimeInRange(nowTime, String(autoConfig.lightsStart), String(autoConfig.lightsEnd));
  }

  if (shouldLightsBeOn && !lightsAreOn) {
    digitalWrite(PIN_LUZ, LOW);
    Serial.println("Auto: luces ON");
  } else if (!shouldLightsBeOn && lightsAreOn) {
    digitalWrite(PIN_LUZ, HIGH);
    Serial.println("Auto: luces OFF");
  }

  unsigned long now = millis();
  unsigned long pumpOnMs = max(1, autoConfig.pumpOnMinutes) * 60UL * 1000UL;
  unsigned long pumpOffMs = max(1, autoConfig.pumpOffMinutes) * 60UL * 1000UL;

  if (!pumpCycleEnabled) {
    pumpCycleEnabled = true;
    pumpCyclePhaseOn = false;
    pumpCycleTickAt = now;
    if (digitalRead(PIN_BOMBA) == LOW) {
      digitalWrite(PIN_BOMBA, HIGH);
    }
    Serial.println("Auto: ciclo bomba iniciado (fase OFF)");
    return;
  }

  if (pumpCyclePhaseOn) {
    if (now - pumpCycleTickAt >= pumpOnMs) {
      digitalWrite(PIN_BOMBA, HIGH);
      pumpCyclePhaseOn = false;
      pumpCycleTickAt = now;
      pumpRunning = false;
      pumpStartedAt = now;
      Serial.println("Auto: bomba OFF");
    }
  } else {
    if (now - pumpCycleTickAt >= pumpOffMs) {
      digitalWrite(PIN_BOMBA, LOW);
      pumpCyclePhaseOn = true;
      pumpCycleTickAt = now;
      pumpRunning = true;
      pumpStartedAt = now;
      Serial.println("Auto: bomba ON");
    }
  }
}

void publicarTelemetria() {
  if (!client.connected()) {
    return;
  }

  float temp = dht.readTemperature();
  float hum = dht.readHumidity();

  if (isnan(temp) || isnan(hum)) {
    Serial.println("Error leyendo DHT");
    return;
  }

  String payload = "{\"temp\":" + String(temp, 1) +
                   ",\"hum\":" + String(hum, 1) +
                   ",\"luz\":\"" + (digitalRead(PIN_LUZ) == LOW ? "ON" : "OFF") + "\"" +
                   ",\"bomba\":\"" + (digitalRead(PIN_BOMBA) == LOW ? "ON" : "OFF") + "\"" +
                   ",\"autoMode\":" + (autoConfig.autoMode ? "true" : "false") +
                   ",\"lightsStart\":\"" + String(autoConfig.lightsStart) + "\"" +
                   ",\"lightsEnd\":\"" + String(autoConfig.lightsEnd) + "\"" +
                   ",\"humThreshold\":" + String(autoConfig.humThreshold) +
                   ",\"pumpOnMinutes\":" + String(autoConfig.pumpOnMinutes) +
                   ",\"pumpOffMinutes\":" + String(autoConfig.pumpOffMinutes) +
                   "}";

  client.publish("hidroponia/telemetry", payload.c_str());
  Serial.println("Telemetria: " + payload);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("Boot ESP8266");
  pinMode(PIN_LUZ, OUTPUT);
  pinMode(PIN_BOMBA, OUTPUT);
  pinMode(PIN_DHT, INPUT);
  digitalWrite(PIN_LUZ, HIGH);
  resetPumpCycleCounter(true);

  Serial.println("Inicializando DHT...");
  dht.begin();
  loadConfig();
  conectarWiFi();
  syncTimeFromNtp();
  bootMillis = millis();

  client.setKeepAlive(60);
  client.setSocketTimeout(60);
  conectarMQTT();

  server.on("/config", HTTP_GET, handleConfig);
  server.on("/config", HTTP_POST, handleConfig);
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/time", HTTP_GET, handleTime);
  server.on("/luz/on", HTTP_GET, handleLuzOn);
  server.on("/luz/off", HTTP_GET, handleLuzOff);
  server.on("/bomba/on", HTTP_GET, handleBombaOn);
  server.on("/bomba/off", HTTP_GET, handleBombaOff);
  server.begin();

  Serial.println("Endpoints activos: /status /time /config");
}

void loop() {
  server.handleClient();

  mantenerWiFi();

  if (WiFi.status() == WL_CONNECTED && !client.connected()) {
    unsigned long now = millis();
    if (now - lastReconnect > 5000) {
      lastReconnect = now;
      conectarMQTT();
    }
  }

  if (client.connected()) {
    client.loop();
  }

  if (millis() - lastAutoCheck > AUTO_CHECK_INTERVAL_MS) {
    lastAutoCheck = millis();
    runAutoControl();
  }

  if (!timeSynced && millis() - lastFallbackClockUpdate > 60000) {
    lastFallbackClockUpdate = millis();
    advanceFallbackScheduleTime();
  }

  if (millis() - lastTelemetria > 10000) {
    lastTelemetria = millis();
    publicarTelemetria();
  }
}