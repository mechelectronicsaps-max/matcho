package com.example.onetouch.ui.dashboard

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.Socket
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/* ---------------------------------------------------------------
 *  ROUTER MODE : finds the APS devices that are on the same network (router) as this panel.
 *  It works like your ApsSensors app (NsdDiscoveryManager + NetworkScreen):
 *
 *    1. mDNS : every device announces itself as  _apsvoc._tcp  (VOC)  or  _apstm._tcp  (LABTM).
 *              This is the main way, the same one your phone app uses.      (see SERVICE_TYPES)
 *    2. SWEEP: besides that, every address of the local network (/24) is asked for /data.
 *              This finds devices that do not announce themselves by mDNS (other device types).
 *    3. POLL : every device found is asked for  GET http://<ip>:<port>/data  every 3 seconds.
 *              A device that does not answer 3 times in a row is removed.
 *    4. MESH : a device with  meshClients > 0  relays other devices:  GET /mesh_nodes  lists them.
 *
 *  /data answers e.g.  {"device":"APSV1A2B3","type":"VOC","tvoc":254,"aqi":2,"temperature":..,"humidity":..,
 *                       "rssi":-61,"ip":"..","mac":"..","meshClients":1, ...}
 *  Older firmware sends no "type": it is then guessed from the device name (APSTM... = LABTM, APSV... = VOC).
 * --------------------------------------------------------------- */

/** mDNS service names of the devices. Must match  MDNS.addService(...)  in the firmware. Add more types here. */
private val SERVICE_TYPES = listOf(
    "_apsvoc._tcp.",      // VOC / AQI monitor
    "_apstm._tcp.",       // temperature / humidity monitor (LABTM)
    "_apsdwm._tcp.",      // warmer / MATCH-O unit (APSDWM_xxxxx, older firmware)
    "_apshgw._tcp."       // MATCH-O unit (APSHGW_xxxxx)
)

private const val TAG = "OneTouchRouter"
private const val POLL_MS = 3000L                // every device is asked for /data this often
private const val SWEEP_EVERY_MS = 20_000L       // the address sweep is repeated this often
private const val MAX_FAILURES = 12              // answers missed in a row before a device is removed (about 36 seconds:
// a unit that is busy with its barcode scanner may answer late)
private const val STALE_AFTER = 2                // answers missed in a row before a device is shown as OFFLINE (still listed)

data class NetworkDevice(
    val name: String,                // "APSV1A2B3"
    val ip: String,
    val typeId: String,              // device id used by the grid: "voc", "ln2" ...
    val rawType: String,             // text from the device: "VOC"
    val json: JSONObject,
    val viaMesh: Boolean = false,    // found through another device (mesh relay)
    val port: Int = 80,
    val stale: Boolean = false       // it did not answer the last polls: shown as OFFLINE until it answers again
)

/** type text sent by the device  ->  device id used in the app (the text is lowercased, symbols removed) */
private val TYPE_ALIASES = mapOf(
    "heatingglass" to "heating_glass", "heating" to "heating_glass",
    "ln2" to "ln2",
    "voc" to "voc", "vocmonitor" to "voc",
    "labtm" to "labtm", "tm" to "labtm", "temphum" to "labtm",
    "airvoc" to "airvoc",
    "particleana" to "particle_ana", "particle" to "particle_ana",
    "warmer" to "warmer",
    "dynave" to "dyna_ve", "dyna" to "dyna_ve",
    "matcho" to "cryomate", "matchcryo" to "cryomate", "cryomate" to "cryomate",
    "benchtop" to "benchtop", "bench" to "benchtop",
    "boxincubator" to "box_incubator", "incubator" to "box_incubator",
    "fertico" to "fertico",
)

/** the device type: from the "type" text, or (older firmware without it) guessed from the device name */
private fun typeIdFor(rawType: String, deviceName: String): String? {
    TYPE_ALIASES[rawType.lowercase().filter { it.isLetterOrDigit() }]?.let { return it }
    val n = deviceName.uppercase()
    return when {
        n.startsWith("APSTM") -> "labtm"
        n.startsWith("APSLN2") -> "ln2"
        n.startsWith("APSAIR") -> "airvoc"
        n.startsWith("APSVD") -> "dyna_ve"
        n.startsWith("APSV") -> "voc"
        n.startsWith("APSHGW") -> "cryomate"
        n.startsWith("APSDWMCF") -> "heating_glass"
        n.startsWith("APSDWM") -> "warmer"
        n.startsWith("APSRT") -> "particle_ana"
        else -> null
    }
}

/** the answer of a device to one call from the screen: HTTP code + text */
class HttpAnswer(val code: Int, val body: String)

/** one address we talk to (found by mDNS or by the sweep) */
private class Target(val key: String, val host: String, val port: Int) {
    var device: NetworkDevice? = null
    var failures = 0
}

class RouterScanner(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("onetouch_router", Context.MODE_PRIVATE)

    /** devices found right now */
    var devices: List<NetworkDevice> by mutableStateOf(emptyList())
        private set

    /** true while an address sweep is running */
    var scanning: Boolean by mutableStateOf(false)
        private set

    /** how many addresses of the sweep are done / total (for a progress text) */
    var progress: Pair<Int, Int> by mutableStateOf(0 to 0)
        private set

    /** e.g. "No network connection" */
    var problem: String? by mutableStateOf(null)
        private set

    /** what the search is doing, for the radar screen: the address of this screen and how many addresses answered */
    var info: String by mutableStateOf("")
        private set

    /** how the devices were found, for the Logcat / texts: "mDNS 2, sweep 1" */
    var source: String by mutableStateOf("")
        private set

    private val targets = LinkedHashMap<String, Target>()                  // "ip:port" -> target
    private val riders = HashMap<String, List<NetworkDevice>>()           // gateway key -> devices behind it
    private var mdnsCount = 0
    private var sweepCount = 0

    /* ---------- addresses typed in by hand, and addresses where a device was found before ---------- */

    private fun savedAddresses(): Set<String> = prefs.getStringSet("ips", emptySet()) ?: emptySet()

    /**
     * The user typed the address of a unit (for example 192.168.1.115). It is asked at every start, even when the
     * search cannot find it (another subnet, a router that blocks the search ...).
     */
    fun addAddress(text: String): Boolean {
        val ip = text.trim()
        val parts = ip.split(".")
        if (parts.size != 4 || parts.any { p -> p.toIntOrNull()?.let { it in 0..255 } != true }) return false
        prefs.edit().putStringSet("ips", savedAddresses() + ip).apply()
        return true
    }

    private fun addSavedTargets() {
        for (ip in savedAddresses()) {
            val key = "$ip:80"
            if (targets[key] == null) targets[key] = Target(key, ip, 80)
        }
    }

    private fun rememberAddress(ip: String) {
        val saved = savedAddresses()
        if (ip !in saved && saved.size < 30) prefs.edit().putStringSet("ips", saved + ip).apply()
    }

    /** asks ONE address right now and says what happened in words (for the ADD button) */
    suspend fun testAddress(text: String): String = withContext(Dispatchers.IO) {
        val ip = text.trim()
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(ip, 80), 3000)
                socket.soTimeout = 5000
                socket.getOutputStream().apply {
                    write("GET /data HTTP/1.0\r\nHost: $ip\r\nConnection: close\r\n\r\n".toByteArray())
                    flush()
                }
                val reply = socket.getInputStream().bufferedReader().readText()
                val code = reply.substringBefore("\r\n").split(" ").getOrNull(1) ?: "?"
                val body = reply.substringAfter("\r\n\r\n", "")
                val device = parseDevice(body, ip, 80, viaMesh = false)
                if (device != null) "$ip answers: ${device.name} (${device.rawType}). It is listed in a moment."
                else "$ip answered (HTTP $code), but it is not an APS device: " + body.take(60).replace("\n", " ")
            }
        } catch (e: Exception) {
            "No answer from $ip (${e.javaClass.simpleName}). This screen cannot reach that address. " +
                    info.ifBlank { "Is the screen on the same WiFi as the unit?" }
        }
    }

    /** device id -> how many devices of that kind are on the network */
    val counts: Map<String, Int>
        get() = devices.groupingBy { it.typeId }.eachCount()

    /** forget everything (called when the user switches to Router, so the radar starts again) */
    fun reset() {
        targets.clear()
        riders.clear()
        mdnsCount = 0
        sweepCount = 0
        devices = emptyList()
        problem = null
        progress = 0 to 0
        source = ""
        info = ""
    }

    /**
     * Runs until the caller is cancelled (= the user leaves Router mode):
     * mDNS discovery + address sweep + polling of every device found.
     */
    suspend fun run(): Unit = coroutineScope {
        addSavedTargets()                       // the typed-in addresses and the places where devices were found before: asked at once

        // 1) mDNS: the devices announce themselves
        launch {
            runCatching {
                discoverMdns().collect { found ->
                    val key = "${found.host}:${found.port}"
                    if (targets[key] == null) {
                        targets[key] = Target(key, found.host, found.port)
                        mdnsCount++
                        Log.d(TAG, "mDNS found ${found.host}:${found.port}")
                        pollNow(targets.getValue(key))          // do not wait for the next round
                    }
                }
            }.onFailure { Log.w(TAG, "mDNS stopped: ${it.message}") }
        }

        // 2) every address of the network is asked once in a while (finds devices without mDNS)
        launch {
            while (true) {
                runCatching { sweep() }.onFailure { Log.w(TAG, "sweep failed: ${it.message}") }
                delay(SWEEP_EVERY_MS)
            }
        }

        // 3) all devices are asked for their data every 3 seconds
        while (true) {
            problem = if (hasNetwork()) null else "No network connection"
            addSavedTargets()                   // an address typed in a moment ago is asked in this round
            pollAll()
            delay(POLL_MS)
        }
    }

    /**
     * One call from the screen to a device (activity, offset, scanner commands ...).
     * Returns null when the device does not answer; otherwise the HTTP code (200 = done, 403 = wrong password ...) and the text.
     */
    suspend fun call(device: NetworkDevice, path: String, readMs: Int = 4000): HttpAnswer? =
        withContext(Dispatchers.IO) { httpRequest(device.ip, device.port, path, 1500, readMs) }

    /* ---------- polling ---------- */

    private suspend fun pollNow(target: Target) {
        val body = withContext(Dispatchers.IO) { httpGet(target.host, target.port, "/data", connectMs = 1500, readMs = 4000) }
        applyResult(target, body)
        publish()
    }

    private suspend fun pollAll() {
        val snapshot = targets.values.toList()
        if (snapshot.isNotEmpty()) {
            val gate = Semaphore(12)
            val answers = coroutineScope {
                snapshot.map { t ->
                    async(Dispatchers.IO) {
                        t to gate.withPermit { httpGet(t.host, t.port, "/data", connectMs = 1500, readMs = 4000) }
                    }
                }.awaitAll()
            }
            answers.forEach { (target, body) -> applyResult(target, body) }
            publish()
        }

        // devices that relay other devices (meshClients > 0): ask them who is behind them
        val gateways = targets.values.filter { (it.device?.json?.optInt("meshClients", 0) ?: 0) > 0 }
        if (gateways.isEmpty()) {
            if (riders.isNotEmpty()) { riders.clear(); publish() }
        } else {
            val lists = coroutineScope {
                gateways.map { g -> async(Dispatchers.IO) { g.key to meshChildren(g.host, g.port) } }.awaitAll()
            }
            riders.clear()
            lists.forEach { (key, list) -> riders[key] = list }
            publish()
        }
    }

    /** a device that answered is shown, one that stays silent 3 times in a row is removed */
    private fun applyResult(target: Target, body: String?) {
        val device = body?.let { parseDevice(it, target.host, target.port, viaMesh = false) }
        if (device != null) {
            target.device = device
            target.failures = 0
            rememberAddress(target.host)
        } else {
            target.failures++
            if (target.failures >= MAX_FAILURES) {
                targets.remove(target.key)
                riders.remove(target.key)
            }
        }
    }

    private fun publish() {
        val all = LinkedHashMap<String, NetworkDevice>()
        targets.values.mapNotNull { t -> t.device?.let { d -> if (t.failures >= STALE_AFTER) d.copy(stale = true) else d } }
            .forEach { all[it.name] = it }
        riders.values.flatten().forEach { if (it.name !in all) all[it.name] = it }
        devices = all.values.toList()
        source = "mDNS $mdnsCount, sweep $sweepCount"
    }

    /* ---------- the address sweep ---------- */

    private suspend fun sweep() {
        val subnet = localSubnet()
        if (subnet == null) {
            Log.w(TAG, "sweep: this panel has no IPv4 address on its active network")
            info = "This screen has no IPv4 address on a WiFi or cable network. Is it connected to the router?"
            return
        }
        scanning = true
        try {
            val hosts = hostsOf(subnet.first, subnet.second)
            Log.d(TAG, "sweep: panel address ${ipText(subnet.first)}/${subnet.second}, asking ${hosts.size} addresses")
            progress = 0 to hosts.size
            info = "This screen: ${ipText(subnet.first)}/${subnet.second}  -  asking ${hosts.size} addresses"
            val done = AtomicInteger(0)
            val gate = Semaphore(40)

            val found = coroutineScope {
                hosts.map { ip ->
                    async(Dispatchers.IO) {
                        val body = gate.withPermit { httpGet(ip, 80, "/data", connectMs = 800, readMs = 3000) }
                        val n = done.incrementAndGet()
                        if (n % 8 == 0 || n == hosts.size) progress = n to hosts.size
                        body?.let { parseDevice(it, ip, 80, viaMesh = false) }
                    }
                }.awaitAll().filterNotNull()
            }

            Log.d(TAG, "sweep: ${found.size} device(s) answered")
            info = "This screen: ${ipText(subnet.first)}/${subnet.second}  -  ${hosts.size} addresses asked, ${found.size} answered"

            found.forEach { device ->
                val key = "${device.ip}:80"
                if (targets[key] == null) {
                    targets[key] = Target(key, device.ip, 80).also { it.device = device }
                    sweepCount++
                    Log.d(TAG, "sweep found ${device.name} at ${device.ip}")
                }
            }
            publish()
        } finally {
            scanning = false
        }
    }

    /* ---------- mDNS (NsdManager), same as NsdDiscoveryManager of the ApsSensors app ---------- */

    private class Announced(val host: String, val port: Int)

    private fun discoverMdns(): Flow<Announced> = callbackFlow {
        val nsd = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
        val wifi = appContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

        // mDNS needs multicast packets, which Android suppresses unless this lock is held
        // (needs the permission CHANGE_WIFI_MULTICAST_STATE in the manifest)
        val lock = runCatching {
            wifi.createMulticastLock("onetouch-mdns").apply { setReferenceCounted(true); acquire() }
        }.onFailure { Log.w(TAG, "multicast lock: ${it.message}") }.getOrNull()

        // only one resolveService() may run at a time -> a queue
        val queue = ArrayDeque<NsdServiceInfo>()
        var resolving = false
        lateinit var resolveNext: () -> Unit

        val resolveListener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "resolve failed ${serviceInfo.serviceName}: $errorCode")
                resolving = false
                resolveNext()
            }

            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                resolving = false
                val host = serviceInfo.host?.hostAddress
                if (host != null && !host.contains(':')) {                // IPv4 only
                    trySend(Announced(host, if (serviceInfo.port > 0) serviceInfo.port else 80))
                }
                resolveNext()
            }
        }

        resolveNext = {
            if (!resolving) {
                val next = queue.removeFirstOrNull()
                if (next != null) {
                    resolving = true
                    runCatching { nsd.resolveService(next, resolveListener) }.onFailure { resolving = false }
                }
            }
        }

        val listeners = SERVICE_TYPES.map { type ->
            object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(regType: String) { Log.d(TAG, "mDNS discovery started: $regType") }
                override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                    queue.addLast(serviceInfo)
                    resolveNext()
                }
                override fun onServiceLost(serviceInfo: NsdServiceInfo) {}      // devices are removed when they stop answering
                override fun onDiscoveryStopped(regType: String) {}
                override fun onStartDiscoveryFailed(regType: String, errorCode: Int) {
                    Log.e(TAG, "mDNS start failed $regType: $errorCode")
                    runCatching { nsd.stopServiceDiscovery(this) }
                }
                override fun onStopDiscoveryFailed(regType: String, errorCode: Int) {}
            }.also { listener ->
                runCatching { nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener) }
                    .onFailure { Log.e(TAG, "discoverServices $type: ${it.message}") }
            }
        }

        awaitClose {
            listeners.forEach { runCatching { nsd.stopServiceDiscovery(it) } }
            runCatching { lock?.release() }
        }
    }

    /* ---------- reading one device ---------- */

    private fun parseDevice(body: String, ip: String, port: Int, viaMesh: Boolean): NetworkDevice? = try {
        val json = JSONObject(body)
        val rawType = json.optString("type")
        val name = json.optString("device")
        val typeId = typeIdFor(rawType, name)
        if (name.isBlank() || typeId == null) null
        else NetworkDevice(name, json.optString("ip", ip).ifBlank { ip }, typeId, rawType.ifBlank { name.take(5) }, json, viaMesh, port)
    } catch (e: Exception) {
        null
    }

    private fun meshChildren(parentIp: String, port: Int): List<NetworkDevice> {
        val body = httpGet(parentIp, port, "/mesh_nodes", connectMs = 800, readMs = 6000) ?: return emptyList()
        return try {
            val array = JSONArray(body)
            (0 until array.length()).mapNotNull { i ->
                val node = array.optJSONObject(i) ?: return@mapNotNull null
                val data = node.optJSONObject("data") ?: return@mapNotNull null          // not reachable -> not shown
                parseDevice(data.toString(), node.optString("ip"), port, viaMesh = true)
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * Tiny HTTP GET on a plain socket. (A raw socket is not blocked by Android's "no http://" rule,
     * so no network-security-config is needed for the local devices.)
     */
    private fun httpGet(host: String, port: Int, path: String, connectMs: Int, readMs: Int): String? {
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), connectMs)
                socket.soTimeout = readMs
                socket.getOutputStream().apply {
                    write("GET $path HTTP/1.0\r\nHost: $host\r\nConnection: close\r\n\r\n".toByteArray())
                    flush()
                }
                val text = socket.getInputStream().bufferedReader().readText()
                if (!text.startsWith("HTTP/1.") || !text.contains(" 200")) null
                else text.substringAfter("\r\n\r\n", "").ifBlank { null }
            }
        } catch (e: Exception) {
            null
        }
    }

    /** like httpGet, but the HTTP code is returned too (403 / 409 answers are not thrown away) */
    private fun httpRequest(host: String, port: Int, path: String, connectMs: Int, readMs: Int): HttpAnswer? {
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), connectMs)
                socket.soTimeout = readMs
                socket.getOutputStream().apply {
                    write("GET $path HTTP/1.0\r\nHost: $host\r\nConnection: close\r\n\r\n".toByteArray())
                    flush()
                }
                val text = socket.getInputStream().bufferedReader().readText()
                if (!text.startsWith("HTTP/1.")) null
                else {
                    val code = text.substringBefore("\r\n").split(" ").getOrNull(1)?.toIntOrNull() ?: 0
                    HttpAnswer(code, text.substringAfter("\r\n\r\n", ""))
                }
            }
        } catch (e: Exception) {
            null
        }
    }

    /* ---------- the network of this panel ---------- */

    private fun hasNetwork(): Boolean {
        val cm = appContext.getSystemService(ConnectivityManager::class.java) ?: return false
        return cm.activeNetwork != null
    }

    /** own IPv4 address (as number) + prefix length of the network the panel is connected to */
    @Suppress("DEPRECATION")
    private fun localSubnet(): Pair<Long, Int>? {
        val cm = appContext.getSystemService(ConnectivityManager::class.java) ?: return null
        val active = cm.activeNetwork
        // the active network first; then every other WiFi / cable network (the active one can be a VPN or mobile data)
        val candidates = listOfNotNull(active) + cm.allNetworks.filter { it != active }
        for (network in candidates) {
            if (network != active) {
                val caps = cm.getNetworkCapabilities(network) ?: continue
                if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) continue
            }
            val link = cm.getLinkProperties(network) ?: continue
            val address = link.linkAddresses.firstOrNull {
                it.address is Inet4Address && !it.address.isLoopbackAddress
            } ?: continue
            val b = address.address.address
            val ip = ((b[0].toLong() and 255) shl 24) or ((b[1].toLong() and 255) shl 16) or
                    ((b[2].toLong() and 255) shl 8) or (b[3].toLong() and 255)
            return ip to address.prefixLength
        }
        return null
    }

    private fun ipText(ip: Long): String = "${(ip shr 24) and 255}.${(ip shr 16) and 255}.${(ip shr 8) and 255}.${ip and 255}"

    /** every host address of the network (never more than one /24 = 254 addresses), without our own */
    private fun hostsOf(ip: Long, prefixLength: Int): List<String> {
        if (prefixLength in 16..23) {
            // A bigger network (for example 192.168.0.0/16, where this screen is 192.168.0.x and a unit is 192.168.1.x):
            // the /24 blocks of it are asked, our own first, then the nearest ones (at most 8 blocks, about 2000 addresses).
            val bigMask = (0xFFFFFFFFL shl (32 - prefixLength)) and 0xFFFFFFFFL
            val bigNetwork = ip and bigMask
            val blocks = 1 shl (24 - prefixLength)
            val ownBlock = ((ip - bigNetwork) shr 8).toInt()
            return (0 until blocks)
                .sortedBy { kotlin.math.abs(it - ownBlock) }
                .take(8)
                .flatMap { block -> (1..254).map { host -> bigNetwork + (block.toLong() shl 8) + host } }
                .filter { it != ip }
                .map { ipText(it) }
        }
        val prefix = prefixLength.coerceIn(24, 30)              // otherwise: only scan the /24 around us
        val mask = (0xFFFFFFFFL shl (32 - prefix)) and 0xFFFFFFFFL
        val network = ip and mask
        val broadcast = network or (mask.inv() and 0xFFFFFFFFL)
        return ((network + 1) until broadcast)
            .filter { it != ip }
            .map { "${(it shr 24) and 255}.${(it shr 16) and 255}.${(it shr 8) and 255}.${it and 255}" }
    }
}

/* ---------------------------------------------------------------
 *  What to show on the card of each device type (label + value),
 *  read from the JSON the device sends.
 *  VOC uses the real field names from your sketch (tvoc). The other devices are ASSUMPTIONS -
 *  change the keys ("temperature", "level", "pm25" ...) to what those devices really send.
 * --------------------------------------------------------------- */
fun deviceInfoFrom(typeId: String, json: JSONObject): List<DeviceInfo> {
    fun number(key: String, decimals: Int = 0): String? =
        if (json.has(key)) String.format(Locale.ENGLISH, "%.${decimals}f", json.optDouble(key)) else null

    val lines = ArrayList<DeviceInfo>()
    when (typeId) {
        "voc"           -> number("tvoc")?.let { lines += DeviceInfo("VOC", "$it ppb") }
        "airvoc",
        "dyna_ve"       -> number("aqi")?.let { lines += DeviceInfo("AQI", it) }
        "heating_glass",
        "warmer"        -> number("temperature")?.let { lines += DeviceInfo("TEMP", "$it°C") }
        "labtm"         -> {
            number("temperature")?.let { lines += DeviceInfo("TEMP", "$it°C") }
            number("humidity")?.let { lines += DeviceInfo("HUM", "$it%") }
        }
        "ln2"           -> if (json.has("level")) lines += DeviceInfo("LEVEL", json.optString("level").uppercase())
        "particle_ana"  -> number("pm25")?.let { lines += DeviceInfo("PM2.5", "$it µg/m³") }
    }
    return lines
}

/** card data for every device type that was found on the network (first device of each type) */
fun RouterScanner.cardData(): Map<String, List<DeviceInfo>> =
    devices.groupBy { it.typeId }.mapValues { (typeId, list) -> deviceInfoFrom(typeId, list.first().json) }