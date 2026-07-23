// ESP8266 firmware para HydroControl
// - Endpoints HTTP:
//   GET /sensor        -> JSON { temp, hum, luz, bomba }
//   GET /luz/on        -> enciende la luz
//   GET /luz/off       -> apaga la luz
//   GET /bomba/on      -> enciende la bomba
//   GET /bomba/off     -> apaga la bomba
// - Añade CORS para permitir llamadas desde la web
// - Lee sensor DHT22

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DHT.h>

// --- CONFIGURAR AQUÍ ---
const char* ssid = "TU_SSID";        // reemplaza
const char* password = "TU_PASS";    // reemplaza
// ------------------------

#define RELAY_LUZ 5    // GPIO5 (D1 en NodeMCU)
#define RELAY_BOMBA 4  // GPIO4 (D2 en NodeMCU)
#define DHT_PIN 2      // GPIO2 (D4 en NodeMCU)
#define DHT_TYPE DHT22 // cambiar a DHT11 si usas ese

const bool RELAY_ACTIVE_LOW = true; // true si el módulo relé es activo en LOW

DHT dht(DHT_PIN, DHT_TYPE);
ESP8266WebServer server(80);

bool estadoLuz = false;
bool estadoBomba = false;

// helpers
int relayOnValue() { return RELAY_ACTIVE_LOW ? LOW : HIGH; }
int relayOffValue() { return RELAY_ACTIVE_LOW ? HIGH : LOW; }

void setRelay(int pin, bool on) {
  digitalWrite(pin, on ? relayOnValue() : relayOffValue());
}

void handleCors() {
  // permitir orígenes cruzados (útil para la interfaz web)
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleRoot() {
  handleCors();
  server.send(200, "text/plain", "ESP8266 HydroControl");
}

void handleSensor() {
  handleCors();
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  String tstr = isnan(t) ? "null" : String(t, 1);
  String hstr = isnan(h) ? "null" : String(h, 0);
  String luzStr = estadoLuz ? "ON" : "OFF";
  String bombaStr = estadoBomba ? "ON" : "OFF";
  String json = "{";
  json += "\"temp\":" + tstr + ",";
  json += "\"hum\":" + hstr + ",";
  json += "\"luz\":\"" + luzStr + "\",";
  json += "\"bomba\":\"" + bombaStr + "\"";
  json += "}";
  server.send(200, "application/json", json);
}

void handleLuzOn() {
  handleCors();
  estadoLuz = true;
  setRelay(RELAY_LUZ, true);
  server.send(200, "text/plain", "OK");
}

void handleLuzOff() {
  handleCors();
  estadoLuz = false;
  setRelay(RELAY_LUZ, false);
  server.send(200, "text/plain", "OK");
}

void handleBombaOn() {
  handleCors();
  estadoBomba = true;
  setRelay(RELAY_BOMBA, true);
  server.send(200, "text/plain", "OK");
}

void handleBombaOff() {
  handleCors();
  estadoBomba = false;
  setRelay(RELAY_BOMBA, false);
  server.send(200, "text/plain", "OK");
}

void handleOptions() {
  handleCors();
  server.send(200, "text/plain", "OK");
}

void setup() {
  Serial.begin(115200);
  delay(100);
  pinMode(RELAY_LUZ, OUTPUT);
  pinMode(RELAY_BOMBA, OUTPUT);
  // asegurar estado inicial
  setRelay(RELAY_LUZ, false);
  setRelay(RELAY_BOMBA, false);

  dht.begin();

  WiFi.begin(ssid, password);
  Serial.print("Conectando a WiFi");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500);
    Serial.print('.');
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("Conectado. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("No se conectó a WiFi: conecta SSID/PASS o usa WiFiManager");
  }

  // rutas
  server.on("/", HTTP_GET, handleRoot);
  server.on("/sensor", HTTP_GET, handleSensor);
  server.on("/luz/on", HTTP_GET, handleLuzOn);
  server.on("/luz/off", HTTP_GET, handleLuzOff);
  server.on("/bomba/on", HTTP_GET, handleBombaOn);
  server.on("/bomba/off", HTTP_GET, handleBombaOff);
  server.on("/", HTTP_OPTIONS, handleOptions);
  server.on("/sensor", HTTP_OPTIONS, handleOptions);
  server.on("/luz/on", HTTP_OPTIONS, handleOptions);
  server.on("/luz/off", HTTP_OPTIONS, handleOptions);
  server.on("/bomba/on", HTTP_OPTIONS, handleOptions);
  server.on("/bomba/off", HTTP_OPTIONS, handleOptions);

  server.begin();
  Serial.println("HTTP server iniciado");
}

unsigned long lastDht = 0;
unsigned long dhtPeriod = 5000;

void loop() {
  server.handleClient();
  unsigned long now = millis();
  if (now - lastDht > dhtPeriod) {
    lastDht = now;
    // fuerza lectura para mantener valores frescos si se consulta
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    // imprimir en serie para debug
    if (!isnan(t) && !isnan(h)) {
      Serial.print("Temp: "); Serial.print(t); Serial.print(" C  ");
      Serial.print("Hum:  "); Serial.print(h); Serial.println(" %");
    }
  }
}
