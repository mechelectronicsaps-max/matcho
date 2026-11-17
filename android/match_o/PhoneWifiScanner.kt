package com.example.match_o

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.wifi.ScanResult
import android.net.wifi.WifiManager
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/* ================================================================
 *  WIFI SCAN WITH THE PHONE'S OWN RADIO
 *
 *  The phone finds the WiFi networks (like Android Settings > WiFi).
 *  The user picks one, types the password, and only SSID + password
 *  are sent to the MATCH-O unit over BLE (SET_WIFI). The unit does
 *  not scan any more: a scan on the ESP32 switches its WiFi mode and
 *  blocks it for seconds while BLE and Classic Bluetooth are running.
 *
 *  The ESP32 only works on 2.4 GHz: 5 GHz networks are listed but
 *  marked as not usable.
 * ================================================================ */

data class PhoneWifiNetwork(
    val ssid: String,
    val rssi: Int,
    val secured: Boolean,
    val is24GHz: Boolean            // false = 5 / 6 GHz: the MATCH-O unit cannot join it
)

object PhoneWifiScanner {

    /** the permissions the scan still needs (Android 13+: NEARBY_WIFI_DEVICES, before: location) */
    fun missingPermissions(context: Context): List<String> {
        val needed = ArrayList<String>()
        needed += Manifest.permission.ACCESS_FINE_LOCATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed += Manifest.permission.NEARBY_WIFI_DEVICES
        }
        return needed.filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
    }

    /** Android returns NO scan results while Location is switched off (up to Android 12 always, later on many phones) */
    fun isLocationOn(context: Context): Boolean {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return true
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) lm.isLocationEnabled
        else lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    fun isWifiOn(context: Context): Boolean =
        (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.isWifiEnabled == true

    /**
     * Starts a scan and waits (max 10 s) for the result. Android limits apps to 4 scans in 2 minutes:
     * when the scan is refused, the last results the phone has are used (they are a few seconds old at most).
     */
    @SuppressLint("MissingPermission")
    suspend fun scan(context: Context): List<PhoneWifiNetwork> {
        val app = context.applicationContext
        val wifi = app.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return emptyList()
        if (missingPermissions(app).isNotEmpty()) return emptyList()

        val done = CompletableDeferred<Unit>()
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                done.complete(Unit)
            }
        }
        val filter = IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            app.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            app.registerReceiver(receiver, filter)
        }

        try {
            @Suppress("DEPRECATION")
            val started = try { wifi.startScan() } catch (_: SecurityException) { false }
            if (started) withTimeoutOrNull(10_000) { done.await() }
        } finally {
            try { app.unregisterReceiver(receiver) } catch (_: Exception) { }
        }

        val results: List<ScanResult> = try { wifi.scanResults } catch (_: SecurityException) { emptyList() }

        // one line per SSID (the strongest access point), no hidden networks, strongest first
        return results
            .mapNotNull { r ->
                val ssid = ssidOf(r)
                if (ssid.isBlank()) null
                else PhoneWifiNetwork(
                    ssid = ssid,
                    rssi = r.level,
                    secured = r.capabilities.contains("WPA") || r.capabilities.contains("WEP") ||
                            r.capabilities.contains("SAE") || r.capabilities.contains("EAP"),
                    is24GHz = r.frequency in 2400..2500
                )
            }
            .groupBy { it.ssid }
            .map { (_, same) ->
                // a network that has a 2.4 GHz access point counts as usable, even when its 5 GHz one is stronger
                val best24 = same.filter { it.is24GHz }.maxByOrNull { it.rssi }
                best24 ?: same.maxBy { it.rssi }
            }
            .sortedWith(compareByDescending<PhoneWifiNetwork> { it.is24GHz }.thenByDescending { it.rssi })
    }

    @Suppress("DEPRECATION")
    private fun ssidOf(r: ScanResult): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            (r.wifiSsid?.toString() ?: "").removeSurrounding("\"")
        } else {
            r.SSID ?: ""
        }
}
