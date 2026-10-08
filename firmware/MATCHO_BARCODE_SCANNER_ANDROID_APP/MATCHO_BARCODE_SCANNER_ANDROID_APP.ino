#include <WebServer.h>
#include <ESPmDNS.h>
#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <TFT_eSPI.h>
#include <SPI.h>
#include <ArduinoJson.h>
#include <Adafruit_MAX31865.h>
#include <EEPROM.h>
#include <Ticker.h>
#include "logo.h"
#include "wifi_logo.h"
#include "keypad.h"
#include "cal.h"
#include "card1.h"
#include "miss.h"
#include "scan_ble.h"
#include "scaned_ble.h"
#include "conn_ble.h"
#include "tank.h"
#include "can.h"
#include "ok.h"
#include "esp_task_wdt.h"
#include "BluetoothSerial.h"

// ---------------- BLE: configuration + firmware OTA ----------------
// BLE is the ONLY provisioning path (WiFi/scanner-MAC/offset config).
//
// There are now THREE firmware update transports:
//   1. LAN OTA (ArduinoOTA, see setupArduinoOTA()) — the classic
//      "Arduino IDE flashes over WiFi by IP address" path (also usable
//      with the espota.py tool or any ArduinoOTA-compatible pusher).
//      The IDE/tool talks directly to this device's local IP; nothing
//      is fetched from any cloud/HTTP server. This is what people
//      normally mean by "network OTA" for Arduino boards, and it runs
//      automatically in the background whenever WiFi is connected —
//      no app interaction needed.
//   2. Cloud/HTTP OTA (see performNetworkOTA()) — used with PRIORITY by
//      the Android app's FW_START command whenever it supplies a
//      firmware "url" and WiFi is connected. The device pulls the .bin
//      itself over HTTP from that URL.
//   3. BLE chunked OTA (below) — the automatic app-side fallback for
//      whenever WiFi isn't available.
// The old SPIFFS-backed captive-portal WebServer has been removed.
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <ArduinoOTA.h>
// ---------------------------------------------------------------------

#define TFT_RGB_ORDER TFT_BGR

// Default Arduino loop-task stack on ESP32 is only 8KB. Running Classic
// Bluetooth (SerialBT) and BLE (BLEDevice) at the same time, plus TFT,
// WiFi and ArduinoJson allocations, can get tight. This must be a
// top-level statement (not inside a function) and must come before
// setup()/loop() are defined.
SET_LOOP_TASK_STACK_SIZE(16 * 1024);

Ticker heaterTicker;

#define EEPROM_SIZE 512

// -----------------------------------------------------------
// Persistent configuration layout in EEPROM.
// Replaces the old SPIFFS /config.json file entirely — WiFi
// credentials, the paired scanner's Bluetooth MAC, and the
// temperature calibration offset all live here now, and are
// only ever written via a BLE command (SAVE_BT_MAC / SET_OFFSET
// / PROVISION) or the on-screen calibration page.
// -----------------------------------------------------------
#define EEPROM_MAGIC_ADDR      0
#define EEPROM_SSID_ADDR       8
#define EEPROM_SSID_LEN        96
#define EEPROM_PASS_ADDR       (EEPROM_SSID_ADDR + EEPROM_SSID_LEN)
#define EEPROM_PASS_LEN        96
#define EEPROM_BT_ADDR         (EEPROM_PASS_ADDR + EEPROM_PASS_LEN)
#define EEPROM_BT_LEN          24
#define EEPROM_OFFSET_ADDR     (EEPROM_BT_ADDR + EEPROM_BT_LEN)
#define EEPROM_OTA_ADDR         400
#define EEPROM_OTA_MAGIC        0x4F544131UL  // "OTA1"
#define EEPROM_OTA_VERSION_LEN  24
#define EEPROM_OTA_STATUS_LEN   16
#define EEPROM_OTA_TARGET_ADDR  (EEPROM_OTA_ADDR + 4)
#define EEPROM_OTA_VERSION_ADDR (EEPROM_OTA_TARGET_ADDR + 4)
#define EEPROM_OTA_STATUS_ADDR  (EEPROM_OTA_VERSION_ADDR + EEPROM_OTA_VERSION_LEN)
#define EEPROM_MAGIC            0x4D4F4331UL  // "MOC1"

#define RED2RED 0
#define GREEN2GREEN 1
#define BLUE2BLUE 2
#define BLUE2RED 3
#define GREEN2RED 4
#define RED2GREEN 5
#define BLACK2BLACK 8

#define TFT_GREY 0x2104 // Dark grey 16 bit colour
#define HEATER_PIN 5

TFT_eSPI tft = TFT_eSPI(240, 320);

WiFiClient client;
HTTPClient http;

WebServer httpServer(80);
bool httpStarted = false;
volatile bool scannerReconnectPending = false;   // set by GET /scanner_handback, served in loop()
volatile bool scannerHeldByScreen = false;       // the Android screen took the scanner (GET /scanner_take): no auto take-back
volatile bool scannerConnecting = false;         // a Bluetooth connect to the scanner is running (own task)
volatile uint8_t scannerLastResult = 0;          // 0 = no try yet, 1 = last connect ok, 2 = last connect failed
unsigned long scannerModeStep2At = 0;            // "Match-O mode": the 2nd command (AT+MODE=1) is sent at this millis()
unsigned long btSearchUntil = 0;                 // GET /scanner_scan: the Bluetooth search runs until this millis()

// Temperature offset from the app (GET /offset). 1 = the app must send the password
// (then set OFFSET_NEEDS_PASSWORD = true in the app as well).
#define OFFSET_NEEDS_PASSWORD 0
#define OFFSET_PASSWORD "2325"                   // the same code as the calibration keypad on the TFT

// ---------------- MAX31856 PINS ----------------
#define MAX31856_CS   14
#define MAX31856_MOSI 23
#define MAX31856_MISO 19
#define MAX31856_SCK  18
#define TFT_CS     15

#define RXD2 26
#define TXD2 25

SPIClass *vspi = nullptr;
Adafruit_MAX31865 *maxthermo = nullptr;

const char* serverName = "http://www.apssensors.com/api.php";
String deviceID = ""; String lastFive = "";
unsigned long previousNetworkCheckMillis = 0;
const unsigned long networkCheckInterval = 30000; // 30 second interval

// Config variables (loaded from / saved to EEPROM)
String ssid = "";
String password = "";
String btMacString = "";
bool isAPMode = false;

// TFT Display tracking
String displayMaleName = "";
String displayFemaleName = "";
String displayMatchedCol = "";

String expectedTank = "";
String expectedCanister = "";
String expectedGoblet = "";
bool localMatchMode = false;

// Global variables for RFID Witnessing system
int witnessState = 0;             // Tracks: 0=Idle, 1=Got Tag1, 2=Processing
String rfid_1_val = "";           // Stores first tag ID
String rfid_2_val = "";           // Stores second tag ID
unsigned long witnessTimerStart = 0; // Stores the time when API results arrived
bool showWitnessResults = false;  // Controls if the 15s timer should run
String barcode = "";
String lastScannedBarcode = "";
unsigned long barcodeDisplayTimer = 0;
int y = 0; int z = 0; int z1 = 0; int z2 = 0; int z3 = 0;
float pv = 0.0;
float temperature;
int page = 0; float rawTemp = 0.0; float filteredTemp = 0.0;
bool firstReading = true;
uint16_t calData[5] = {300, 3700, 400, 3600, 1};
float tmpp = 0.0;
char inputBuffer[5] = ""; // Buffer to store 4-digit input
int inputIndex = 0;       // Index to track input position
int checked = 0;

BluetoothSerial SerialBT;
uint8_t scannerAddress[] = {0xDC, 0x0D, 0x30, 0x3E, 0x07, 0x38};
bool scannerConnected = false;
unsigned long lastReconnect = 0;
bool patientScanArmed = false;

// ---------------- Scanner battery status ----------------
// The NT-1228BC reports its battery level as ordinary "scanned" text -
// e.g. "BAT_VOL=3.98V 84%" - when the "Battery Information" command
// barcode from its manual is scanned with the scanner's own trigger.
// We intercept that line here instead of treating it as a normal
// patient/sample barcode, and cache the parsed values so they can be
// reported to the app over BLE (GET_DATA/STATUS).
float scannerBatteryVoltage = -1.0;   // -1 = unknown / never reported
int scannerBatteryPercent = -1;       // -1 = unknown / never reported
unsigned long scannerBatteryUpdatedAt = 0;
unsigned long scannerBatteryRequestedAt = 0; // 0 = no request outstanding

// ---------------- BLE service / characteristic ----------------
#define BLE_SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define BLE_CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLECharacteristic *pCharacteristic = nullptr;
BLEServer *pBleServer = nullptr;
bool bleDeviceConnected = false;
bool bleAdvertisingActive = false;

// BLE firmware update state
bool bleFirmwareUpdating = false;
size_t bleFirmwareExpected = 0;
size_t bleFirmwareReceived = 0;
uint32_t bleFirmwareNextSeq = 0;

// ---------------- Network (WiFi/HTTP) OTA state ----------------
// Network OTA is the PRIORITY update path: whenever the app supplies a
// firmware "url" and the device currently has WiFi, the firmware is
// pulled and flashed straight over HTTP instead of being chunked over
// BLE. BLE OTA (FW_START/packet queue/FW_END above) is kept as the
// automatic fallback for whenever WiFi isn't available. Both paths
// share the same TFT "update in progress" UI (see currentOtaSource,
// drawOTAStartScreen(), drawBLEOtaProgress()) and the same FW_ABORT
// command.
volatile bool netFirmwareUpdating = false;
String currentOtaSource = "Bluetooth"; // "Bluetooth", "Network" (cloud/HTTP), or "LAN" (ArduinoOTA) — drives OTA UI label

// ---------------- LAN (ArduinoOTA / Arduino IDE) OTA state ----------------
// True once ArduinoOTA.begin() has been called (WiFi station mode only —
// not started in AP/BLE-config mode). loop() only calls ArduinoOTA.handle()
// when this is true AND no other OTA transfer is already in progress, so
// two update paths can never write to flash at the same time.
bool arduinoOtaActive = false;
volatile bool arduinoOtaInProgress = false;

// OTA is fully deferred out of BLE callback context.
#define OTA_PACKET_MAX 244
#define OTA_QUEUE_DEPTH 8
static uint8_t otaPacketQueue[OTA_QUEUE_DEPTH][OTA_PACKET_MAX];
static size_t otaPacketLengths[OTA_QUEUE_DEPTH] = {0};
volatile uint8_t otaQueueHead = 0;
volatile uint8_t otaQueueTail = 0;
volatile uint8_t otaQueueCount = 0;
volatile bool otaQueueOverflow = false;
portMUX_TYPE otaQueueMux = portMUX_INITIALIZER_UNLOCKED;

volatile bool otaStartPending = false;
volatile bool otaEndRequested = false;
volatile bool otaAbortRequested = false;
char otaStartJson[256] = {0};
String otaTargetVersion = "";

#define MATCHO_FW_VERSION "1.0.1"

// The barcode scanner is NOT connected at power-on. It connects when the scanner icon on the TFT (home page) is touched.
// 0 = only when the icon is touched        1 = also automatically at power-on (the old behaviour)
#define SCANNER_CONNECT_AT_BOOT 0
#define OTA_WDT_TIMEOUT_S 120

// ============================================================
// Icon helpers — all bitmaps are compiled-in header arrays
// (logo.h, scan_ble.h, etc.). No SPIFFS is used anywhere in
// this firmware any more, for images or for config storage.
// ============================================================
#define ICON_SCAN_IDLE()      tft.pushImage(130, 0, 29, 35, epd_bitmap_allArray7[0])
#define ICON_SCAN_ACTIVE()    tft.pushImage(130, 0, 29, 35, epd_bitmap_allArray8[0])
#define ICON_SCAN_CONNECTED() tft.pushImage(130, 0, 30, 30, epd_bitmap_allArray9[0])

void setupTaskWatchdog(uint32_t timeoutSeconds);
void pauseHeaterForOTA();
void resumeHeaterAfterOTA();

// Forward Declarations
void handleFirmwarePacket(const std::string &packet);
void processPendingOTAPacket();
void processPendingOTACommands();
bool otaQueueEmpty();
void saveOtaPending(const String &targetVersion, uint32_t targetAddress);
String readOtaVersion();
String readOtaStatus();
void clearOtaStatus();
void markOtaBootSuccessIfPending();
void loadConfigFromEEPROM();
void saveConfigToEEPROM();
void writeStringToEEPROM(int address, int maxLen, const String &value);
String readStringFromEEPROM(int address, int maxLen);
void parseMACAddress(String macStr, uint8_t* macBytes);
void storeFloatInEEPROM(float value);
float readFloatFromEEPROM();
void connectScanner();
bool connectScannerBlocking();
int startScannerConnect();
void drawScannerIcon();
void logActivity(const String &text);
bool parseScannerBatteryLine(const String &line);
void handleBLECommand(String jsonStr);
void startBLEProvisioning();
void bleNotify(const String &payload);
void drawOTAStartScreen();
void drawBLEOtaProgress(size_t current, size_t total);
bool performNetworkOTA(const String &url, const String &version);
void setupArduinoOTA();
void maintainNetwork();
void drawMatchIcon(const String &col);
void handleHeaterBackground();
void printFormattedDate();
void sendTemperatureData();
int ringMeter(float value, int vmin, int vmax, int x, int y, int r, const char *units, byte scheme);
unsigned int rainbow(byte value);
void verticalBarGraph(int value, int x, int y, int barWidth, int barHeight, const char *units, byte scheme);
char getKey(uint16_t tx, uint16_t ty);

// -----------------------------------------------------------
// HTTP (port 80) + mDNS for the Android app (Router mode).
//   mDNS  _apshgw._tcp                -> the app finds the unit
//   GET /data                         -> status of the unit (temperature, scanner, patient, RFID ...)
//   GET /activity?since=N             -> what happened on the unit (log), newer than event N
//   GET /scans?since=N                -> the scanned barcodes and their result, newer than scan N
//   GET /rfid                         -> RFID witness: tag 1 / tag 2 / MATCH or MISMATCH + patient data
//   GET /offset?check=1&pw= / ?value=V&pw=        -> temperature offset
//   GET /scanner_connect?mac= /scanner_disconnect /scanner_battery
//   GET /scanner_mode?mode=wireless|matcho        -> the barcode scanner of the unit
//   GET /scanner_scan, /scanner_devices           -> search for Bluetooth scanners (10 s)
//   GET /scanner_take (= /scanner_release), /scanner_handback -> the Android screen borrows the scanner
// "device" starts with APSHGW and "type" is MATCHO: the app shows it as the MATCHO ("cryomate") card.
// -----------------------------------------------------------

// The log and the scans are small ring buffers in static RAM: this unit runs with
// little free heap (WiFi + BLE + Classic Bluetooth), so nothing here grows the heap.
#define ACTIVITY_MAX  16
#define ACTIVITY_TEXT 48
struct ActivityEntry { uint32_t id; uint32_t epoch; uint32_t up; char text[ACTIVITY_TEXT]; };
ActivityEntry activityLog[ACTIVITY_MAX];
uint32_t activityLastId = 0;

#define SCAN_MAX    12
#define SCAN_CODE   40
#define SCAN_RESULT 32
struct ScanEntry { uint32_t id; uint32_t epoch; uint32_t up; bool patient; char code[SCAN_CODE]; char result[SCAN_RESULT]; };
ScanEntry scanLog[SCAN_MAX];
uint32_t scanLastId = 0;

// RFID witness result (filled in loop() when the server answered for tag 1 + tag 2)
uint32_t witnessSeq = 0;            // +1 for every result: the app opens its popup on a new number
unsigned long witnessAt = 0;        // millis() of the last result
String witnessResult = "";          // "match" / "mismatch"
String witnessCode = "", witnessProcess = "", witnessStage = "", witnessProcessFull = "", witnessMessage = "";
String witnessMale = "", witnessMaleAge = "", witnessMaleBlood = "";
String witnessFemale = "", witnessFemaleAge = "", witnessFemaleBlood = "";

uint32_t nowEpoch() {
  time_t t = time(nullptr);
  return t > 1000000000 ? (uint32_t)t : 0;          // 0 = clock not set yet: the app shows the uptime instead
}

// Only call from loop() (the HTTP handlers run in loop() too, so there is no race).
void logActivity(const String &text) {
  uint32_t id = ++activityLastId;
  ActivityEntry &e = activityLog[(id - 1) % ACTIVITY_MAX];
  e.id = id;
  e.epoch = nowEpoch();
  e.up = millis() / 1000;
  strlcpy(e.text, text.c_str(), sizeof(e.text));
}

uint32_t addScan(const String &code, bool patient) {
  uint32_t id = ++scanLastId;
  ScanEntry &e = scanLog[(id - 1) % SCAN_MAX];
  e.id = id;
  e.epoch = nowEpoch();
  e.up = millis() / 1000;
  e.patient = patient;
  strlcpy(e.code, code.c_str(), sizeof(e.code));
  e.result[0] = 0;
  return id;
}

void setScanResult(uint32_t id, const String &result) {
  ScanEntry &e = scanLog[(id - 1) % SCAN_MAX];
  if (e.id == id) strlcpy(e.result, result.c_str(), sizeof(e.result));
}

// a JSON value as text; "" when it is missing or null (never the word "null")
template <typename T>
String jsonText(const T &v) {
  if (v.isNull()) return "";
  return v.template as<String>();
}

// One static buffer for every answer: one allocation per answer, so the text is
// never cut off when the heap is low (that is what cut the old /data answer).
void sendJson(JsonDocument &doc, int code = 200) {
  static char buf[2048];
  if (serializeJson(doc, buf, sizeof(buf)) == 0) strcpy(buf, "{}");
  httpServer.sendHeader("Access-Control-Allow-Origin", "*");
  httpServer.send(code, "application/json", buf);
}

void sendOk() {
  StaticJsonDocument<32> d;
  d["ok"] = true;
  sendJson(d);
}

void sendError(int code, const char *error) {
  StaticJsonDocument<96> d;
  d["error"] = error;
  sendJson(d, code);
}

bool isValidMac(const String &mac) {
  if (mac.length() != 17) return false;
  for (int i = 0; i < 17; i++) {
    char c = mac[i];
    if (i % 3 == 2) { if (c != ':') return false; }
    else if (!isxdigit(c)) return false;
  }
  return true;
}

void handleData() {
  StaticJsonDocument<1536> d;
  uint32_t heap = ESP.getFreeHeap();
  d["device"]                = "APSHGW_" + lastFive;
  d["type"]                  = "MATCHO";
  d["firmwareVersion"]       = MATCHO_FW_VERSION;
  d["ip"]                    = WiFi.localIP().toString();
  d["mac"]                   = WiFi.macAddress();
  d["ssid"]                  = WiFi.SSID();
  d["rssi"]                  = WiFi.RSSI();
  d["temperature"]           = temperature;
  d["offset"]                = readFloatFromEEPROM();
  d["heaterOn"]              = digitalRead(HEATER_PIN) == HIGH;
  d["scannerConnected"]      = scannerConnected;
  d["scannerMac"]            = btMacString;
  d["scannerJob"]            = scannerConnecting ? "connecting" : "idle";
  d["scannerLastResult"]     = scannerLastResult == 1 ? "ok" : (scannerLastResult == 2 ? "failed" : "");
  d["scannerHeldByScreen"]   = (bool)scannerHeldByScreen;
  d["scannerBatteryPercent"] = scannerBatteryPercent;
  d["scannerBatteryVoltage"] = scannerBatteryVoltage;
  d["scannerBatteryPending"] = (scannerBatteryRequestedAt != 0) && (millis() - scannerBatteryRequestedAt < 5000);
  d["scannerBatteryAge"]     = scannerBatteryUpdatedAt ? (long)((millis() - scannerBatteryUpdatedAt) / 1000) : -1L;
  d["lastBarcode"]           = lastScannedBarcode;
  d["patientMale"]           = displayMaleName;
  d["patientFemale"]         = displayFemaleName;
  d["matchedColumn"]         = displayMatchedCol;
  d["localMatchMode"]        = localMatchMode;
  d["witnessState"]          = witnessState;
  d["rfid1"]                 = rfid_1_val;
  d["rfid2"]                 = rfid_2_val;
  d["lastActivity"]          = activityLastId;
  d["lastScan"]              = scanLastId;
  d["uptime"]                = millis() / 1000;
  d["freeHeap"]              = heap;
  d["lowMemory"]             = heap < 12000;
  sendJson(d);
}

// GET /activity?since=N  ->  {"last":N,"events":[{"id","t","up","text"}]}  (oldest first)
void handleActivity() {
  uint32_t since = strtoul(httpServer.arg("since").c_str(), nullptr, 10);
  StaticJsonDocument<2048> d;
  d["last"] = activityLastId;
  JsonArray events = d.createNestedArray("events");
  uint32_t first = activityLastId > ACTIVITY_MAX ? activityLastId - ACTIVITY_MAX + 1 : 1;
  if (since + 1 > first) first = since + 1;
  for (uint32_t id = first; id <= activityLastId; id++) {
    const ActivityEntry &e = activityLog[(id - 1) % ACTIVITY_MAX];
    if (e.id != id) continue;
    JsonObject o = events.createNestedObject();
    o["id"] = e.id;
    o["t"] = e.epoch;
    o["up"] = e.up;
    o["text"] = (const char *)e.text;
  }
  sendJson(d);
}

// GET /scans?since=N  ->  {"last":N,"scans":[{"id","t","up","kind","code","result"}]}  (oldest first)
void handleScans() {
  uint32_t since = strtoul(httpServer.arg("since").c_str(), nullptr, 10);
  StaticJsonDocument<2048> d;
  d["last"] = scanLastId;
  JsonArray scans = d.createNestedArray("scans");
  uint32_t first = scanLastId > SCAN_MAX ? scanLastId - SCAN_MAX + 1 : 1;
  if (since + 1 > first) first = since + 1;
  for (uint32_t id = first; id <= scanLastId; id++) {
    const ScanEntry &e = scanLog[(id - 1) % SCAN_MAX];
    if (e.id != id) continue;
    JsonObject o = scans.createNestedObject();
    o["id"] = e.id;
    o["t"] = e.epoch;
    o["up"] = e.up;
    o["kind"] = e.patient ? "patient" : "sample";
    o["code"] = (const char *)e.code;
    o["result"] = (const char *)e.result;
  }
  sendJson(d);
}

// GET /rfid  ->  witness state (0 idle, 1 tag 1 read, 2 checking) + the last result
void handleRfid() {
  StaticJsonDocument<1536> d;
  d["witnessState"]       = witnessState;
  d["rfid1"]              = rfid_1_val;
  d["rfid2"]              = rfid_2_val;
  d["witnessSeq"]         = witnessSeq;
  d["witnessAge"]         = witnessAt ? (long)((millis() - witnessAt) / 1000) : -1L;
  d["witnessResult"]      = witnessResult;
  d["witnessCode"]        = witnessCode;
  d["witnessProcess"]     = witnessProcess;
  d["witnessStage"]       = witnessStage;
  d["witnessProcessFull"] = witnessProcessFull;
  d["witnessMale"]        = witnessMale;
  d["witnessMaleAge"]     = witnessMaleAge;
  d["witnessMaleBlood"]   = witnessMaleBlood;
  d["witnessFemale"]      = witnessFemale;
  d["witnessFemaleAge"]   = witnessFemaleAge;
  d["witnessFemaleBlood"] = witnessFemaleBlood;
  d["witnessPatientTag"]  = rfid_1_val;
  d["witnessProcessTag"]  = rfid_2_val;
  d["witnessMessage"]     = witnessMessage;
  sendJson(d);
}

// GET /offset?check=1&pw=XXXX   or   GET /offset?value=-0.25&pw=XXXX
void handleOffset() {
#if OFFSET_NEEDS_PASSWORD
  if (httpServer.arg("pw") != OFFSET_PASSWORD) { sendError(403, "wrong_password"); return; }
#endif
  if (httpServer.hasArg("check")) { sendOk(); return; }
  if (!httpServer.hasArg("value")) { sendError(400, "missing_value"); return; }
  float v = httpServer.arg("value").toFloat();
  if (isnan(v) || isinf(v) || v < -50.0f || v > 50.0f) { sendError(400, "invalid_offset"); return; }
  storeFloatInEEPROM(v);
  logActivity("Offset set to " + String(v, 2) + " C");
  StaticJsonDocument<96> d;
  d["offset"] = v;
  d["currentTemp"] = temperature;
  sendJson(d);
}

// GET /scanner_connect?mac=AA:BB:CC:DD:EE:FF  (mac optional: the saved one is used)
void handleScannerConnect() {
  if (httpServer.hasArg("mac")) {
    String mac = httpServer.arg("mac");
    mac.trim();
    mac.toUpperCase();
    if (!isValidMac(mac)) { sendError(400, "invalid_mac"); return; }
    if (mac != btMacString) {
      btMacString = mac;
      parseMACAddress(btMacString, scannerAddress);
      saveConfigToEEPROM();
      logActivity("Scanner MAC set: " + btMacString);
    }
  }
  if (btMacString.length() < 17) { sendError(400, "invalid_mac"); return; }
  if (scannerConnected) { sendOk(); return; }
  if (scannerConnecting) { sendError(409, "busy"); return; }
  if (millis() - lastReconnect < 3000) { sendError(429, "wait"); return; }
  scannerHeldByScreen = false;
  lastReconnect = millis();
  int r = startScannerConnect();
  if (r == 1) { sendError(503, "low_memory"); return; }
  if (r == 2) { sendError(500, "no_task"); return; }
  sendOk();
}

void handleScannerDisconnect() {
  if (scannerConnecting) { sendError(409, "busy"); return; }
  scannerReconnectPending = false;
  if (SerialBT.connected()) SerialBT.disconnect();
  scannerConnected = false;
  sendOk();
}

void handleScannerBattery() {
  if (!scannerConnected) { sendError(409, "not_connected"); return; }
  SerialBT.print("%BAT_VOL#");
  scannerBatteryRequestedAt = millis();
  sendOk();
}

// wireless = the scanner works on its own;  matcho = Bluetooth, then 2 s later the SPP profile (done in loop())
void handleScannerMode() {
  if (!scannerConnected) { sendError(409, "not_connected"); return; }
  String mode = httpServer.arg("mode");
  if (mode == "wireless") {
    SerialBT.print("%#IFSNO$1");
    logActivity("Scanner: wireless mode");
  } else if (mode == "matcho") {
    SerialBT.print("%#IFSNO$4");
    scannerModeStep2At = millis() + 2000;
    logActivity("Scanner: Match-O mode");
  } else {
    sendError(400, "unknown_mode");
    return;
  }
  sendOk();
}

// GET /scanner_scan: 10 s Bluetooth search in the background (loop() keeps running)
void handleScannerScan() {
  if (scannerConnecting) { sendError(409, "busy"); return; }
  if (millis() < btSearchUntil) { sendOk(); return; }      // already searching
  if (ESP.getFreeHeap() < 15000) { sendError(503, "low_memory"); return; }
  if (!SerialBT.discoverAsync([](BTAdvertisedDevice *) {}, 10000)) { sendError(500, "no_task"); return; }
  btSearchUntil = millis() + 10500;
  logActivity("Searching for Bluetooth scanners");
  sendOk();
}

// GET /scanner_devices  ->  {"searching":bool,"devices":[{"name","mac"}]}  (the list is given when the search is over)
void handleScannerDevices() {
  StaticJsonDocument<2048> d;
  bool searching = millis() < btSearchUntil;
  d["searching"] = searching;
  JsonArray list = d.createNestedArray("devices");
  if (!searching && btSearchUntil != 0) {
    BTScanResults *results = SerialBT.getScanResults();
    if (results != nullptr) {
      for (int i = 0; i < results->getCount() && i < 20; i++) {
        BTAdvertisedDevice *dev = results->getDevice(i);
        if (dev == nullptr) continue;
        String mac = dev->getAddress().toString().c_str();
        mac.toUpperCase();
        JsonObject o = list.createNestedObject();
        o["name"] = String(dev->getName().c_str());
        o["mac"] = mac;
      }
    }
  }
  sendJson(d);
}

// The Android screen takes the barcode scanner (it can be connected to one device only):
// this unit lets it go and does NOT take it back by itself until /scanner_handback or a touch on the icon.
void handleScannerTake() {
  if (scannerConnecting) { sendError(409, "busy"); return; }
  scannerReconnectPending = false;
  scannerHeldByScreen = true;
  if (SerialBT.connected()) SerialBT.disconnect();
  scannerConnected = false;
  logActivity("Scanner given to the Android screen");
  sendOk();
}

// The Android screen gave the scanner back: this unit takes it again (the connect runs in loop()).
void handleScannerHandback() {
  scannerHeldByScreen = false;
  scannerReconnectPending = true;
  sendOk();
}

void startHttpAndMdns() {
  if (httpStarted) return;
  String host = "APSHGW_" + lastFive;
  MDNS.begin(host.c_str());                 // may return false if ArduinoOTA already started mDNS: harmless
  MDNS.addService("apshgw", "tcp", 80);     // matches "_apshgw._tcp." in the app
  httpServer.on("/data", HTTP_GET, handleData);
  httpServer.on("/activity", HTTP_GET, handleActivity);
  httpServer.on("/scans", HTTP_GET, handleScans);
  httpServer.on("/rfid", HTTP_GET, handleRfid);
  httpServer.on("/offset", HTTP_GET, handleOffset);
  httpServer.on("/scanner_connect", HTTP_GET, handleScannerConnect);
  httpServer.on("/scanner_disconnect", HTTP_GET, handleScannerDisconnect);
  httpServer.on("/scanner_battery", HTTP_GET, handleScannerBattery);
  httpServer.on("/scanner_mode", HTTP_GET, handleScannerMode);
  httpServer.on("/scanner_scan", HTTP_GET, handleScannerScan);
  httpServer.on("/scanner_devices", HTTP_GET, handleScannerDevices);
  httpServer.on("/scanner_take", HTTP_GET, handleScannerTake);
  httpServer.on("/scanner_release", HTTP_GET, handleScannerTake);
  httpServer.on("/scanner_handback", HTTP_GET, handleScannerHandback);
  httpServer.onNotFound([]() { sendError(404, "not_found"); });
  httpServer.begin();
  httpStarted = true;
  Serial.println("HTTP server + mDNS ready: " + host + " @ " + WiFi.localIP().toString());
}

// Called every loop(): as soon as the station is connected - at boot OR later
// (router came up after the unit, WiFi.reconnect() succeeded, AP fallback) -
// the HTTP server, mDNS and LAN OTA are started.
void maintainNetwork() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (isAPMode) {
    isAPMode = false;
    WiFi.softAPdisconnect(true);            // config AP no longer needed: the radio stays on the router channel
    configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
  }
  if (!arduinoOtaActive) setupArduinoOTA();
  if (!httpStarted) startHttpAndMdns();
}

// -----------------------------------------------------------
// BLE CALLBACKS
// -----------------------------------------------------------
class DeviceBLEServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* srv) override {
        bleDeviceConnected = true;
    }
    void onDisconnect(BLEServer* srv) override {
        bleDeviceConnected = false;
        delay(200);
        BLEDevice::startAdvertising();
    }
};

class BLEConfigCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) override {
        std::string rx = pChar->getValue();
        if (rx.empty()) return;

        if (static_cast<uint8_t>(rx[0]) == 0xF1) {
            // Copy only. No Update.write(), TFT, String building, or notify here.
            if (rx.size() >= 5 && rx.size() <= OTA_PACKET_MAX) {
                portENTER_CRITICAL(&otaQueueMux);
                if (otaQueueCount < OTA_QUEUE_DEPTH) {
                    memcpy(otaPacketQueue[otaQueueTail], rx.data(), rx.size());
                    otaPacketLengths[otaQueueTail] = rx.size();
                    otaQueueTail = (otaQueueTail + 1) % OTA_QUEUE_DEPTH;
                    otaQueueCount++;
                } else {
                    otaQueueOverflow = true;
                }
                portEXIT_CRITICAL(&otaQueueMux);
            }
            return;
        }

        // OTA control commands are also deferred. This keeps BLE callback
        // context free from flash writes and BLE notifications.
        if (rx.find("\"cmd\":\"FW_START\"") != std::string::npos) {
            if (rx.size() < sizeof(otaStartJson)) {
                portENTER_CRITICAL(&otaQueueMux);
                memcpy(otaStartJson, rx.data(), rx.size());
                otaStartJson[rx.size()] = '\0';
                otaStartPending = true;
                portEXIT_CRITICAL(&otaQueueMux);
            }
            return;
        }
        if (rx.find("\"cmd\":\"FW_END\"") != std::string::npos) {
            otaEndRequested = true;
            return;
        }
        if (rx.find("\"cmd\":\"FW_ABORT\"") != std::string::npos) {
            otaAbortRequested = true;
            return;
        }

        handleBLECommand(String(rx.c_str()));
    }
};

void bleNotify(const String &payload) {
    if (pCharacteristic == nullptr || !bleDeviceConnected) return;

    const size_t chunkSize = 160;
    size_t total = (payload.length() + chunkSize - 1) / chunkSize;
    if (total == 0) total = 1;

    for (size_t index = 0; index < total; ++index) {
        size_t start = index * chunkSize;
        size_t count = min(chunkSize, payload.length() - start);

        StaticJsonDocument<256> frame;
        frame["ble_chunk"] = true;
        frame["index"] = index;
        frame["total"] = total;
        frame["data"] = payload.substring(start, start + count);

        String packet;
        serializeJson(frame, packet);

        pCharacteristic->setValue(packet.c_str());
        pCharacteristic->notify();
        delay(8);
    }
}

// -----------------------------------------------------------
// BLE COMMAND HANDLER
// Replaces the old SPIFFS-backed WebServer /api/* routes and the
// captive-portal config page entirely. All configuration reads
// and writes (WiFi, scanner MAC, temperature offset, patient /
// match display, firmware update) now go through this handler.
// -----------------------------------------------------------
void handleBLECommand(String jsonStr) {
    StaticJsonDocument<768> doc;
    DeserializationError err = deserializeJson(doc, jsonStr);
    if (err) {
        bleNotify("{\"status\":\"error\",\"message\":\"bad_json\"}");
        return;
    }

    String cmd = doc["cmd"].as<String>();

    if (cmd == "STATUS" || cmd == "GET_DATA") {
        StaticJsonDocument<768> out;
        out["status"] = "data";
        out["device"] = "MATCH-O_" + lastFive;
        out["esp32Mac"] = WiFi.macAddress();
        out["mode"] = isAPMode ? "AP" : "STA";
        out["wifiConnected"] = (WiFi.status() == WL_CONNECTED);
        out["ssid"] = ssid;
        out["ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString()
                                                     : (isAPMode ? "192.168.4.1" : "0.0.0.0");
        out["wifiRSSI"] = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -100;
        out["currentTemp"] = temperature;
        out["offset"] = readFloatFromEEPROM();
        out["btConnected"] = scannerConnected;
        out["btMac"] = btMacString;
        out["barcode"] = lastScannedBarcode;
        out["scannerBatteryVoltage"] = scannerBatteryVoltage;
        out["scannerBatteryPercent"] = scannerBatteryPercent;
        // True only while waiting on a reply from the scanner, and only
        // for a few seconds - if it never replies (e.g. this module
        // doesn't honour serial-injected commands) we give up showing
        // "checking..." forever.
        out["scannerBatteryPending"] =
            (scannerBatteryRequestedAt != 0) &&
            (millis() - scannerBatteryRequestedAt < 5000);
        out["patientMale"] = displayMaleName;
        out["patientFemale"] = displayFemaleName;
        out["matchedColumn"] = displayMatchedCol;
        out["scannerName"] = "APS_MATCHO";
        out["firmwareVersion"] = MATCHO_FW_VERSION;
        out["otaInProgress"] = bleFirmwareUpdating || netFirmwareUpdating || arduinoOtaInProgress;
        if (bleFirmwareUpdating || netFirmwareUpdating || arduinoOtaInProgress) out["otaSource"] = currentOtaSource;
        String otaStatus = readOtaStatus();
        if (otaStatus.length()) {
          out["otaStatus"] = otaStatus;
          out["otaVersion"] = readOtaVersion();
          if (otaStatus == "success" || otaStatus == "failed") clearOtaStatus();
        }

        String resp;
        serializeJson(out, resp);
        bleNotify(resp);
    }
    else if (cmd == "SCAN_WIFI") {
        WiFi.mode(WIFI_STA);
        int n = WiFi.scanNetworks();

        StaticJsonDocument<768> wifiDoc;
        wifiDoc["status"] = "wifi_scan";
        JsonArray array = wifiDoc.createNestedArray("networks");

        for (int i = 0; i < n && i < 20; ++i) {
            JsonObject net = array.createNestedObject();
            net["ssid"] = WiFi.SSID(i);
            net["rssi"] = WiFi.RSSI(i);
            net["secured"] = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
        }

        String response;
        serializeJson(wifiDoc, response);
        bleNotify(response);
        WiFi.scanDelete();
    }
    else if (cmd == "SCAN_BT" || cmd == "DISCOVER_BT") {
        Serial.println("BLE command: starting Classic BT discovery");
        BTScanResults* btResults = SerialBT.discover(10000);

        StaticJsonDocument<2048> btDoc;
        btDoc["status"] = "bt_scan";
        JsonArray array = btDoc.createNestedArray("devices");

        if (btResults != nullptr) {
            for (int i = 0; i < btResults->getCount() && i < 30; ++i) {
                JsonObject item = array.createNestedObject();

                BTAddress addr = btResults->getDevice(i)->getAddress();
                String macStr = addr.toString().c_str();
                macStr.toUpperCase();

                item["name"] = String(btResults->getDevice(i)->getName().c_str());
                item["mac"] = macStr;
            }
        }

        String response;
        serializeJson(btDoc, response);
        bleNotify(response);
    }
    else if (cmd == "CONNECT_SCANNER") {
        scannerConnected = false;
        lastReconnect = 0;
        connectScanner();

        StaticJsonDocument<256> out;
        out["status"] = scannerConnected ? "scanner_connected" : "scanner_connect_failed";
        out["btMac"] = btMacString;

        String response;
        serializeJson(out, response);
        bleNotify(response);
    }
    else if (cmd == "GET_SCANNER_BATTERY") {
        // "%BAT_VOL#" is the literal payload encoded by the NT-1228BC's
        // printed "Battery Information" command barcode (decoded from
        // the barcode image, Code128). These low-cost scan-engine
        // modules feed serial-injected text through the same command
        // parser used for physically scanned command barcodes, so
        // writing this string directly to the scanner over the SPP
        // link can trigger the same "BAT_VOL=x.xxV yy%" reply without
        // anyone physically scanning the paper barcode.
        //
        // The reply (if the scanner honours it) arrives asynchronously
        // over SerialBT and is picked up by parseScannerBatteryLine()
        // in loop(), same as a physical scan - this handler just sends
        // the request and acknowledges it.
        StaticJsonDocument<256> out;

        if (!scannerConnected) {
            out["status"] = "error";
            out["message"] = "scanner_not_connected";
        } else {
            SerialBT.print("%BAT_VOL#");
            scannerBatteryRequestedAt = millis();
            out["status"] = "battery_requested";
        }

        String response;
        serializeJson(out, response);
        bleNotify(response);
    }
    else if (cmd == "SCANNER_SEND") {
        // Generic pass-through for the scanner's own "setup barcode"
        // command payloads (decoded straight from the printed Code128
        // sheets, same idea as GET_SCANNER_BATTERY above). The app
        // sends the literal payload text; we just relay it over the
        // SPP link exactly as if that barcode had been physically
        // scanned. Used for the Wireless Mode / Match-O (Bluetooth
        // Mode -> Bluetooth SPP) mode-switch buttons in the app.
        StaticJsonDocument<256> out;

        if (!scannerConnected) {
            out["status"] = "error";
            out["message"] = "scanner_not_connected";
        } else if (!doc.containsKey("payload")) {
            out["status"] = "error";
            out["message"] = "missing_payload";
        } else {
            String payload = doc["payload"].as<String>();
            SerialBT.print(payload);
            out["status"] = "scanner_payload_sent";
            out["payload"] = payload;
        }

        String response;
        serializeJson(out, response);
        bleNotify(response);
    }
    else if (cmd == "SAVE_BT_MAC") {
        if (!doc.containsKey("btMac")) {
            bleNotify("{\"status\":\"error\",\"message\":\"missing_btMac\"}");
            return;
        }

        String newMac = doc["btMac"].as<String>();
        newMac.trim();
        newMac.toUpperCase();

        if (newMac.length() != 17) {
            bleNotify("{\"status\":\"error\",\"message\":\"invalid_btMac\"}");
            return;
        }

        btMacString = newMac;
        parseMACAddress(btMacString, scannerAddress);
        saveConfigToEEPROM();

        scannerConnected = false;
        lastReconnect = 0;
        connectScanner();

        StaticJsonDocument<256> out;
        out["status"] = scannerConnected ? "scanner_connected" : "saved_scanner_not_connected";
        out["btMac"] = btMacString;

        String response;
        serializeJson(out, response);
        bleNotify(response);
    }
    else if (cmd == "SET_OFFSET" || cmd == "SAVE_OFFSET") {
        // Same EEPROM-backed offset used by the on-screen calibration
        // page (page 2) — this just gives the Android app a second
        // way to set it.
        if (!doc.containsKey("offset")) {
            bleNotify("{\"status\":\"error\",\"message\":\"missing_offset\"}");
            return;
        }

        float newOffset = doc["offset"].as<float>();

        if (isnan(newOffset) || isinf(newOffset) || newOffset < -50.0f || newOffset > 50.0f) {
            bleNotify("{\"status\":\"error\",\"message\":\"invalid_offset\"}");
            return;
        }

        storeFloatInEEPROM(newOffset);
        temperature = maxthermo ? maxthermo->temperature(100.0, 430.0) - newOffset : temperature;

        StaticJsonDocument<256> out;
        out["status"] = "offset_saved";
        out["offset"] = newOffset;
        out["currentTemp"] = temperature;

        String response;
        serializeJson(out, response);
        bleNotify(response);
    }
    else if (cmd == "SET_PATIENT") {
        if (doc.containsKey("male_name")) displayMaleName = doc["male_name"].as<String>();
        if (doc.containsKey("female_name")) displayFemaleName = doc["female_name"].as<String>();
        displayMatchedCol = "";
        bleNotify("{\"status\":\"patient_set\"}");
    }
    else if (cmd == "SET_MATCH") {
        if (doc.containsKey("col")) {
            displayMatchedCol = doc["col"].as<String>();
            if (page == 4) drawMatchIcon(displayMatchedCol);
        }
        bleNotify("{\"status\":\"match_set\"}");
    }
    else if (cmd == "FW_START") {
        // ---- Network OTA takes PRIORITY whenever it's usable ----
        // If the app included a firmware "url", prefer pulling the
        // update straight over WiFi/HTTP instead of chunking it over
        // BLE. This is faster and frees the phone's BLE link. If WiFi
        // isn't connected right now, fall straight through to the
        // existing BLE chunked-transfer path below as an automatic
        // fallback (no separate command needed from the app).
        if (doc.containsKey("url")) {
            String netUrl = doc["url"].as<String>();
            netUrl.trim();

            if (netUrl.length() > 0 && WiFi.status() == WL_CONNECTED) {
                String netVersion = doc.containsKey("version") ? doc["version"].as<String>() : "";
                netVersion.trim();
                performNetworkOTA(netUrl, netVersion);
                return; // performNetworkOTA sends its own status notifications
            }

            if (netUrl.length() > 0) {
                bleNotify("{\"status\":\"fw_info\",\"message\":\"no_wifi_falling_back_to_ble\"}");
            }
        }

        // ---- BLE chunked-transfer OTA (fallback path) ----
        if (!doc.containsKey("size")) {
            bleNotify("{\"status\":\"fw_error\",\"message\":\"missing_size\"}");
            return;
        }

        size_t fwSize = doc["size"].as<size_t>();
        const esp_partition_t* ota = esp_ota_get_next_update_partition(nullptr);
        size_t otaSize = ota ? ota->size : 0;
        if (fwSize == 0 || !ota || fwSize > otaSize) {
            StaticJsonDocument<256> out;
            out["status"] = "fw_error"; out["message"] = "invalid_size";
            out["size"] = fwSize; out["partitionSize"] = otaSize;
            String response; serializeJson(out, response); bleNotify(response);
            return;
        }

        if (Update.isRunning()) Update.abort();
        pauseHeaterForOTA();
        digitalWrite(HEATER_PIN, LOW);

        if (!Update.begin(fwSize, U_FLASH)) {
            resumeHeaterAfterOTA();
            StaticJsonDocument<256> out;
            out["status"] = "fw_error"; out["message"] = "update_begin_failed";
            out["reason"] = Update.errorString();
            String response; serializeJson(out, response); bleNotify(response);
            return;
        }

        bleFirmwareUpdating = true;
        bleFirmwareExpected = fwSize;
        bleFirmwareReceived = 0;
        bleFirmwareNextSeq = 0;
        otaTargetVersion = doc.containsKey("version") ? doc["version"].as<String>() : "";
        otaTargetVersion.trim();
        saveOtaPending(otaTargetVersion, ota->address);

        currentOtaSource = "Bluetooth";
        drawOTAStartScreen();

        Serial.printf("OTA target partition: %s, address=0x%08lx, size=%u bytes\n",
                      ota->label, (unsigned long)ota->address, (unsigned)ota->size);
        Serial.printf("OTA started: %u bytes, free sketch space=%u bytes\n",
                      (unsigned)fwSize, (unsigned)otaSize);

        StaticJsonDocument<256> out;
        out["status"] = "fw_ready";
        out["size"] = fwSize;
        out["partitionSize"] = otaSize;
        out["currentVersion"] = MATCHO_FW_VERSION;
        String response; serializeJson(out, response); bleNotify(response);
    }
    else if (cmd == "FW_ABORT") {
        // Network OTA (performNetworkOTA) polls otaAbortRequested itself
        // from inside its download loop and unwinds on its own, since it
        // runs synchronously outside this handler's normal call path when
        // it is active. Here we only need to handle the BLE chunked path
        // directly, and leave the flag alone if a network OTA is running
        // so its loop still sees it.
        if (bleFirmwareUpdating) {
            bleFirmwareUpdating = false;
            portENTER_CRITICAL(&otaQueueMux);
            otaQueueHead = otaQueueTail = otaQueueCount = 0;
            otaQueueOverflow = false;
            portEXIT_CRITICAL(&otaQueueMux);
            Update.abort();
            resumeHeaterAfterOTA();
            clearOtaStatus();
            digitalWrite(HEATER_PIN, LOW);
            bleNotify("{\"status\":\"fw_aborted\"}");
        } else if (!netFirmwareUpdating) {
            // Nothing is actually running — still acknowledge so the app
            // doesn't hang waiting for a response.
            bleNotify("{\"status\":\"fw_aborted\"}");
        }
        otaEndRequested = false;
        if (!netFirmwareUpdating) otaAbortRequested = false;
    }
    else if (cmd == "FW_END") {
        if (!bleFirmwareUpdating) {
            bleNotify("{\"status\":\"fw_error\",\"message\":\"no_update\"}");
            return;
        }

        if (bleFirmwareReceived != bleFirmwareExpected) {
            bleFirmwareUpdating = false;
            Update.abort();
            resumeHeaterAfterOTA();
            StaticJsonDocument<256> out;
            out["status"] = "fw_error"; out["message"] = "size_mismatch";
            out["received"] = bleFirmwareReceived; out["expected"] = bleFirmwareExpected;
            String response; serializeJson(out, response); bleNotify(response);
            return;
        }

        esp_task_wdt_reset();
        if (!Update.end(true)) {
            bleFirmwareUpdating = false;
            resumeHeaterAfterOTA();
            char errMsg[180];
            snprintf(errMsg, sizeof(errMsg), "{\"status\":\"fw_error\",\"message\":\"update_end_failed\",\"reason\":\"%s\"}", Update.errorString());
            bleNotify(String(errMsg));
            return;
        }

        bleFirmwareUpdating = false;
        digitalWrite(HEATER_PIN, LOW);
        tft.fillScreen(TFT_WHITE);
        tft.setTextColor(TFT_BLACK, TFT_WHITE);
        tft.setTextSize(3);
        tft.setCursor(45, 130); tft.print("Updating...");
        bleNotify("{\"status\":\"fw_written\",\"restarting\":true}");
        delay(300);
        ESP.restart();
    }
    else if (cmd == "START_PATIENT_SCAN") {
        patientScanArmed = true;
        lastScannedBarcode = "";
        displayMaleName = "";
        displayFemaleName = "";
        displayMatchedCol = "";

        bleNotify("{\"status\":\"patient_scan_armed\"}");
    }
    else if (cmd == "GET_BARCODE") {
        StaticJsonDocument<384> out;
        out["status"] = "barcode";
        out["barcode"] = lastScannedBarcode;
        out["patientMale"] = displayMaleName;
        out["patientFemale"] = displayFemaleName;
        out["matchedColumn"] = displayMatchedCol;

        String response;
        serializeJson(out, response);
        bleNotify(response);
    }
    else if (cmd == "CLEAR_DISPLAY") {
        displayMaleName = "";
        displayFemaleName = "";
        displayMatchedCol = "";
        lastScannedBarcode = "";

        bleNotify("{\"status\":\"display_cleared\"}");
    }
    else if (cmd == "PROVISION" || cmd == "SET_WIFI") {
        // Replaces the old SPIFFS config.json + captive-portal flow.
        if (!doc.containsKey("ssid") || !doc.containsKey("pass")) {
            bleNotify("{\"status\":\"error\",\"message\":\"missing_fields\"}");
            return;
        }

        String newSsid = doc["ssid"].as<String>();
        String newPassword = doc["pass"].as<String>();
        newSsid.trim();
        newPassword.trim();

        if (newSsid.length() == 0) {
            bleNotify("{\"status\":\"error\",\"message\":\"empty_ssid\"}");
            return;
        }

        ssid = newSsid;
        password = newPassword;

        if (doc.containsKey("btMac")) {
            String newMac = doc["btMac"].as<String>();
            newMac.trim();
            newMac.toUpperCase();

            if (newMac.length() == 17) {
                btMacString = newMac;
                parseMACAddress(btMacString, scannerAddress);
            }
        }

        saveConfigToEEPROM();

        bleNotify("{\"status\":\"wifi_saved\",\"restarting\":true}");
        delay(800);
        ESP.restart();
    }
    else {
        StaticJsonDocument<256> out;
        out["status"] = "error";
        out["message"] = "unknown_cmd";
        out["cmd"] = cmd;

        String response;
        serializeJson(out, response);
        bleNotify(response);
    }
}

void startBLEProvisioning() {
    if (bleAdvertisingActive) return;

    String bleName = "MATCH-O_" + lastFive;
    BLEDevice::init(bleName.c_str());

    pBleServer = BLEDevice::createServer();
    pBleServer->setCallbacks(new DeviceBLEServerCallbacks());

    BLEService *pService = pBleServer->createService(BLE_SERVICE_UUID);
    pCharacteristic = pService->createCharacteristic(
        BLE_CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_READ |
        BLECharacteristic::PROPERTY_WRITE |
        BLECharacteristic::PROPERTY_NOTIFY
    );
    pCharacteristic->addDescriptor(new BLE2902());
    pCharacteristic->setCallbacks(new BLEConfigCallbacks());
    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);
    pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    bleAdvertisingActive = true;
    Serial.println("BLE provisioning advertising as: " + bleName);
}

// Convert MAC String "AA:BB:CC:DD:EE:FF" to byte array
void parseMACAddress(String macStr, uint8_t* macBytes) {
  int dashIndex = 0;
  for (int i = 0; i < 6; i++) {
    macBytes[i] = strtoul(macStr.substring(dashIndex, dashIndex + 2).c_str(), NULL, 16);
    dashIndex += 3;
  }
}

// -----------------------------------------------------------
// EEPROM PERSISTENT CONFIGURATION (replaces SPIFFS /config.json)
// -----------------------------------------------------------
void writeStringToEEPROM(int address, int maxLen, const String &value) {
  int len = min((int)value.length(), maxLen - 1);
  for (int i = 0; i < maxLen; i++) EEPROM.write(address + i, 0);
  for (int i = 0; i < len; i++) EEPROM.write(address + i, value[i]);
  EEPROM.write(address + len, 0);
}

String readStringFromEEPROM(int address, int maxLen) {
  char buf[97];
  int n = min(maxLen - 1, 96);
  for (int i = 0; i < n; i++) {
    uint8_t b = EEPROM.read(address + i);
    if (b == 0 || b == 0xFF) {
      buf[i] = 0;
      return String(buf);
    }
    buf[i] = (char)b;
  }
  buf[n] = 0;
  return String(buf);
}

void saveConfigToEEPROM() {
  EEPROM.put(EEPROM_MAGIC_ADDR, EEPROM_MAGIC);
  writeStringToEEPROM(EEPROM_SSID_ADDR, EEPROM_SSID_LEN, ssid);
  writeStringToEEPROM(EEPROM_PASS_ADDR, EEPROM_PASS_LEN, password);
  writeStringToEEPROM(EEPROM_BT_ADDR, EEPROM_BT_LEN, btMacString);
  EEPROM.commit();
  Serial.println("MatchO configuration saved to EEPROM.");
}

void loadConfigFromEEPROM() {
  uint32_t magic = 0;
  EEPROM.get(EEPROM_MAGIC_ADDR, magic);

  if (magic != EEPROM_MAGIC) {
    float oldOffset = 0.0f;
    EEPROM.get(0, oldOffset);
    if (isnan(oldOffset) || isinf(oldOffset) || oldOffset < -50.0f || oldOffset > 50.0f) {
      oldOffset = 0.0f;
    }

    ssid = "";
    password = "";
    btMacString = "";

    EEPROM.put(EEPROM_MAGIC_ADDR, EEPROM_MAGIC);
    EEPROM.put(EEPROM_OFFSET_ADDR, oldOffset);
    saveConfigToEEPROM();
    Serial.println("EEPROM initialized.");
    return;
  }

  ssid = readStringFromEEPROM(EEPROM_SSID_ADDR, EEPROM_SSID_LEN);
  password = readStringFromEEPROM(EEPROM_PASS_ADDR, EEPROM_PASS_LEN);
  btMacString = readStringFromEEPROM(EEPROM_BT_ADDR, EEPROM_BT_LEN);

  if (btMacString.length() >= 17) {
    btMacString.toUpperCase();
    parseMACAddress(btMacString, scannerAddress);
    Serial.println("Loaded scanner MAC from EEPROM: " + btMacString);
  }

  float off = 0.0f;
  EEPROM.get(EEPROM_OFFSET_ADDR, off);
  if (isnan(off) || isinf(off) || off < -50.0f || off > 50.0f) {
    off = 0.0f;
    EEPROM.put(EEPROM_OFFSET_ADDR, off);
    EEPROM.commit();
  }

  Serial.println("Loaded WiFi SSID from EEPROM: " + ssid);
}

// The scanner icon on the TFT. loop() calls it when the state changes; the
// connect itself never draws (it runs in its own task, and the TFT is not task-safe).
void drawScannerIcon() {
  if (scannerConnected) { ICON_SCAN_CONNECTED(); }
  else if (scannerConnecting) { ICON_SCAN_ACTIVE(); }
  else { ICON_SCAN_IDLE(); }
}

// Blocking connect, used by the BLE commands (CONNECT_SCANNER / SAVE_BT_MAC) and at boot.
void connectScanner() {
  if (scannerConnected || scannerConnecting) return;
  scannerConnecting = true;
  connectScannerBlocking();
  scannerConnecting = false;
}

void scannerConnectTask(void *) {
  connectScannerBlocking();
  scannerConnecting = false;
  vTaskDelete(NULL);
}

// Touch on the icon / app: the connect (SerialBT.connect() blocks up to ~10 s) runs in its
// own task, so the TFT, the heater display and the HTTP answers for the app keep going.
// 0 = started, 1 = low memory, 2 = could not start (or already busy)
int startScannerConnect() {
  if (scannerConnected || scannerConnecting) return 2;
  if (ESP.getFreeHeap() < 15000) return 1;
  scannerConnecting = true;
  if (xTaskCreatePinnedToCore(scannerConnectTask, "scannerConnect", 6144, nullptr, 1, nullptr, 0) != pdPASS) {
    scannerConnecting = false;
    return 2;
  }
  return 0;
}

bool connectScannerBlocking() {
  char macText[18];
  snprintf(macText, sizeof(macText), "%02X:%02X:%02X:%02X:%02X:%02X",
           scannerAddress[0], scannerAddress[1], scannerAddress[2],
           scannerAddress[3], scannerAddress[4], scannerAddress[5]);
  Serial.printf("Scanner connect to %s%s (free heap: %u bytes)\n", macText,
                btMacString.length() >= 17 ? "" : " (default MAC: no scanner MAC saved!)", ESP.getFreeHeap());

  // a Bluetooth search (GET /scanner_scan) still running makes the connect fail: stop it first
  if (millis() < btSearchUntil) {
    SerialBT.discoverAsyncStop();
    btSearchUntil = 0;
    delay(200);
  }

  // Classic BT (SPP) connect + BLE advertising running at the same time
  // is a known weak spot for ESP32 dual-mode Bluetooth stability.
  // Briefly pausing BLE advertising for the duration of the connect
  // handshake reduces that contention. This does NOT drop an already-
  // connected BLE central - it only stops new incoming connections
  // while the SPP handshake is in flight.
  bool wasAdvertising = bleAdvertisingActive;
  if (wasAdvertising) {
    BLEDevice::stopAdvertising();
    delay(100); // let the BT stack settle before starting the SPP connect
  }

  // POWER: the Bluetooth page (connect) draws its biggest current peak. Together with
  // WiFi sending at full power and the heater switching, a weak supply collapses and the
  // ESP32 restarts (rst:0x1 POWERON_RESET). During the connect: heater off, WiFi at low
  // transmit power, and loop() stops answering the app (see scannerConnecting in loop()).
  pauseHeaterForOTA();
  digitalWrite(HEATER_PIN, LOW);
  wifi_power_t oldTxPower = WiFi.getTxPower();
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  delay(50);

  // 1st try: the SPP channel is looked up on the scanner (SDP).
  // 2nd try: channel 1 directly - some scanners do not answer the lookup but accept channel 1.
  bool ok = SerialBT.connect(scannerAddress);
  if (!ok) {
    Serial.println("Scanner connect: no answer on the SPP lookup, trying channel 1");
    delay(1000);                          // let the supply recover between the two tries
    ok = SerialBT.connect(scannerAddress, 1);
  }

  WiFi.setTxPower(oldTxPower);
  resumeHeaterAfterOTA();

  scannerConnected = ok;                  // set BEFORE scannerConnecting goes false: loop() never sees "idle" in between
  scannerLastResult = ok ? 1 : 2;

  Serial.printf("Scanner connect %s (free heap: %u bytes)\n",
                ok ? "succeeded" : "FAILED - scanner off/asleep, connected to another device (phone / Android screen), "
                                   "not in SPP mode, or paired to another host", ESP.getFreeHeap());

  if (wasAdvertising) {
    delay(100);
    BLEDevice::startAdvertising();
  }
  return ok;
}

// -----------------------------------------------------------
// Parses a battery-status line from the NT-1228BC, e.g.:
//   "BAT_VOL=3.98V 84%"
// into scannerBatteryVoltage / scannerBatteryPercent.
// Returns true if the line matched and was parsed.
// -----------------------------------------------------------
bool parseScannerBatteryLine(const String &line) {
  if (!line.startsWith("BAT_VOL")) return false;

  int eqIdx = line.indexOf('=');
  if (eqIdx < 0) return false;

  String rest = line.substring(eqIdx + 1); // e.g. "3.98V 84%"
  rest.trim();

  int vIdx = rest.indexOf('V');
  if (vIdx < 0) return false;

  String voltStr = rest.substring(0, vIdx);
  voltStr.trim();
  float volts = voltStr.toFloat();

  int pct = -1;
  int pctIdx = rest.indexOf('%');
  if (pctIdx > vIdx) {
    String pctStr = rest.substring(vIdx + 1, pctIdx);
    pctStr.trim();
    pct = pctStr.toInt();
  }

  // toFloat()/toInt() both return 0 on a bad parse, so require at least
  // one of the two values to look real before accepting the line.
  if (volts <= 0.0f && pct < 0) return false;

  scannerBatteryVoltage = volts;
  scannerBatteryPercent = pct;
  scannerBatteryUpdatedAt = millis();
  scannerBatteryRequestedAt = 0; // reply received - clear pending flag

  Serial.printf("Scanner battery: %.2fV %d%%\n", scannerBatteryVoltage, scannerBatteryPercent);
  return true;
}

void storeFloatInEEPROM(float value) {
  EEPROM.put(EEPROM_OFFSET_ADDR, value);
  EEPROM.commit();
}

float readFloatFromEEPROM() {
  float value = 0.0f;
  EEPROM.get(EEPROM_OFFSET_ADDR, value);
  if (isnan(value) || isinf(value) || value < -50.0f || value > 50.0f) {
    value = 0.0f;
  }
  return value;
}

// -----------------------------------------------------------
// WATCHDOG CONFIGURATION (keeps a long BLE firmware transfer
// from tripping the default 5s TWDT and rebooting mid-update)
// -----------------------------------------------------------
void setupTaskWatchdog(uint32_t timeoutSeconds) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_deinit();
  esp_task_wdt_config_t wdtConfig = {
      .timeout_ms = timeoutSeconds * 1000UL,
      .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
      .trigger_panic = true
  };
  esp_task_wdt_init(&wdtConfig);
  esp_task_wdt_add(NULL);
#else
  esp_task_wdt_init(timeoutSeconds, true);
  esp_task_wdt_add(NULL);
#endif
}

// Pause/resume the background heater ticker while flash is being written.
// The ticker fires an SPI transaction (thermocouple read) on a timer task;
// keeping it fully quiet during Update.write()/Update.end() removes any
// chance of SPI bus contention interfering with the flash write.
void pauseHeaterForOTA() {
  heaterTicker.detach();
}
void resumeHeaterAfterOTA() {
  heaterTicker.attach(0.5, handleHeaterBackground);
}

// -----------------------------------------------------------
// BLE FIRMWARE UPDATE (fallback path — see performNetworkOTA() further
// below for the priority Network/HTTP OTA path)
// -----------------------------------------------------------
void handleFirmwarePacket(const std::string &packet) {
  if (!bleFirmwareUpdating || packet.size() < 5) return;
  if (static_cast<uint8_t>(packet[0]) != 0xF1) return;

  uint32_t seq =
      (static_cast<uint32_t>(static_cast<uint8_t>(packet[1])) << 24) |
      (static_cast<uint32_t>(static_cast<uint8_t>(packet[2])) << 16) |
      (static_cast<uint32_t>(static_cast<uint8_t>(packet[3])) << 8) |
      static_cast<uint32_t>(static_cast<uint8_t>(packet[4]));

  if (seq != bleFirmwareNextSeq) {
    Serial.printf("OTA sequence error: got=%lu expected=%lu\n", (unsigned long)seq, (unsigned long)bleFirmwareNextSeq);
    bleFirmwareUpdating = false; Update.abort(); resumeHeaterAfterOTA();
    return;
  }

  size_t dataLen = packet.size() - 5;
  if (dataLen == 0 || bleFirmwareReceived + dataLen > bleFirmwareExpected) {
    bleFirmwareUpdating = false; Update.abort(); resumeHeaterAfterOTA(); return;
  }

 size_t written = Update.write((uint8_t*)packet.data() + 5, dataLen);

if (written != dataLen) {
  bleFirmwareUpdating = false;
  Update.abort();
  resumeHeaterAfterOTA();

  Serial.printf("OTA flash write failed: %u/%u\n",
                (unsigned)written,
                (unsigned)dataLen);
  return;
}

  bleFirmwareReceived += written;
  bleFirmwareNextSeq++;
  esp_task_wdt_reset();
  drawBLEOtaProgress(bleFirmwareReceived, bleFirmwareExpected);
}

void processPendingOTAPacket() {
  if (otaQueueOverflow) {
    otaQueueOverflow = false;
    bleFirmwareUpdating = false;
    Update.abort();
    resumeHeaterAfterOTA();
    bleNotify("{\"status\":\"fw_error\",\"message\":\"ota_queue_overflow\"}");
    return;
  }

  uint8_t localPacket[OTA_PACKET_MAX];
  size_t localLen = 0;

  portENTER_CRITICAL(&otaQueueMux);
  if (otaQueueCount > 0) {
    localLen = otaPacketLengths[otaQueueHead];
    memcpy(localPacket, otaPacketQueue[otaQueueHead], localLen);
    otaPacketLengths[otaQueueHead] = 0;
    otaQueueHead = (otaQueueHead + 1) % OTA_QUEUE_DEPTH;
    otaQueueCount--;
  }
  portEXIT_CRITICAL(&otaQueueMux);

  if (localLen) handleFirmwarePacket(std::string((char*)localPacket, localLen));
}

bool otaQueueEmpty() {
  bool empty;
  portENTER_CRITICAL(&otaQueueMux);
  empty = (otaQueueCount == 0);
  portEXIT_CRITICAL(&otaQueueMux);
  return empty;
}

void processPendingOTACommands() {
  if (otaAbortRequested) {
    otaAbortRequested = false;
    handleBLECommand("{\"cmd\":\"FW_ABORT\"}");
    return;
  }

  if (otaStartPending) {
    char startCmd[sizeof(otaStartJson)];
    bool have = false;
    portENTER_CRITICAL(&otaQueueMux);
    if (otaStartPending) {
      memcpy(startCmd, otaStartJson, sizeof(startCmd));
      otaStartPending = false;
      have = true;
    }
    portEXIT_CRITICAL(&otaQueueMux);
    if (have) {
      handleBLECommand(String(startCmd));
      return;
    }
  }

  // FW_END is finalized only after every queued data packet has been written.
  if (otaEndRequested && bleFirmwareUpdating && otaQueueEmpty()) {
    otaEndRequested = false;
    handleBLECommand("{\"cmd\":\"FW_END\"}");
  }
}

void saveOtaPending(const String &targetVersion, uint32_t targetAddress) {
  EEPROM.put(EEPROM_OTA_ADDR, EEPROM_OTA_MAGIC);
  EEPROM.put(EEPROM_OTA_TARGET_ADDR, targetAddress);
  writeStringToEEPROM(EEPROM_OTA_VERSION_ADDR, EEPROM_OTA_VERSION_LEN, targetVersion);
  writeStringToEEPROM(EEPROM_OTA_STATUS_ADDR, EEPROM_OTA_STATUS_LEN, "pending");
  EEPROM.commit();
}
String readOtaVersion() { return readStringFromEEPROM(EEPROM_OTA_VERSION_ADDR, EEPROM_OTA_VERSION_LEN); }
String readOtaStatus() {
  uint32_t magic = 0; EEPROM.get(EEPROM_OTA_ADDR, magic);
  if (magic != EEPROM_OTA_MAGIC) return "";
  return readStringFromEEPROM(EEPROM_OTA_STATUS_ADDR, EEPROM_OTA_STATUS_LEN);
}
void clearOtaStatus() {
  EEPROM.put(EEPROM_OTA_ADDR, 0UL);
  writeStringToEEPROM(EEPROM_OTA_VERSION_ADDR, EEPROM_OTA_VERSION_LEN, "");
  writeStringToEEPROM(EEPROM_OTA_STATUS_ADDR, EEPROM_OTA_STATUS_LEN, "");
  EEPROM.commit();
}
void markOtaBootSuccessIfPending() {
  if (readOtaStatus() != "pending") return;

  uint32_t targetAddress = 0;
  EEPROM.get(EEPROM_OTA_TARGET_ADDR, targetAddress);
  const esp_partition_t* running = esp_ota_get_running_partition();
  uint32_t runningAddress = running ? running->address : 0;

  const char* result = (running && runningAddress == targetAddress) ? "success" : "failed";
  writeStringToEEPROM(EEPROM_OTA_STATUS_ADDR, EEPROM_OTA_STATUS_LEN, result);
  EEPROM.commit();

  if (strcmp(result, "success") == 0) {
    Serial.printf("OTA BOOT SUCCESS: running version %s, partition=0x%08lx\n", MATCHO_FW_VERSION, (unsigned long)runningAddress);
  } else {
    Serial.printf("OTA BOOT FAILED/OLD APP: running=0x%08lx expected=0x%08lx\n",
                  (unsigned long)runningAddress, (unsigned long)targetAddress);
  }
}

void drawMatchIcon(const String &col) {
  if (col == "Tank") {
    tft.pushImage(10, 110, 60, 88, epd_bitmap_allArray10[0]);
    tft.setTextColor(TFT_BLACK, TFT_WHITE);
    tft.setTextSize(2);
    tft.setCursor(80, 140);
    tft.print("->");
  } else if (col == "Canister") {
    tft.pushImage(120, 95, 28, 88, epd_bitmap_allArray11[0]);
    tft.setTextColor(TFT_BLACK, TFT_WHITE);
    tft.setTextSize(2);
    tft.setCursor(170, 140);
    tft.print("->");
  } else if (col == "Goblet") {
    tft.pushImage(210, 110, 80, 80, epd_bitmap_allArray12[0]);
  }
}

void setup() {
  // Must be done before anything else so a full BLE firmware transfer
  // can't false-trigger the watchdog. See setupTaskWatchdog() comment.
  Serial.begin(115200);

  Serial.println();
  Serial.println("========== ESP32 INFO ==========");
  Serial.printf("Flash size: %u bytes\n", ESP.getFlashChipSize());
  Serial.printf("Sketch size: %u bytes\n", ESP.getSketchSize());
  Serial.printf("Free sketch space: %u bytes\n", ESP.getFreeSketchSpace());
  Serial.println("================================");

  setupTaskWatchdog(OTA_WDT_TIMEOUT_S);

  EEPROM.begin(EEPROM_SIZE);
  markOtaBootSuccessIfPending();
  pinMode(TFT_CS, OUTPUT);
  pinMode(MAX31856_CS, OUTPUT);
  digitalWrite(TFT_CS, HIGH);
  digitalWrite(MAX31856_CS, HIGH);

  SerialBT.begin("APS_MATCHO", true);

  tft.begin();
  tft.setRotation(3);
  tft.fillScreen(TFT_WHITE);
  tft.setSwapBytes(true);

  Serial2.begin(115200, SERIAL_8N1, RXD2, TXD2);
  pinMode(HEATER_PIN, OUTPUT);
  digitalWrite(HEATER_PIN, LOW);

  String mac = WiFi.macAddress();
  mac.replace(":", "");
  deviceID = mac;
  lastFive = mac.substring(mac.length() - 5);
  lastFive.replace(":", "");

  // ---------------- EEPROM CONFIG LOAD (replaces SPIFFS/config.json) ----------------
  loadConfigFromEEPROM();

  tft.fillScreen(TFT_WHITE);
  tft.fillCircle(110, 190, 180, TFT_ORANGE);
  tft.pushImage(180, 10, 140, 21, epd_bitmap_allArray[0]);
  tft.setTextColor(TFT_BLACK);
  tft.setTextSize(2);

  ssid.trim(); password.trim();

  if (ssid != "" && ssid != "null") {
    tft.setCursor(5, 150); tft.print("Connecting to:");
    tft.setCursor(5, 180); tft.print(ssid);

    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    delay(200);
    WiFi.begin(ssid.c_str(), password.c_str());

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
      delay(500); attempts++;
    }
  }

  if (WiFi.status() != WL_CONNECTED) {
    isAPMode = true;
    String WifiName = "APSMHG_" + String(lastFive);
    // AP + STA: the configuration AP comes up, but the station side keeps trying the
    // router. Before, WIFI_AP alone meant a unit that missed the router at boot (router
    // slow to start, weak signal) never joined it until the next reboot, so the app
    // could never find it on the network.
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(WifiName.c_str());
    if (ssid != "" && ssid != "null") WiFi.begin(ssid.c_str(), password.c_str());
    delay(500);
    Serial.println("AP Mode Started (BLE configuration only).");

    // No more captive-portal web page — WiFi/scanner config is now
    // done exclusively over BLE (PROVISION / SET_WIFI / SAVE_BT_MAC).
    tft.setCursor(5, 60);  tft.print("CONFIGURE VIA BLE");
    tft.setCursor(5, 90);  tft.print("BLE: MATCH-O_" + String(lastFive));
    tft.setCursor(5, 120); tft.print("WiFi AP: " + WifiName);
    tft.setCursor(5, 150); tft.print("IP: 192.168.4.1");
    delay(5000);
  } else {
    isAPMode = false;
    tft.setCursor(1, 200); tft.print("IP:"); tft.print(WiFi.localIP());
  }

  if (!isAPMode) {
    configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
    configTime(19800, 0, "time.google.com");
    unsigned long start = millis();
    while (time(nullptr) < 1000000000 && millis() - start < 2000) { delay(50); }
  }

  vspi = new SPIClass(VSPI);
  vspi->begin(18, 19, 23, MAX31856_CS);
  maxthermo = new Adafruit_MAX31865(MAX31856_CS, vspi);

  if (!maxthermo->begin(MAX31865_2WIRE)) {
    Serial.println("MAX31856 NOT FOUND!");
    while (1);
  }

  tft.fillScreen(TFT_WHITE);
  tft.fillRect(0, 35, 320, 220, TFT_BLACK);
  tft.pushImage(180, 7, 140, 21, epd_bitmap_allArray[0]);
  drawScannerIcon();
  tft.setTouch(calData);
  heaterTicker.attach(0.5, handleHeaterBackground);

  if (WiFi.status() == WL_CONNECTED) {
    configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
    int timeout = 0;
    while (time(nullptr) < 1000000000 && timeout < 20) {
      delay(500);
      timeout++;
    }

    // LAN OTA (Arduino IDE / espota.py, by IP address) — only meaningful
    // once we actually have a station-mode WiFi connection.
    setupArduinoOTA();
    startHttpAndMdns();
  }

  // ---------------- START BLE (replaces WebServer.begin()) ----------------
  startBLEProvisioning();
  delay(300); // let the BLE stack fully settle before we hit it with a Classic BT connect

  // The barcode scanner does NOT start here any more: it connects when the scanner icon on the TFT is touched
  // (touch handler of page 0 in loop()). WiFi, BLE and the cloud telemetry start as before.
#if SCANNER_CONNECT_AT_BOOT
  if (btMacString.length() >= 17) {
    connectScanner();
  }
#endif
}

void loop() {
  unsigned long currentMillis = millis();
  unsigned long page2StartTime = 0;
  bool page2TimerStarted = false;
  esp_task_wdt_reset();

  // LAN OTA (Arduino IDE / espota.py) — cheap to poll, and guarded so it
  // never races with an in-progress BLE or cloud/HTTP firmware transfer.
  if (arduinoOtaActive && !bleFirmwareUpdating && !netFirmwareUpdating) {
    ArduinoOTA.handle();
  }
  if (!bleFirmwareUpdating && !netFirmwareUpdating) {
    maintainNetwork();
  }
  // not while the scanner connects: no WiFi answers during the Bluetooth current peak (the app waits a few seconds)
  if (httpStarted && !bleFirmwareUpdating && !netFirmwareUpdating && !scannerConnecting) {
    httpServer.handleClient();
  }


  processPendingOTACommands();
  if (bleFirmwareUpdating) {
    digitalWrite(HEATER_PIN, LOW);
    for (int i = 0; i < 4; ++i) {
      if (!otaQueueEmpty()) processPendingOTAPacket();
      else break;
      if (!bleFirmwareUpdating) break;
    }
    esp_task_wdt_reset();
    delay(1);
    return;
  }

  // BLE commands arrive asynchronously via BLEConfigCallbacks::onWrite,
  // so there is no polling needed here (unlike the old server.handleClient()
  // / dnsServer.processNextRequest() calls, which have been removed along
  // with the rest of the WebServer/captive-portal code).

  // The phone gave the scanner back (GET /scanner_handback): take it again.
  if (scannerReconnectPending && !scannerConnected && !scannerConnecting && btMacString.length() >= 17) {
    scannerReconnectPending = false;
    lastReconnect = millis();
    startScannerConnect();
  }

  if (scannerConnected && !scannerConnecting && !SerialBT.connected()) { Serial.println("Scanner disconnected"); scannerConnected = false; }

  // "Match-O mode" from the app: the second command, 2 s after the first one
  if (scannerModeStep2At != 0 && (long)(millis() - scannerModeStep2At) >= 0) {
    scannerModeStep2At = 0;
    if (scannerConnected) SerialBT.print("AT+MODE=1");
  }

  // scanner state changed (touch, app, BLE app, link lost): new icon + a line in the activity log
  {
    static int8_t shownScannerState = -1;              // 0 idle, 1 connecting, 2 connected
    int8_t st = scannerConnected ? 2 : (scannerConnecting ? 1 : 0);
    if (st != shownScannerState) {
      if (st == 2) logActivity("Barcode scanner connected");
      else if (st == 1) logActivity("Connecting barcode scanner...");
      else if (shownScannerState == 2) logActivity("Barcode scanner disconnected");
      else if (shownScannerState == 1) logActivity("Barcode scanner: connect failed");
      shownScannerState = st;
      if (page == 0 || page == 4) drawScannerIcon();
    }
  }
  if (scannerConnected)
  {
      while (SerialBT.available())
      {
          char c = SerialBT.read();
          Serial.write(c);

          if (c == '\r' || c == '\n')
          {
              if (barcode.length() > 0)
              {
                  lastScannedBarcode = barcode;

                  // 0. Battery-status line from the scanner itself
                  // ("BAT_VOL=3.98V 84%") - not a real sample/patient
                  // barcode, so handle it separately and skip the rest
                  // of the normal decode pipeline below.
                  if (parseScannerBatteryLine(barcode))
                  {
                      logActivity("Scanner battery " + String(scannerBatteryPercent) + "%");
                      barcode = "";
                      continue;
                  }

                  // every real barcode goes into the scan list of the app (GET /scans)
                  uint32_t scanId = addScan(barcode, barcode.endsWith("_pid"));

                  // 1. Check if it is a Patient ID barcode
                  if (barcode.endsWith("_pid"))
                  {
                      tft.setTextColor(TFT_BLACK, TFT_WHITE);
                      tft.setTextSize(2);
                      tft.setCursor(10, 50);
                      tft.print("Fetching Patient...");

                      String queryId = barcode;
                      queryId.replace("APSCRY_", "");
                      queryId.replace("_pid", "");

                      if (WiFi.status() == WL_CONNECTED) {
                          HTTPClient http;
                          // Use HTTP instead of HTTPS to avoid SSL/TLS handshake failures
                          if (http.begin("http://apssensors.com/match_maker/api.php")) {
                              http.setConnectTimeout(3000);
                              http.setTimeout(5000);
                              http.addHeader("Content-Type", "application/x-www-form-urlencoded");
                              http.addHeader("X-Api-Key", "YOUR_SECRET_API_KEY_123");

                              String postData = "q=" + queryId + "&api_key=YOUR_SECRET_API_KEY_123";
                              int httpCode = http.POST(postData);

                              Serial.printf("[HTTP] Code: %d\n", httpCode);

                              if (httpCode == 200) {
                                  String payload = http.getString();
                                  DynamicJsonDocument doc(1024);
                                  deserializeJson(doc, payload);

                                  if (doc["result"] == "success" && doc["patient"] == "success") {
                                      displayMaleName = doc["data"]["male_name"].as<String>();
                                      displayFemaleName = doc["data"]["female_name"].as<String>();
                                      displayMatchedCol = "";

                                      if (doc.containsKey("storage") && !doc["storage"].isNull()) {
                                          expectedTank = doc["storage"]["tank_id"].as<String>();
                                          expectedCanister = doc["storage"]["canister_id"].as<String>();
                                          expectedGoblet = doc["storage"]["goblet_id"].as<String>();
                                          localMatchMode = true;
                                      } else {
                                          expectedTank = ""; expectedCanister = ""; expectedGoblet = "";
                                          localMatchMode = false;
                                      }
                                  } else {
                                      displayMaleName = "Not Found";
                                      displayFemaleName = "";
                                      localMatchMode = false;
                                  }
                              } else {
                                  Serial.printf("[HTTP] Failed! Error: %s\n", http.errorToString(httpCode).c_str());
                                  displayMaleName = "Server Error";
                              }
                              http.end();
                          } else {
                              Serial.println("[HTTP] Unable to connect");
                              displayMaleName = "No Connection";
                          }
                      } else {
                          displayMaleName = "No WiFi";
                      }
                      checked = 0;
                      setScanResult(scanId, displayMaleName);
                      logActivity("Patient " + queryId + ": " + displayMaleName);
                  }
                  // 2. Check if we are locally matching hardware
                  else if (localMatchMode)
                  {
                      if (barcode == expectedTank) displayMatchedCol = "Tank";
                      else if (barcode == expectedCanister) displayMatchedCol = "Canister";
                      else if (barcode == expectedGoblet) displayMatchedCol = "Goblet";
                      else displayMatchedCol = "Unmatched";
                      setScanResult(scanId, displayMatchedCol);
                      logActivity("Sample " + barcode + ": " + displayMatchedCol);
                  }
                  else
                  {
                      logActivity("Barcode " + barcode);
                  }

                  // 3. Draw the Display
                  if(checked == 0) {
                      tft.fillRect(0, 35, 320, 220, TFT_WHITE);
                      checked = 1;
                  }
                      if(displayMaleName != "" || displayFemaleName != "") {
                          tft.setTextColor(TFT_RED, TFT_WHITE);
                          tft.setTextSize(2);
                          tft.setCursor(10, 50);
                          tft.print("M: " + displayMaleName);
                      }

                      drawMatchIcon(displayMatchedCol);

                  page = 4;
                  barcodeDisplayTimer = millis();
                  barcode = "";
              }
          }
          else
          {
              if(c >= 32 && c <= 126) barcode += c;
          }
      }
  }

  if (page == 4)
  {
      if (millis() - barcodeDisplayTimer >= 30000)
      {
          page = 0;
          checked = 0;
          displayMatchedCol = ""; // clear match state on timeout
          tft.fillScreen(TFT_WHITE);
          tft.fillRect(0, 35, 320, 220, TFT_BLACK);
          tft.pushImage(180, 7, 140, 21, epd_bitmap_allArray[0]);
          drawScannerIcon();
      }
  }
  // --- 1. SERIAL JSON LISTENER (RFID HANDLING) ---
  if (Serial2.available() > 0) {
    String incoming = Serial2.readStringUntil('\n');

    Serial.println(incoming);

    if (incoming.startsWith("{")) {
      StaticJsonDocument<512> doc;
      DeserializationError error = deserializeJson(doc, incoming);

      if (!error) {
        if (doc.containsKey("rfid1") && witnessState == 0) {
          rfid_1_val = doc["rfid1"].as<String>();
          rfid_2_val = "";
          witnessState = 1;
          logActivity("RFID tag 1: " + rfid_1_val);
          page = 3;
          showWitnessResults = false;

          tft.fillScreen(TFT_WHITE);
          tft.fillRect(0, 35, 320, 220, TFT_WHITE);
          tft.pushImage(10, 220, 140, 21, epd_bitmap_allArray[0]);
          tft.pushImage(30, 60, 120, 120, epd_bitmap_allArray5[0]);
        }
        else if (doc.containsKey("rfid2") && witnessState == 1) {
          rfid_2_val = doc["rfid2"].as<String>();
          witnessState = 2;
          logActivity("RFID tag 2: " + rfid_2_val);
          tft.pushImage(160, 60, 120, 120, epd_bitmap_allArray5[0]);

          if (WiFi.status() == WL_CONNECTED) {
            HTTPClient http;
            String url = "http://apssensors.com/match_maker/api/witness_esp.php?rfid_1=" + rfid_1_val + "&rfid_2=" + rfid_2_val + "&nocache=" + String(millis());
            http.begin(url);
            http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
            Serial.println(url);
            http.setTimeout(8000);
            int httpCode = http.GET();

            if (httpCode > 0) {
              Serial.printf("HTTP Code: %d\n", httpCode);
              if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
                String payload = http.getString();
                Serial.println("Payload received:");
                Serial.println(payload);
              StaticJsonDocument<1024> responseDoc;
              DeserializationError rErr = deserializeJson(responseDoc, payload);

              // the result for the app (GET /rfid): a new witnessSeq opens the MATCH / MISMATCH popup
              if (!rErr) {
                witnessResult      = (responseDoc["status"] == "match") ? "match" : "mismatch";
                witnessCode        = jsonText(responseDoc["patient_code"]);
                witnessProcess     = jsonText(responseDoc["process"]);
                witnessStage       = jsonText(responseDoc["stage"]);
                witnessProcessFull = jsonText(responseDoc["process_full"]);
                witnessMessage     = jsonText(responseDoc["message"]);
                witnessMale        = jsonText(responseDoc["male_name"]);
                witnessMaleAge     = jsonText(responseDoc["male_age"]);
                witnessMaleBlood   = jsonText(responseDoc["male_blood"]);
                witnessFemale      = jsonText(responseDoc["female_name"]);
                witnessFemaleAge   = jsonText(responseDoc["female_age"]);
                witnessFemaleBlood = jsonText(responseDoc["female_blood"]);
                witnessSeq++;
                witnessAt = millis();
                if (witnessResult == "match") logActivity("RFID witness: MATCH " + witnessCode);
                else logActivity("RFID witness: MISMATCH");
              } else {
                logActivity("RFID witness: bad answer from server");
              }

              if(responseDoc["status"] == "match"){
              Serial2.println("{\"status\":\"match\"}");
              tft.fillScreen(TFT_WHITE);
              tft.pushImage(10, 220, 140, 21, epd_bitmap_allArray[0]);
              tft.fillRect(0, 0, 320, 40, (responseDoc["status"] == "match") ? TFT_GREEN : TFT_RED);

              tft.setTextColor(TFT_BLACK);
              tft.setTextSize(2);
              tft.setCursor(10, 10);
              tft.print("Status: "); tft.println(responseDoc["status"].as<String>());
              tft.setCursor(10, 50);
              tft.print("Code:"); tft.println(responseDoc["patient_code"].as<String>());
              tft.setCursor(10, 80);
              tft.print("FN:"); tft.print(responseDoc["female_name"].as<String>());
              tft.print("("); tft.print(responseDoc["female_age"].as<String>());tft.print(",");tft.print(responseDoc["female_blood"].as<String>());tft.println(")");
              tft.setCursor(10, 110);
              tft.print("MN:"); tft.print(responseDoc["male_name"].as<String>());
              tft.print("("); tft.print(responseDoc["male_age"].as<String>());tft.print(",");tft.print(responseDoc["male_blood"].as<String>());tft.println(")");
              tft.setCursor(10, 140);
              tft.print("Process: "); tft.println(responseDoc["process"].as<String>());
              witnessTimerStart = millis();
              showWitnessResults = true;
              }
              else
              {
                Serial2.println("{\"status\":\"mismatch\"}");
                tft.fillScreen(TFT_WHITE);
                tft.pushImage(10, 220, 140, 21, epd_bitmap_allArray[0]);
                tft.pushImage(5, 30, 300, 140, epd_bitmap_allArray6[0]);
                witnessTimerStart = millis();
                showWitnessResults = true;
              }
            }
            else {
              // This tells you WHY it failed (e.g., connection refused, timeout)
              Serial.printf("HTTP GET failed, error: %s\n", http.errorToString(httpCode).c_str());
              logActivity("RFID check failed: " + http.errorToString(httpCode));
            }
            http.end();
          } else {
            logActivity("RFID check: no WiFi");
          }
          witnessState = 0;
        }
      }
    }
  }
  }

  // --- 2. THE 15-SECOND TIMER LOGIC (CRITICAL FIX) ---
  if (page == 3 && showWitnessResults) {
    static int lastSecond = -1;
    unsigned long elapsed = (millis() - witnessTimerStart) / 1000;
    int remaining = 15 - (int)elapsed;

    if (remaining >= 0) {
      // Only update the screen once per second to prevent flickering
      if (remaining != lastSecond) {
        tft.fillRect(250, 210, 70, 30, TFT_WHITE);
        tft.setTextColor(TFT_BLACK, TFT_WHITE);
        tft.setTextSize(2);
        tft.setCursor(260, 215);
        tft.print(remaining);
        tft.print("s");
        lastSecond = remaining;
      }
    } else {
      showWitnessResults = false;
      lastSecond = -1;
      page = 0;
      tft.fillScreen(TFT_WHITE);
      tft.fillRect(0, 35, 320, 220, TFT_BLACK);
      tft.pushImage(180, 7, 140, 21, epd_bitmap_allArray[0]);
      drawScannerIcon();
    }
  }

  // --- 3. TOUCH HANDLING ---
  uint16_t x, y;
  bool pressed = tft.getTouch(&x, &y);
  x = 320 - x;
  y = 240 - y;

  if (pressed) {
    if (page == 1) {
      char pressedKey = getKey(x, y);
      if (pressedKey != '\0') {
        delay(1000);
        int cursorX = 60 + (inputIndex * 20);
        tft.setTextSize(3);
        tft.setTextColor(TFT_BLACK, TFT_WHITE);
        tft.setCursor(cursorX, 60);
        tft.println(pressedKey);

        if (inputIndex < 4) {
          inputBuffer[inputIndex++] = pressedKey;
          inputBuffer[inputIndex] = '\0';
        }

        if (inputIndex == 4) {
          if (strcmp(inputBuffer, "2325") == 0) {
            tft.fillScreen(TFT_WHITE);
            inputIndex = 0; inputBuffer[0] = '\0';
            page = 2;
          } else {
            tft.setCursor(10, 90);
            tft.println("Incorrect code");
            inputIndex = 0; inputBuffer[0] = '\0';
            delay(1000);
            tft.fillScreen(TFT_WHITE);
            tft.fillRect(0, 35, 320, 220, TFT_BLACK);
            tft.pushImage(180, 7, 140, 21, epd_bitmap_allArray[0]);
            drawScannerIcon();
            page = 0;
          }
        }
      }
    }
    else if (page == 0) {
      if(x < 70 && x > 40 && y < 210 && y > 180) {page = 1;}
      if(x < 180 && x > 160 && y < 45 && y > 25){
        // touch on the scanner icon: connect the barcode scanner (in the background, the screen keeps running).
        // It also takes the scanner back from the Android screen.
        if (!scannerConnected && !scannerConnecting && millis() - lastReconnect > 3000) {
          lastReconnect = millis();
          scannerHeldByScreen = false;
          scannerReconnectPending = false;
          startScannerConnect();
        }
      }
    }
    else if (page == 2) {
      if(x < 275 && x > 244 && y < 130 && y > 99) {
        storeFloatInEEPROM(readFloatFromEEPROM() - 0.1);
        page2StartTime = millis(); // activity detected — restart the 15s countdown
      } else if(x < 57 && x > 35 && y < 126 && y > 91) {
        storeFloatInEEPROM(readFloatFromEEPROM() + 0.1);
        page2StartTime = millis(); // activity detected — restart the 15s countdown
      } else if(x < 206 && x > 40 && y < 132 && y > 91) {
        page = 0;
        page2TimerStarted = false;
        tft.fillScreen(TFT_WHITE);
        tft.fillRect(0, 35, 320, 220, TFT_BLACK);
        tft.pushImage(180, 7, 140, 21, epd_bitmap_allArray[0]);
        drawScannerIcon();
      }
    }
  }

  if(page == 0){
    static unsigned long previousMillis = 0;
  const unsigned long interval = 2000;
  unsigned long currentMillis = millis();
  int32_t rssi = WiFi.RSSI();
  int signalStrength = map(rssi, -50, -100, 10, 0);
rawTemp = maxthermo->temperature(100.0, 430.0);
float calibratedTemp = rawTemp - readFloatFromEEPROM();

if (firstReading) {
  filteredTemp = calibratedTemp;
  firstReading = false;
} else {
  filteredTemp = (calibratedTemp - 40.0) * (70.0 - 40.0) / (70.0 - 40.0) + 40.0;
}
tmpp = filteredTemp;
  temperature = tmpp;
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis; // Update the interval
     if(temperature < 37.0){z++; if(z == 6){z = 0;if(z1 == 0){z1 = 1;}else{z1=0;}}
     if(z1 == 0){
     tft.fillRect(10, 160, 90, 10, TFT_BLUE);
    verticalBarGraph(z, 20, 140, 10, 15, "", RED2RED);
     }
    if(z1 == 1){
      tft.fillRect(10, 160, 90, 10, TFT_BLUE);
    verticalBarGraph(z, 20, 140, 10, 15, "", GREEN2RED);
    }
  }
  else
  {
    tft.fillRect(10, 160, 90, 10, TFT_WHITE);
    verticalBarGraph(6, 20, 140, 10, 15, "", BLACK2BLACK);
  }
     static float lastSentTemperature = 0;

        if (temperature != lastSentTemperature) {
           y++; if(y==10){y=0; sendTemperatureData();}
            lastSentTemperature = temperature;
        }
    ringMeter(37, 10, 38, 230, 150, 45, "OV", GREEN2RED);
    ringMeter(temperature, 10, 38, 130, 45, 60, "CT", GREEN2RED);
  tft.pushImage(5, 7, 20, 20, epd_bitmap_allArray1[0]);

  if (signalStrength > 25) {
      tft.fillCircle(40, 15, 8, TFT_RED);
      tft.fillCircle(60, 15, 8, TFT_WHITE);
      tft.fillCircle(80, 15, 8, TFT_WHITE);
    } else if (signalStrength <= 8) {

      tft.fillCircle(40, 15, 8, TFT_ORANGE);
      tft.fillCircle(60, 15, 8, TFT_ORANGE);
      tft.fillCircle(80, 15, 8, TFT_WHITE);
    } else if (signalStrength < 15 && signalStrength >= 9) {
      tft.fillCircle(40, 15, 8, TFT_GREEN);
      tft.fillCircle(60, 15, 8, TFT_GREEN);
      tft.fillCircle(80, 15, 8, TFT_GREEN);
    }
    printFormattedDate(); // Print date/time
 }

 if (WiFi.status() != WL_CONNECTED && (millis() - previousNetworkCheckMillis >= networkCheckInterval)) {
    previousNetworkCheckMillis = millis();
    WiFi.reconnect();
    if (WiFi.status() != WL_CONNECTED) {
      tft.fillCircle(40, 15, 8, TFT_RED);
      tft.fillCircle(60, 15, 8, TFT_WHITE);
      tft.fillCircle(80, 15, 8, TFT_WHITE);
    } else {
      tft.fillCircle(40, 15, 8, TFT_GREEN);
      tft.fillCircle(60, 15, 8, TFT_BLUE);
      tft.fillCircle(80, 15, 8, TFT_RED);
      delay(1000);
    }
}
}
  if(page == 1)
{
  z2++; if(z2 == 1){tft.pushImage(0, 0, 320, 240, epd_bitmap_keypadallArray[0]);}
  z3 = 0;
}

if (page == 2)
{
  z2 = 0;
  z3++;
  if (z3 == 1)
  {
    tft.pushImage(0, 0, 320, 240, epd_bitmap_calallArray[0]);
    page2StartTime = millis();     // start (or restart) the inactivity countdown
    page2TimerStarted = true;
  }
     tmpp = ((rawTemp - 10)-readFloatFromEEPROM());
  tft.fillRect(185, 202, 100, 30, TFT_CYAN);
  tft.setTextSize(3);
  tft.setTextColor(TFT_BLACK);
  tft.setCursor(190, 205);
 if(tmpp == -127){}else{ tft.print(tmpp);}
  tft.fillRect(100, 102, 120, 40, TFT_PINK);
  tft.setTextSize(4);
  tft.setCursor(105, 105);
  tft.print(readFloatFromEEPROM());

  // --- Auto-exit to home after 15s of no key press on this page ---
  if (page2TimerStarted && (millis() - page2StartTime >= 15000))
  {
    page = 0;
    page2TimerStarted = false;
    z3 = 0;
    tft.fillScreen(TFT_WHITE);
    tft.fillRect(0, 35, 320, 220, TFT_BLACK);
    tft.pushImage(180, 7, 140, 21, epd_bitmap_allArray[0]);
    drawScannerIcon();
  }
}
}

void printFormattedDate() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    tft.fillRect(0, 190, 200, 50, TFT_BLACK);
    tft.setTextSize(2);
    tft.setTextColor(TFT_RED);
    tft.setCursor(6, 195);
    tft.print("No Time Sync");
    return;
  }

  char dateStr[16];
  char timeStr[16];
  strftime(dateStr, sizeof(dateStr), "%d/%m/%y", &timeinfo);
  strftime(timeStr, sizeof(timeStr), "%H:%M:%S", &timeinfo);

  tft.fillRect(0, 190, 220, 50, TFT_BLACK);
  tft.setTextSize(2);
  tft.setTextColor(TFT_WHITE);
  tft.setCursor(6, 195);
  tft.print(dateStr);
  tft.print("|");
  tft.print(timeStr);
  tft.drawLine(0, 215, 190, 215, TFT_WHITE);
  tft.setTextColor(TFT_YELLOW);
  tft.setCursor(35, 218);
  tft.setTextSize(2);
  tft.print("APSDWM " + String(lastFive));
}

void getDateTime(String &dateStr, String &timeStr) {
  time_t now = time(nullptr);
  struct tm *ti = localtime(&now);

  char dateBuf[20];
  char timeBuf[20];

  sprintf(dateBuf, "%02d/%02d/%02d",
          ti->tm_mday, ti->tm_mon + 1, (ti->tm_year + 1900) % 100);

  sprintf(timeBuf, "%02d:%02d:%02d",
          ti->tm_hour, ti->tm_min, ti->tm_sec);

  dateStr = dateBuf;
  timeStr = timeBuf;
}

// -----------------------------------------------------------
// TELEMETRY (temperature/RSSI upload only — no "upgrade" flag
// is read back any more, since cloud OTA has been removed)
// -----------------------------------------------------------
void sendTemperatureData() {
  if (WiFi.status() != WL_CONNECTED) return;

  float tempC = maxthermo->temperature(100.0, 430.0);
  int currentRssi = WiFi.RSSI();

  String postData = "mc=APSDWM_" + String(lastFive) +
                     "&tmp=" + String(tempC) +
                     "&rssi=" + String(currentRssi);

  http.begin(client, serverName);
  http.setConnectTimeout(2000);   // the default waits much longer; loop() (and GET /data for the app) is blocked meanwhile
  http.setTimeout(2500);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");

  int httpCode = http.POST(postData);
  if (httpCode > 0) {
    Serial.println("Cloud Response: " + http.getString());
  } else {
    Serial.printf("[Telemetry] POST failed: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}

int ringMeter(float value, int vmin, int vmax, int x, int y, int r, const char *units, byte scheme)
{
  // Minimum value of r is about 52 before value text intrudes on ring
  x += r;
  y += r; // Calculate coords of centre of ring

  int w = r / 4; // Width of outer ring is 1/4 of radius
  int angle = 150; // Half the sweep angle of meter (300 degrees)
  float v = map(value, vmin, vmax, -angle, angle); // Map the value to an angle v

  byte seg = 3; // Segments are 3 degrees wide = 100 segments for 300 degrees
  byte inc = 6; // Draw segments every 3 degrees, increase to 6 for segmented ring

  int colour = TFT_BLUE;

  for (int i = -angle + inc / 2; i < angle - inc / 2; i += inc)
  {
    float sx = cos((i - 90) * 0.0174532925);
    float sy = sin((i - 90) * 0.0174532925);
    uint16_t x0 = sx * (r - w) + x;
    uint16_t y0 = sy * (r - w) + y;
    uint16_t x1 = sx * r + x;
    uint16_t y1 = sy * r + y;

    float sx2 = cos((i + seg - 90) * 0.0174532925);
    float sy2 = sin((i + seg - 90) * 0.0174532925);
    int x2 = sx2 * (r - w) + x;
    int y2 = sy2 * (r - w) + y;
    int x3 = sx2 * r + x;
    int y3 = sy2 * r + y;

    if (i < v)
    {
      switch (scheme)
      {
      case 0:
        colour = TFT_RED;
        break;
      case 1:
        colour = TFT_GREEN;
        break;
      case 2:
        colour = TFT_BLUE;
        break;
      case 3:
        colour = rainbow(map(i, -angle, angle, 0, 127));
        break;
      case 4:
        colour = rainbow(map(i, -angle, angle, 70, 127));
        break;
      case 5:
        colour = rainbow(map(i, -angle, angle, 127, 63));
        break;
      default:
        colour = TFT_BLUE;
        break;
      }
      tft.fillTriangle(x0, y0, x1, y1, x2, y2, colour);
      tft.fillTriangle(x1, y1, x2, y2, x3, y3, colour);
    }
    else
    {
      tft.fillTriangle(x0, y0, x1, y1, x2, y2, TFT_GREY);
      tft.fillTriangle(x1, y1, x2, y2, x3, y3, TFT_GREY);
    }
  }
  char buf[10];
    byte len = 4;
  if (value > 999.0)
    len = 4;
  dtostrf(value, len, 2, buf);  // Ensure 2 decimal places
  buf[len] = ' ';
  buf[len + 1] = 0;
  tft.setTextSize(1);

   tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextColor(colour, TFT_BLACK);
  tft.setTextDatum(MC_DATUM);
  if (r > 84)
  {
    tft.setTextPadding(55 * 3);
    tft.drawString(buf, x, y, 8);
  }
  else
  {
    tft.setTextPadding(3 * 14);
    tft.drawString(buf, x, y, 4);
  }
  tft.setTextSize(1);
  tft.setTextPadding(0);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  if (r > 84)
    tft.drawString(units, x, y + 80, 4);
  else
    tft.drawString(units, x, y + 30, 2);

  return x + r;
}

unsigned int rainbow(byte value)
{
  byte red = 0;
  byte green = 0;
  byte blue = 0;

  byte quadrant = value / 32;

  if (quadrant == 0)
  {
    blue = 31;
    green = 2 * (value % 32);
    red = 0;
  }
  if (quadrant == 1)
  {
    blue = 31 - (value % 32);
    green = 63;
    red = 0;
  }
  if (quadrant == 2)
  {
    blue = 0;
    green = 63;
    red = value % 32;
  }
  if (quadrant == 3)
  {
    blue = 0;
    green = 63 - 2 * (value % 32);
    red = 31;
  }
  return (red << 11) + (green << 5) + blue;
}
void verticalBarGraph(int value, int x, int y, int barWidth, int barHeight, const char *units, byte scheme) {
  int numBars = 5;
  int gap = 5;

  int barHeights[numBars];
  if (value == 0) {
    for (int i = 0; i < numBars; i++) {
      barHeights[i] = 1;
    }
  } else {
    for (int i = 0; i < numBars; i++) {
      barHeights[i] = map(value, 0, 1, 0, barHeight);
    }
  }

  for (int i = 0; i < numBars; i++) {
    int barX = x + i * (barWidth + gap);
    int barY = y + barHeight - barHeights[i];

    int colour;
    switch (scheme) {
      case 0:
        colour = TFT_BLUE;
        break;
      case 1:
        colour = TFT_GREEN;
        break;
      case 2:
        colour = TFT_BLUE;
        break;
      case 3:
        colour = rainbow(map(i, 0, numBars - 1, 0, 127));
        break;
      case 4:
        colour = rainbow(map(i, 0, numBars - 1, 70, 127));
        break;
      case 5:
        colour = rainbow(map(i, 0, numBars - 1, 127, 63));
        break;
      case 6:
        colour = TFT_BLACK;
        break;
      case 7:
        colour = TFT_RED;
        break;
      case 8: // BLACK2BLACK
        colour = TFT_BLACK;
        break;
      default:
        colour = TFT_BLUE;
        break;
    }

    tft.fillRect(barX, barY, barWidth, barHeights[i], colour);

    if (value == 0) {
      tft.drawLine(barX, y + barHeight - 1, barX + barWidth - 1, y + barHeight - 1, colour);
    }
  }

  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextDatum(MC_DATUM);
  tft.drawString(units, x + (numBars * (barWidth + gap)) / 2, y + barHeight + 10, 2);
}

char getKey(uint16_t tx, uint16_t ty) {
    // Key 1
    if (tx > 255 && tx < 285 && ty > 117 && ty < 143) return '1';
    // Key 2
    else if (tx > 206 && tx < 235 && ty > 119 && ty < 142) return '2';
    // Key 3
    else if (tx > 145 && tx < 165 && ty > 104 && ty < 135) return '3';
    // Key 4
    else if (tx > 84 && tx < 103 && ty > 111 && ty < 133) return '4';
    // Key 5
    else if (tx > 34 && tx < 46 && ty > 118 && ty < 136) return '5';
    // Key 6
    else if (tx > 244 && tx < 275 && ty > 182 && ty < 206) return '6';
    // Key 7
    else if (tx > 199 && tx < 228 && ty > 188 && ty < 201) return '7';
    // Key 8
    else if (tx > 143 && tx < 157 && ty > 184 && ty < 204) return '8';
    // Key 9
    else if (tx > 77 && tx < 104 && ty > 183 && ty < 206) return '9';
    // Key 0
    else if (tx > 24 && tx < 42 && ty > 180 && ty < 205) return '0';

    return '\0'; // No key pressed
}

void handleHeaterBackground() {
  // 1. Read temperature
  float raw = maxthermo->temperature(100.0, 430.0);
  float calTemp = raw - readFloatFromEEPROM();

  // 2. Simple Heater Logic (hysteresis band: ON at/below 36.0, OFF at/above 37.0)
  if (calTemp <= 36.0) {
    digitalWrite(HEATER_PIN, HIGH);
  } else if (calTemp >= 37.0) {
    digitalWrite(HEATER_PIN, LOW);
  }

  // Update the global temperature variable so the LCD shows it later
  temperature = calTemp;
}

// Colour used for the OTA progress bar/badge — distinguishes at a glance
// which path is updating: cyan for Network (priority path), orange for
// the Bluetooth fallback path. Falls back to white if source is unknown.
static uint16_t otaSourceColor() {
  if (currentOtaSource == "Network") return TFT_CYAN;
  if (currentOtaSource == "LAN") return TFT_GREEN;
  if (currentOtaSource == "Bluetooth") return TFT_ORANGE;
  return TFT_WHITE;
}

void drawOTAStartScreen() {
  tft.fillScreen(TFT_BLACK);

  uint16_t badgeColor = otaSourceColor();

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(10, 15);
  tft.println("Firmware Update");

  // Source badge — makes it obvious whether this is the priority
  // Network OTA or the Bluetooth fallback.
  tft.fillRoundRect(10, 45, 130, 24, 4, badgeColor);
  tft.setTextColor(TFT_BLACK, badgeColor);
  tft.setTextSize(1);
  tft.setCursor(18, 53);
  tft.print("via ");
  tft.print(currentOtaSource);

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(10, 80);
  tft.println("Updating...");

  tft.setCursor(10, 95);
  tft.println("Do not power off");
}

// Shared OTA progress UI for both the Bluetooth chunked path and the
// Network (WiFi/HTTP) path. Reads currentOtaSource to label/colour the
// bar so the user (and the app, via the "otaSource" field) can always
// tell which transport is actively flashing.
void drawBLEOtaProgress(unsigned int received, unsigned int total) {
  if (total == 0) return;

  int percent = (received * 100UL) / total;
  if (percent > 100) percent = 100;

  uint16_t barColor = otaSourceColor();

  // Clear progress area
  tft.fillRect(10, 95, 220, 65, TFT_BLACK);

  tft.setTextColor(barColor, TFT_BLACK);
  tft.setTextSize(1);
  tft.setCursor(10, 98);
  tft.print("via ");
  tft.print(currentOtaSource);

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(10, 112);
  tft.printf("%u%%", percent);

  // Progress bar
  int barWidth = 200;
  int filled = (barWidth * percent) / 100;

  tft.drawRect(10, 140, barWidth, 15, TFT_WHITE);

  if (filled > 4) {
    tft.fillRect(12, 142, filled - 4, 11, barColor);
  }
}

// -----------------------------------------------------------
// LAN OTA — ArduinoOTA (Arduino IDE / espota.py, by IP address)
//
// This is what most people mean by "network OTA" for an Arduino/ESP32
// board: no cloud server, no URL — the IDE (Tools > Port > Network
// Port) or the espota.py tool talks straight to this device's local
// IP over the LAN and pushes the compiled .bin directly. Only usable
// while the device has a station-mode WiFi connection (not in the
// BLE-config AP fallback).
// -----------------------------------------------------------
void setupArduinoOTA() {
  ArduinoOTA.setHostname(("APSHGW_" + lastFive).c_str());   // same name as the mDNS/HTTP service

  // Uncomment and set a password if you want the Arduino IDE / espota.py
  // to require one before it can push firmware to this device:
  // ArduinoOTA.setPassword("your-password-here");

  ArduinoOTA.onStart([]() {
    // A LAN OTA push always wins immediately — if a BLE or cloud/HTTP
    // update happens to already be running, abort it first so two
    // writers never touch the OTA partition at once.
    if (bleFirmwareUpdating) { bleFirmwareUpdating = false; Update.abort(); }
    if (netFirmwareUpdating) { otaAbortRequested = true; }

    arduinoOtaInProgress = true;
    currentOtaSource = "LAN";
    pauseHeaterForOTA();
    digitalWrite(HEATER_PIN, LOW);
    drawOTAStartScreen();
    Serial.println("ArduinoOTA (LAN): update starting");
  });

  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    drawBLEOtaProgress(progress, total);
    esp_task_wdt_reset();
  });

  ArduinoOTA.onEnd([]() {
    // ArduinoOTA restarts the device itself right after this callback —
    // no explicit ESP.restart() needed here.
    arduinoOtaInProgress = false;
    Serial.println("ArduinoOTA (LAN): update complete, restarting");
  });

  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("ArduinoOTA (LAN) error [%u]\n", (unsigned)error);
    arduinoOtaInProgress = false;
    resumeHeaterAfterOTA();
    digitalWrite(HEATER_PIN, LOW);
  });

  ArduinoOTA.begin();
  arduinoOtaActive = true;

  Serial.println("ArduinoOTA (LAN) ready: APSHGW_" + lastFive +
                  " @ " + WiFi.localIP().toString());
}

// -----------------------------------------------------------
// NETWORK (WiFi/HTTP) OTA — the PRIORITY update path.
//
// Called from handleBLECommand("FW_START") whenever the app includes a
// "url" and the device currently has WiFi. Downloads the .bin directly
// from that URL and streams it into the OTA partition, reusing the same
// TFT progress UI, EEPROM "pending"/"success" bookkeeping, and FW_ABORT
// handling as the Bluetooth chunked path. On any failure it leaves the
// device exactly as the BLE path would (heater resumed, Update aborted)
// so the app can retry — including falling back to Bluetooth OTA itself
// by re-issuing FW_START without a "url".
// -----------------------------------------------------------
bool performNetworkOTA(const String &url, const String &version) {
  if (bleFirmwareUpdating) {
    bleNotify("{\"status\":\"fw_error\",\"message\":\"ble_update_in_progress\"}");
    return false;
  }
  if (netFirmwareUpdating) {
    bleNotify("{\"status\":\"fw_error\",\"message\":\"network_update_in_progress\"}");
    return false;
  }

  if (Update.isRunning()) Update.abort();
  pauseHeaterForOTA();
  digitalWrite(HEATER_PIN, LOW);

  HTTPClient otaHttp;
  Serial.println("Network OTA: fetching " + url);

  if (!otaHttp.begin(url)) {
    resumeHeaterAfterOTA();
    bleNotify("{\"status\":\"fw_error\",\"message\":\"net_connect_failed\"}");
    return false;
  }
  otaHttp.setTimeout(15000);
  otaHttp.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  int httpCode = otaHttp.GET();
  if (httpCode != HTTP_CODE_OK) {
    otaHttp.end();
    resumeHeaterAfterOTA();
    StaticJsonDocument<256> out;
    out["status"] = "fw_error"; out["message"] = "net_http_error"; out["code"] = httpCode;
    String resp; serializeJson(out, resp); bleNotify(resp);
    return false;
  }

  int contentLength = otaHttp.getSize();
  const esp_partition_t* ota = esp_ota_get_next_update_partition(nullptr);
  size_t otaPartSize = ota ? ota->size : 0;

  if (contentLength <= 0 || !ota || (size_t)contentLength > otaPartSize) {
    otaHttp.end();
    resumeHeaterAfterOTA();
    StaticJsonDocument<256> out;
    out["status"] = "fw_error"; out["message"] = "invalid_size";
    out["size"] = contentLength; out["partitionSize"] = otaPartSize;
    String resp; serializeJson(out, resp); bleNotify(resp);
    return false;
  }

  if (!Update.begin((size_t)contentLength, U_FLASH)) {
    otaHttp.end();
    resumeHeaterAfterOTA();
    StaticJsonDocument<256> out;
    out["status"] = "fw_error"; out["message"] = "update_begin_failed";
    out["reason"] = Update.errorString();
    String resp; serializeJson(out, resp); bleNotify(resp);
    return false;
  }

  netFirmwareUpdating = true;
  currentOtaSource = "Network";
  saveOtaPending(version, ota->address);
  drawOTAStartScreen();

  Serial.printf("Network OTA target partition: %s, address=0x%08lx, size=%u bytes\n",
                ota->label, (unsigned long)ota->address, (unsigned)ota->size);
  Serial.printf("Network OTA started: %d bytes, free sketch space=%u bytes\n",
                contentLength, (unsigned)otaPartSize);

  {
    StaticJsonDocument<256> out;
    out["status"] = "fw_ready";
    out["source"] = "network";
    out["size"] = contentLength;
    out["partitionSize"] = otaPartSize;
    out["currentVersion"] = MATCHO_FW_VERSION;
    String resp; serializeJson(out, resp); bleNotify(resp);
  }

  WiFiClient *stream = otaHttp.getStreamPtr();
  uint8_t buf[1024];
  size_t written = 0;
  unsigned long lastProgressNotify = 0;
  unsigned long lastDataAt = millis();
  const unsigned long streamStallTimeoutMs = 20000; // give up if the stream stalls this long

  bool aborted = false;
  bool failed = false;

  while (written < (size_t)contentLength) {
    // FW_ABORT can arrive on the BLE stack task at any time while this
    // loop blocks the main task — poll the same flag the BLE-chunk path
    // uses so a single command aborts either OTA path.
    if (otaAbortRequested) {
      otaAbortRequested = false;
      aborted = true;
      break;
    }

    if (!otaHttp.connected()) { failed = true; break; }

    size_t avail = stream->available();
    if (avail == 0) {
      if (millis() - lastDataAt > streamStallTimeoutMs) { failed = true; break; }
      esp_task_wdt_reset();
      delay(2);
      continue;
    }

    size_t toRead = min(avail, sizeof(buf));
    int readBytes = stream->readBytes(buf, toRead);
    if (readBytes <= 0) { failed = true; break; }
    lastDataAt = millis();

    size_t w = Update.write(buf, readBytes);
    if (w != (size_t)readBytes) {
      Serial.printf("Network OTA flash write failed: %u/%d\n", (unsigned)w, readBytes);
      failed = true;
      break;
    }

    written += w;
    esp_task_wdt_reset();
    drawBLEOtaProgress(written, (size_t)contentLength);

    if (millis() - lastProgressNotify > 500) {
      lastProgressNotify = millis();
      StaticJsonDocument<128> prog;
      prog["status"] = "fw_progress";
      prog["source"] = "network";
      prog["received"] = written;
      prog["expected"] = contentLength;
      String progResp; serializeJson(prog, progResp); bleNotify(progResp);
    }
  }

  otaHttp.end();
  netFirmwareUpdating = false;

  if (aborted) {
    Update.abort();
    resumeHeaterAfterOTA();
    clearOtaStatus();
    digitalWrite(HEATER_PIN, LOW);
    bleNotify("{\"status\":\"fw_aborted\"}");
    return false;
  }

  if (failed || written != (size_t)contentLength) {
    Update.abort();
    resumeHeaterAfterOTA();
    StaticJsonDocument<256> out;
    out["status"] = "fw_error"; out["message"] = "size_mismatch_or_stream_error";
    out["received"] = written; out["expected"] = contentLength;
    String resp; serializeJson(out, resp); bleNotify(resp);
    return false;
  }

  esp_task_wdt_reset();
  if (!Update.end(true)) {
    resumeHeaterAfterOTA();
    char errMsg[180];
    snprintf(errMsg, sizeof(errMsg),
             "{\"status\":\"fw_error\",\"message\":\"update_end_failed\",\"reason\":\"%s\"}",
             Update.errorString());
    bleNotify(String(errMsg));
    return false;
  }

  digitalWrite(HEATER_PIN, LOW);
  tft.fillScreen(TFT_WHITE);
  tft.setTextColor(TFT_BLACK, TFT_WHITE);
  tft.setTextSize(3);
  tft.setCursor(45, 130);
  tft.print("Updating...");
  bleNotify("{\"status\":\"fw_written\",\"source\":\"network\",\"restarting\":true}");
  delay(300);
  ESP.restart();
  return true; // unreachable — ESP.restart() does not return
}
