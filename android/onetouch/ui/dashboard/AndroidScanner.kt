package com.example.onetouch.ui.dashboard

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID

/* ================================================================
 *  THE BARCODE SCANNER CONNECTED TO THIS ANDROID SCREEN
 *
 *  The screen opens the Bluetooth (SPP) link to the scanner by itself, reads the barcodes, asks the server what
 *  they mean (the same call the Match-O unit makes) and shows the result. Nothing is exchanged with the unit.
 *  (A scanner can be connected to ONE device at a time: the unit has to let it go first.)
 *
 *  It lives here, not in a screen: the link stays up while you move between pages, and it comes back by itself
 *  when it breaks.
 * ================================================================ */

/** one scanned barcode */
class ScannedItem(
    val id: Long,
    val time: Long,            // milliseconds since 1970
    val code: String,
    val kind: String,          // "patient" (ends with _pid) or "sample"
    val result: String         // the patient name, "Tank", "Canister", "Goblet", "Unmatched", "Not Found" ...
)

/** the battery of the scanner */
class ScannerBattery(val percent: Int, val volts: Double, val at: Long)

/** what the server answered for a patient barcode */
class PatientInfo(
    val found: Boolean,
    val male: String = "",
    val female: String = "",
    val tank: String = "",
    val canister: String = "",
    val goblet: String = "",
    val error: String = ""
) {
    /** true when the server sent the storage places: the next barcodes are then compared with them */
    val hasStorage: Boolean get() = tank.isNotBlank() || canister.isNotBlank() || goblet.isNotBlank()
}

object AndroidScanner {

    // ---------------------------------------------------------------
    //  WHERE A BARCODE IS PARSED  -  the same address and key the Match-O unit uses (see the sketch:
    //  http://apssensors.com/match_maker/api.php).  Change them here.
    // ---------------------------------------------------------------
    const val PATIENT_URL = "http://apssensors.com/match_maker/api.php"
    const val API_KEY = "YOUR_SECRET_API_KEY_123"

    enum class LinkState { DISCONNECTED, CONNECTING, CONNECTED }

    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private const val PREFS = "onetouch_scanner"
    private const val BATTERY_EVERY_MS = 300_000L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()                        // barcodes are handled one after the other

    private val _state = MutableStateFlow(LinkState.DISCONNECTED)
    val state: StateFlow<LinkState> = _state.asStateFlow()

    private val _mac = MutableStateFlow("")
    val mac: StateFlow<String> = _mac.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _battery = MutableStateFlow<ScannerBattery?>(null)
    val battery: StateFlow<ScannerBattery?> = _battery.asStateFlow()

    private val _batteryPending = MutableStateFlow(false)
    val batteryPending: StateFlow<Boolean> = _batteryPending.asStateFlow()

    private val _scans = MutableStateFlow<List<ScannedItem>>(emptyList())
    val scans: StateFlow<List<ScannedItem>> = _scans.asStateFlow()

    private val _patient = MutableStateFlow<PatientInfo?>(null)
    val patient: StateFlow<PatientInfo?> = _patient.asStateFlow()

    /**
     * Called when this screen lets the barcode scanner go (DISCONNECT pressed, or the link was lost and could not be
     * opened again). MainActivity sets it: it tells the Match-O unit "GET /scanner_handback", and the unit takes the
     * scanner back (it tries by itself a few times: a scanner that was just let go is often refused for a moment).
     */
    @Volatile
    var onReleased: (() -> Unit)? = null

    private var appContext: Context? = null
    private var socket: BluetoothSocket? = null
    private var readJob: Job? = null
    private var reconnectJob: Job? = null
    private var batteryJob: Job? = null
    private var userWantsLink = false                 // false after the user pressed DISCONNECT
    private var nextId = 1L

    // ---------------------------------------------------------------
    //  permissions and the adapter
    // ---------------------------------------------------------------

    /** the permissions that still have to be asked for (forSearch = also for searching nearby devices) */
    fun missingPermissions(context: Context, forSearch: Boolean): List<String> {
        val needed = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= 31) {
            needed += Manifest.permission.BLUETOOTH_CONNECT
            if (forSearch) needed += Manifest.permission.BLUETOOTH_SCAN
        } else if (forSearch) {
            needed += Manifest.permission.ACCESS_FINE_LOCATION
        }
        return needed.filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
    }

    fun adapter(context: Context): BluetoothAdapter? =
        (context.applicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    /** the paired devices as (name, MAC) */
    @SuppressLint("MissingPermission")
    fun pairedDevices(context: Context): List<Pair<String, String>> = try {
        adapter(context)?.bondedDevices.orEmpty().map { (it.name ?: "") to it.address.uppercase() }
    } catch (e: SecurityException) {
        emptyList()
    }

    @SuppressLint("MissingPermission")
    fun deviceName(device: BluetoothDevice): String = try {
        device.name ?: ""
    } catch (e: SecurityException) {
        ""
    }

    /** the scanner that was connected last time */
    fun savedMac(context: Context): String =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("mac", "") ?: ""

    // ---------------------------------------------------------------
    //  connect / disconnect
    // ---------------------------------------------------------------

    /** opens the link to the scanner; the answer is in [state] and [message] */
    fun connect(context: Context, address: String) {
        val app = context.applicationContext
        appContext = app
        val mac = address.trim().uppercase()
        if (!Regex("^([0-9A-F]{2}:){5}[0-9A-F]{2}$").matches(mac)) {
            _message.value = "Not a valid MAC address (AA:BB:CC:DD:EE:FF)"
            return
        }
        if (_state.value == LinkState.CONNECTING) return
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("mac", mac).apply()
        userWantsLink = true
        reconnectJob?.cancel()
        scope.launch { connectNow(app, mac) }
    }

    fun disconnect() {
        userWantsLink = false
        reconnectJob?.cancel()
        batteryJob?.cancel()
        readJob?.cancel()
        closeSocket()
        _state.value = LinkState.DISCONNECTED
        _battery.value = null
        _batteryPending.value = false
        _message.value = "Disconnected"
        onReleased?.invoke()
    }

    @SuppressLint("MissingPermission")
    private suspend fun connectNow(app: Context, mac: String) {
        readJob?.cancel()
        closeSocket()
        _mac.value = mac
        _state.value = LinkState.CONNECTING
        _message.value = null

        val adapter = adapter(app)
        if (adapter == null) return fail("This screen has no Bluetooth")
        if (!adapter.isEnabled) return fail("Bluetooth is switched off")
        if (missingPermissions(app, false).isNotEmpty()) return fail("Bluetooth permission is missing")

        try {
            adapter.cancelDiscovery()                         // a search in progress makes the connect fail
            val device = adapter.getRemoteDevice(mac)
            val s = openSocket(device)
            socket = s
            _state.value = LinkState.CONNECTED
            _message.value = "Connected"
            startReader(s)
            startBatteryRequests()
        } catch (e: SecurityException) {
            fail("Bluetooth permission is missing")
        } catch (e: Exception) {
            fail("Could not connect: " + (e.message ?: "the scanner did not answer") + ". Is it switched on and free (not connected to the unit)?")
        }
    }

    @SuppressLint("MissingPermission")
    private fun openSocket(device: BluetoothDevice): BluetoothSocket {
        try {
            val s = device.createRfcommSocketToServiceRecord(SPP_UUID)
            s.connect()
            return s
        } catch (e: IOException) {
            // some scanners only accept the "insecure" kind of link
            val s = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
            s.connect()
            return s
        }
    }

    private fun fail(text: String) {
        closeSocket()
        _state.value = LinkState.DISCONNECTED
        _message.value = text
    }

    private fun closeSocket() {
        try {
            socket?.close()
        } catch (e: IOException) {
            // already closed
        }
        socket = null
    }

    /** the link broke by itself: it is opened again (3, 5, 8, 12, 20 and 30 seconds later) */
    private fun onLinkLost() {
        closeSocket()
        batteryJob?.cancel()
        _state.value = LinkState.DISCONNECTED
        if (!userWantsLink) return
        _message.value = "The link was lost - connecting again..."
        val app = appContext ?: return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            for (wait in longArrayOf(3000, 5000, 8000, 12000, 20000, 30000)) {
                delay(wait)
                if (!userWantsLink || _state.value != LinkState.DISCONNECTED) return@launch
                connectNow(app, _mac.value)
                if (_state.value == LinkState.CONNECTED) return@launch
            }
            _message.value = "The scanner is not answering. Press CONNECT to try again."
            onReleased?.invoke()                       // the unit may take the scanner back
        }
    }

    // ---------------------------------------------------------------
    //  reading what the scanner sends
    // ---------------------------------------------------------------
    private fun startReader(s: BluetoothSocket) {
        readJob?.cancel()
        readJob = scope.launch {
            val input = s.inputStream
            val buffer = ByteArray(256)
            val line = StringBuilder()
            var lastByteAt = System.currentTimeMillis()
            try {
                while (isActive) {
                    if (input.available() > 0) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        for (i in 0 until n) {
                            val c = (buffer[i].toInt() and 0xFF).toChar()
                            if (c == '\r' || c == '\n') {
                                if (line.isNotEmpty()) {
                                    val text = line.toString()
                                    line.setLength(0)
                                    handleLine(text)
                                }
                            } else if (c.code in 32..126) {
                                line.append(c)
                            }
                        }
                        lastByteAt = System.currentTimeMillis()
                    } else {
                        // a line without an end (the scanner may not send one) is taken after a short pause
                        if (line.isNotEmpty() && System.currentTimeMillis() - lastByteAt > 400) {
                            val text = line.toString()
                            line.setLength(0)
                            handleLine(text)
                        }
                        delay(25)
                    }
                }
            } catch (e: IOException) {
                // the link is gone
            }
            if (socket === s) onLinkLost()
        }
    }

    private fun handleLine(text: String) {
        if (parseBattery(text)) return                    // "BAT_VOL=3.98V 84%" is not a barcode
        scope.launch { process(text) }
    }

    // ---------------------------------------------------------------
    //  commands to the scanner
    // ---------------------------------------------------------------
    private fun send(text: String): Boolean {
        val s = socket ?: return false
        return try {
            s.outputStream.write(text.toByteArray(Charsets.US_ASCII))
            s.outputStream.flush()
            true
        } catch (e: IOException) {
            false
        }
    }

    fun requestBattery() {
        scope.launch {
            if (!send("%BAT_VOL#")) {
                _message.value = "The scanner is not connected"
                return@launch
            }
            _batteryPending.value = true
            delay(6000)
            _batteryPending.value = false
        }
    }

    /** wireless = the scanner works on its own;  not wireless = the Match-O (Bluetooth SPP) mode */
    fun setMode(wireless: Boolean) {
        scope.launch {
            val ok = if (wireless) {
                send("%#IFSNO\$1")
            } else {
                val first = send("%#IFSNO\$4")            // Bluetooth, then 2 s later the SPP profile
                delay(2000)
                first && send("AT+MODE=1")
            }
            _message.value = if (!ok) "The scanner is not connected"
            else if (wireless) "Wireless mode sent to the scanner" else "Match-O mode sent to the scanner"
        }
    }

    /** asks for the battery 3 s after the connect, then every 5 minutes */
    private fun startBatteryRequests() {
        batteryJob?.cancel()
        batteryJob = scope.launch {
            delay(3000)
            while (isActive && _state.value == LinkState.CONNECTED) {
                requestBattery()
                delay(BATTERY_EVERY_MS)
            }
        }
    }

    /** "BAT_VOL=3.98V 84%", "BAT_VOL=3.98V", "BAT_VOL=3980mV 84%": the percent is worked out from the voltage when missing */
    private fun parseBattery(text: String): Boolean {
        val at = text.indexOf("BAT_VOL")
        if (at < 0) return false
        val rest = text.substring(at + 7)
        var volts = -1.0
        var percent = -1
        for (m in Regex("""(\d+(?:\.\d+)?)\s*(mV|mv|V|v|%)?""").findAll(rest)) {
            val number = m.groupValues[1].toDouble()
            when (m.groupValues[2]) {
                "%" -> percent = (number + 0.5).toInt()
                "mV", "mv" -> if (volts < 0) volts = number / 1000.0
                "V", "v" -> if (volts < 0) volts = number
                else -> if (volts < 0 && m.groupValues[1].contains('.')) volts = number
            }
        }
        if (volts != -1.0 && (volts < 2.5 || volts > 5.5)) volts = -1.0
        if (percent !in 0..100) percent = -1
        if (volts < 0 && percent < 0) return false
        if (percent < 0) percent = percentFromVolts(volts)
        _battery.value = ScannerBattery(percent, volts, System.currentTimeMillis())
        _batteryPending.value = false
        return true
    }

    private fun percentFromVolts(v: Double): Int {
        val volts = doubleArrayOf(3.30, 3.50, 3.60, 3.70, 3.80, 3.90, 4.00, 4.15)
        val pcts = intArrayOf(0, 8, 15, 30, 50, 70, 85, 100)
        if (v <= volts[0]) return 0
        for (i in 1 until volts.size) {
            if (v <= volts[i]) return pcts[i - 1] + ((v - volts[i - 1]) * (pcts[i] - pcts[i - 1]) / (volts[i] - volts[i - 1])).toInt()
        }
        return 100
    }

    // ---------------------------------------------------------------
    //  what a scanned barcode means  (the same steps as the Match-O unit)
    //    1. ends with "_pid"  -> a patient: the server is asked, the names and the storage places come back
    //    2. anything else     -> compared with the storage places of that patient: Tank / Canister / Goblet / Unmatched
    // ---------------------------------------------------------------
    private suspend fun process(code: String) = lock.withLock {
        val isPatient = code.endsWith("_pid")
        val id = nextId++
        addScan(ScannedItem(id, System.currentTimeMillis(), code, if (isPatient) "patient" else "sample", ""))

        if (isPatient) {
            setResult(id, "Fetching patient...")
            val info = lookupPatient(code)
            _patient.value = info
            setResult(id, if (info.found) info.male.ifBlank { "Patient found" } else info.error)
        } else {
            val patient = _patient.value
            if (patient != null && patient.found && patient.hasStorage) {
                setResult(
                    id,
                    when (code) {
                        patient.tank -> "Tank"
                        patient.canister -> "Canister"
                        patient.goblet -> "Goblet"
                        else -> "Unmatched"
                    }
                )
            }
        }
    }

    private fun addScan(item: ScannedItem) {
        _scans.value = (listOf(item) + _scans.value).take(30)
    }

    private fun setResult(id: Long, result: String) {
        _scans.value = _scans.value.map {
            if (it.id == id) ScannedItem(it.id, it.time, it.code, it.kind, result) else it
        }
    }

    /** asks the server about a patient barcode */
    private fun lookupPatient(code: String): PatientInfo {
        val query = code.replace("APSCRY_", "").replace("_pid", "")
        var connection: HttpURLConnection? = null
        return try {
            connection = URL(PATIENT_URL).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.connectTimeout = 5000
            connection.readTimeout = 6000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            connection.setRequestProperty("X-Api-Key", API_KEY)
            val body = "q=" + URLEncoder.encode(query, "UTF-8") + "&api_key=" + URLEncoder.encode(API_KEY, "UTF-8")
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }

            if (connection.responseCode != 200) return PatientInfo(false, error = "Server Error")
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            val o = JSONObject(text)
            if (o.optString("result") == "success" && o.optString("patient") == "success") {
                val data = o.optJSONObject("data")
                val storage = o.optJSONObject("storage")
                PatientInfo(
                    found = true,
                    male = jsonText(data, "male_name"),
                    female = jsonText(data, "female_name"),
                    tank = jsonText(storage, "tank_id"),
                    canister = jsonText(storage, "canister_id"),
                    goblet = jsonText(storage, "goblet_id")
                )
            } else {
                PatientInfo(false, error = "Not Found")
            }
        } catch (e: Exception) {
            PatientInfo(false, error = "No Connection")
        } finally {
            connection?.disconnect()
        }
    }

    /** a text of a JSON object; a missing value or null gives "" (not the word "null") */
    private fun jsonText(o: JSONObject?, key: String): String =
        if (o == null || o.isNull(key)) "" else o.optString(key)
}