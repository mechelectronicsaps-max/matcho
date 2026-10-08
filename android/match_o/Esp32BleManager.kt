package com.example.match_o

import kotlinx.coroutines.cancel
import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.channels.Channel
import org.json.JSONObject
import java.util.UUID
import kotlin.math.min

class Esp32BleManager(
    private val context: Context
) {

    companion object {

        /*
         * ============================================================
         * ESP32 BLE UUID
         * ============================================================
         *
         * THESE MUST MATCH THE ESP32 ARDUINO CODE.
         */

        val SERVICE_UUID: UUID =
            UUID.fromString(
                "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
            )

        val CHARACTERISTIC_UUID: UUID =
            UUID.fromString(
                "beb5483e-36e1-4688-b7f5-ea07361b26a8"
            )

        const val DEVICE_NAME_PREFIX = "MATCH-O_"

        private const val PREFS_NAME = "ble_prefs"
        private const val KEY_AUTO_CONNECT_MAC = "auto_connect_mac"

        /*
         * OTA packet:
         *
         * Byte 0      = 0xF1
         * Byte 1..4   = sequence number
         * Byte 5..N   = firmware data
         */
        private const val OTA_HEADER = 5

        /*
         * Maximum payload we try to send.
         * Actual size is limited by negotiated MTU.
         */
        private const val DEFAULT_CHUNK = 239

        /*
         * How long to wait for the ESP32's fw_ack for a single OTA
         * packet before treating it as failed.
         *
         * Bumped from 5000ms -> 8000ms. With DEFAULT_CHUNK capped at
         * 100 bytes, a large .bin needs a lot of write/ack round trips;
         * this gives a bit more margin against normal BLE link jitter
         * on top of the GET_DATA-polling fix in MainActivity.kt (which
         * is the real fix for uploads stalling/timing out).
         */
        // OTA data uses reliable WRITE_TYPE_DEFAULT GATT writes. The Android
        // GATT onCharacteristicWrite() callback is the transport acknowledgement;
        // the ESP32 does NOT send an acknowledgement for every firmware packet.
        private const val OTA_WRITE_TIMEOUT_MS = 15000L

        /*
         * ESP32 CCCD UUID.
         */
        private val CCCD_UUID: UUID =
            UUID.fromString(
                "00002902-0000-1000-8000-00805f9b34fb"
            )
    }

    // ================================================================
    // ANDROID BLUETOOTH
    // ================================================================

    private val bluetoothManager =
        context.getSystemService(Context.BLUETOOTH_SERVICE)
                as android.bluetooth.BluetoothManager

    private val bluetoothAdapter: BluetoothAdapter?
        get() = bluetoothManager.adapter

    // ================================================================
    // BLE STATE
    // ================================================================

    private var bluetoothGatt: BluetoothGatt? = null

    // ----------------------------------------------------------------
    // AUTOMATIC RECONNECT
    // The link can break by itself (for example when the radio of the unit is busy with the barcode scanner).
    // Unless the user pressed Disconnect (or a firmware update is running) the app connects again by itself.
    // ----------------------------------------------------------------
    @Volatile
    private var lastDevice: BluetoothDevice? = null

    @Volatile
    private var userDisconnected = false

    private var reconnectJob: Job? = null

    private fun scheduleReconnect(skip: Boolean) {
        val device = lastDevice ?: return
        if (userDisconnected || skip) return
        if (reconnectJob?.isActive == true) return

        reconnectJob =
            scope.launch {

                val waits = longArrayOf(1500, 2500, 4000, 6000, 8000, 10000)

                for (i in waits.indices) {

                    delay(waits[i])

                    if (userDisconnected || _connected.value) return@launch

                    _status.value =
                        "Reconnecting (${i + 1}/${waits.size})..."

                    connect(device)

                    delay(8000)                       // time for the result

                    if (_connected.value) return@launch
                }

                if (!_connected.value) {
                    _status.value = "Disconnected"
                }
            }
    }

    private var writeCharacteristic:
            BluetoothGattCharacteristic? = null

    private var notifyCharacteristic:
            BluetoothGattCharacteristic? = null

    private var scanning = false

    private var negotiatedMtu = 23

    private var dataPollingJob: Job? = null

    @Volatile
    private var firmwareTransferActive = false

    @Volatile
    private var firmwareVerificationPending = false

    // BLE write completion queue. OTA waits for Android GATT callback before next packet.
    private val writeResults = Channel<Boolean>(Channel.UNLIMITED)

    // ================================================================
    // COROUTINE SCOPE
    // ================================================================

    private val scope =
        CoroutineScope(
            Dispatchers.IO
        )

    // ================================================================
    // CONNECTION STATE
    // ================================================================

    private val _connected =
        MutableStateFlow(false)

    val connected: StateFlow<Boolean> =
        _connected.asStateFlow()

    // ================================================================
    // CONNECTED DEVICE ADDRESS (real BLE MAC from Android, not ESP32-reported)
    // ================================================================
    //
    // This is the actual MAC of the BluetoothDevice Android connected to,
    // known immediately at connect time. It does NOT depend on the ESP32
    // reporting its own MAC back inside a JSON telemetry payload, so it
    // can't be blank/stale right after connecting and can't disagree with
    // reality if the firmware's self-reported value is ever wrong.

    private val _connectedDeviceAddress =
        MutableStateFlow("")

    val connectedDeviceAddress: StateFlow<String> =
        _connectedDeviceAddress.asStateFlow()

    // ================================================================
    // STATUS
    // ================================================================

    private val _status =
        MutableStateFlow("Disconnected")

    val status: StateFlow<String> =
        _status.asStateFlow()

    // ================================================================
    // RECEIVED DATA
    // ================================================================

    private val _lastReceivedData =
        MutableStateFlow("")

    val lastReceivedData: StateFlow<String> =
        _lastReceivedData.asStateFlow()

    // ================================================================
    // FIRMWARE PROGRESS
    // ================================================================

    private val _firmwareProgress =
        MutableStateFlow(-1)

    val firmwareProgress: StateFlow<Int> =
        _firmwareProgress.asStateFlow()

    // ================================================================
    // FIRMWARE UPDATE SOURCE ("Bluetooth" or "Network")
    // ================================================================
    //
    // Mirrors the ESP32's own currentOtaSource: lets the UI show which
    // transport is actively flashing, the same way the device's TFT
    // badge does.

    private val _firmwareSource =
        MutableStateFlow("")

    val firmwareSource: StateFlow<String> =
        _firmwareSource.asStateFlow()

    // ================================================================
    // CONFIRMED INSTALLED FIRMWARE VERSION
    // ================================================================
    //
    // Set once the ESP32 boots the new firmware and reports
    // otaStatus=success (see handleNotification()). MainActivity should
    // observe this and call FirmwareUpdateManager.markFirmwareInstalled()
    // with it — otherwise "installed_version" (and the version shown in
    // the UI) never advances past whatever it started at, even after a
    // successful update.

    private val _otaInstalledVersion =
        MutableStateFlow<String?>(null)

    val otaInstalledVersion: StateFlow<String?> =
        _otaInstalledVersion.asStateFlow()

    /** Call after persisting [otaInstalledVersion] so it isn't handled twice. */
    fun clearOtaInstalledVersion() {
        _otaInstalledVersion.value = null
    }

    // ================================================================
    // SCANNED ESP32 DEVICES
    // ================================================================

    private val _devices =
        MutableStateFlow<List<BluetoothDevice>>(
            emptyList()
        )

    val devices: StateFlow<List<BluetoothDevice>> =
        _devices.asStateFlow()

    // ================================================================
    // INCOMING COMPLETE JSON MESSAGES
    // ================================================================

    private val incoming =
        Channel<String>(
            Channel.UNLIMITED
        )

    // ================================================================
    // BLE CHUNK REASSEMBLY
    // ================================================================

    private var rxChunkData =
        StringBuilder()

    private var rxChunkIndex = 0

    private var rxChunkTotal = 0

    // ================================================================
    // AUTO CONNECT ADDRESS MANAGEMENT
    // ================================================================

    /**
     * Retrieves the saved auto-connect MAC address from SharedPreferences.
     */
    fun getAutoConnectAddress(): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_AUTO_CONNECT_MAC, null)
    }

    /**
     * Saves a MAC address for future auto-connection.
     */
    fun saveAutoConnectAddress(address: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_AUTO_CONNECT_MAC, address).apply()
    }

    /**
     * Clears any stored auto-connect MAC address.
     */
    fun clearAutoConnectAddress() {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY_AUTO_CONNECT_MAC).apply()
    }

    // ================================================================
    // BLUETOOTH SCAN CALLBACK
    // ================================================================

    private val scannerCallback =
        object : android.bluetooth.le.ScanCallback() {

            override fun onScanResult(
                callbackType: Int,
                result: android.bluetooth.le.ScanResult
            ) {

                if (!hasBluetoothPermission()) {
                    return
                }

                val device =
                    result.device

                val name =
                    try {
                        device.name
                    } catch (_: SecurityException) {
                        null
                    }

                val advertisedName =
                    result.scanRecord?.deviceName

                val visibleName =
                    name ?: advertisedName

                if (
                    visibleName?.startsWith(
                        DEVICE_NAME_PREFIX,
                        ignoreCase = true
                    ) == true
                ) {

                    val current =
                        _devices.value.toMutableList()

                    if (
                        current.none {
                            it.address == device.address
                        }
                    ) {

                        current.add(device)

                        _devices.value =
                            current
                    }
                }
            }

            override fun onScanFailed(
                errorCode: Int
            ) {

                scanning = false

                _status.value =
                    "Scan failed: $errorCode"
            }
        }

    // ================================================================
    // GATT CALLBACK
    // ================================================================

    private val gattCallback =
        object : BluetoothGattCallback() {

            override fun onConnectionStateChange(
                gatt: BluetoothGatt,
                status: Int,
                newState: Int
            ) {

                if (
                    status != BluetoothGatt.GATT_SUCCESS &&
                    newState != BluetoothProfile.STATE_CONNECTED
                ) {

                    _connected.value =
                        false

                    _connectedDeviceAddress.value =
                        ""

                    _status.value =
                        "Connection failed ($status)"

                    if (
                        hasBluetoothPermission()
                    ) {
                        try {
                            gatt.close()
                        } catch (_: Exception) {
                        }
                    }

                    if (bluetoothGatt === gatt) {
                        bluetoothGatt = null
                    }

                    scheduleReconnect(firmwareTransferActive || firmwareVerificationPending)

                    return
                }

                when (newState) {

                    BluetoothProfile.STATE_CONNECTED -> {

                        _connected.value =
                            true

                        _status.value =
                            "Connected - requesting MTU"

                        if (
                            hasBluetoothPermission()
                        ) {

                            if (
                                Build.VERSION.SDK_INT >=
                                Build.VERSION_CODES.LOLLIPOP
                            ) {

                                try {
                                    gatt.requestMtu(247)
                                } catch (_: Exception) {
                                    gatt.discoverServices()
                                }

                            } else {

                                gatt.discoverServices()
                            }
                        }
                    }

                    BluetoothProfile.STATE_DISCONNECTED -> {

                        // during a firmware update the unit restarts by itself: no reconnect from here
                        val skipReconnect = firmwareTransferActive || firmwareVerificationPending

                        stopDataPolling()

                        _connected.value =
                            false

                        _connectedDeviceAddress.value =
                            ""

                        _status.value =
                            "Disconnected"

                        if (!firmwareVerificationPending) {
                            _firmwareProgress.value = -1
                        }

                        firmwareTransferActive = false

                        writeCharacteristic =
                            null

                        notifyCharacteristic =
                            null

                        resetRxChunks()

                        if (
                            hasBluetoothPermission()
                        ) {
                            try {
                                gatt.close()
                            } catch (_: Exception) {
                            }
                        }

                        if (bluetoothGatt === gatt) {
                            bluetoothGatt = null
                        }

                        scheduleReconnect(skipReconnect)
                    }
                }
            }

            override fun onMtuChanged(
                gatt: BluetoothGatt,
                mtu: Int,
                status: Int
            ) {

                negotiatedMtu =
                    if (
                        status ==
                        BluetoothGatt.GATT_SUCCESS
                    ) {
                        mtu
                    } else {
                        23
                    }

                if (
                    hasBluetoothPermission()
                ) {

                    try {
                        gatt.discoverServices()
                    } catch (_: Exception) {
                    }
                }
            }

            override fun onServicesDiscovered(
                gatt: BluetoothGatt,
                status: Int
            ) {

                if (
                    status !=
                    BluetoothGatt.GATT_SUCCESS
                ) {

                    _status.value =
                        "Service discovery failed ($status)"

                    return
                }

                val service =
                    gatt.getService(
                        SERVICE_UUID
                    )

                if (service == null) {

                    _status.value =
                        "MatchO BLE service not found"

                    return
                }

                val characteristic =
                    service.getCharacteristic(
                        CHARACTERISTIC_UUID
                    )

                if (characteristic == null) {

                    _status.value =
                        "MatchO BLE characteristic not found"

                    return
                }

                writeCharacteristic =
                    characteristic

                notifyCharacteristic =
                    characteristic

                enableNotifications(
                    gatt,
                    characteristic
                )

                _status.value =
                    "Ready"

                scope.launch {

                    delay(300)

                    send(
                        """{"cmd":"GET_DATA"}"""
                    )

                    startDataPolling()
                }
            }

            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                value: ByteArray
            ) {

                handleNotification(
                    value
                )
            }

            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic
            ) {

                if (
                    Build.VERSION.SDK_INT <
                    Build.VERSION_CODES.TIRAMISU
                ) {

                    handleNotification(
                        characteristic.value
                            ?: ByteArray(0)
                    )
                }
            }

            override fun onCharacteristicWrite(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                status: Int
            ) {
                // Every OTA packet uses WRITE_TYPE_DEFAULT, so Android calls
                // this only after the GATT write has completed.
                writeResults.trySend(
                    status == BluetoothGatt.GATT_SUCCESS
                )

                if (
                    status != BluetoothGatt.GATT_SUCCESS
                ) {
                    _status.value =
                        "BLE write failed ($status)"
                }
            }
        }

    // ================================================================
    // HANDLE BLE NOTIFICATION
    // ================================================================

    private fun handleNotification(
        bytes: ByteArray
    ) {

        if (bytes.isEmpty()) {
            return
        }

        val text =
            try {
                bytes.toString(
                    Charsets.UTF_8
                )
            } catch (_: Exception) {
                return
            }

        try {

            val frame =
                JSONObject(text)

            if (
                frame.optBoolean(
                    "ble_chunk",
                    false
                )
            ) {

                val index =
                    frame.optInt(
                        "index",
                        0
                    )

                val total =
                    frame.optInt(
                        "total",
                        1
                    )

                val data =
                    frame.optString(
                        "data",
                        ""
                    )

                if (index == 0) {

                    rxChunkData =
                        StringBuilder()

                    rxChunkTotal =
                        total

                    rxChunkIndex =
                        0
                }

                if (
                    index != rxChunkIndex
                ) {
                    return
                }

                rxChunkData.append(
                    data
                )

                rxChunkIndex++

                if (
                    rxChunkIndex >=
                    rxChunkTotal
                ) {

                    val full =
                        rxChunkData.toString()

                    resetRxChunks()

                    _lastReceivedData.value =
                        full

                    incoming.trySend(
                        full
                    )
                }

                return
            }

            _lastReceivedData.value = text

            // The ESP32 writes an OTA pending marker before flashing and, after
            // reboot, reports otaStatus=success in the first normal JSON.
            // This is the final end-to-end confirmation, after the ESP32 has
            // actually booted the new application.
            val obj = try { JSONObject(text) } catch (_: Exception) { null }
            if (obj != null && obj.optString("otaStatus") == "success") {
                firmwareVerificationPending = false
                _firmwareProgress.value = 100
                // "otaVersion" is the exact target string the app sent in
                // FW_START's "version" field (e.g. "v1.3" from version.json)
                // and is what FirmwareUpdateManager's installed_version
                // bookkeeping expects. "firmwareVersion" is the ESP32's own
                // compiled-in MATCHO_FW_VERSION and may use a different
                // format, so it's only used if otaVersion is missing.
                val version = obj.optString("otaVersion", "").ifBlank {
                    obj.optString("firmwareVersion", "")
                }
                _otaInstalledVersion.value = version.ifBlank { null }
                _status.value = if (version.isNotBlank()) {
                    "Firmware update successful - $version"
                } else {
                    "Firmware update successful"
                }
            } else if (obj != null && obj.optString("otaStatus") == "failed") {
                firmwareVerificationPending = false
                _firmwareProgress.value = -1
                _status.value = "Firmware update failed: ESP32 booted old firmware"
            }

            incoming.trySend(text)

        } catch (_: Exception) {
        }
    }

    // ================================================================
    // RESET CHUNKS
    // ================================================================

    private fun resetRxChunks() {

        rxChunkData =
            StringBuilder()

        rxChunkIndex =
            0

        rxChunkTotal =
            0
    }

    // ================================================================
    // BLUETOOTH PERMISSION
    // ================================================================

    private fun hasBluetoothPermission(): Boolean {

        return if (
            Build.VERSION.SDK_INT >=
            Build.VERSION_CODES.S
        ) {

            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_SCAN
            ) ==
                    PackageManager.PERMISSION_GRANTED &&

                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.BLUETOOTH_CONNECT
                    ) ==
                    PackageManager.PERMISSION_GRANTED

        } else {

            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_FINE_LOCATION
            ) ==
                    PackageManager.PERMISSION_GRANTED
        }
    }

    // ================================================================
    // BLUETOOTH ENABLED
    // ================================================================

    fun isBluetoothEnabled(): Boolean {

        return bluetoothAdapter?.isEnabled == true
    }

    // ================================================================
    // START ESP32 BLE SCAN
    // ================================================================

    @SuppressLint("MissingPermission")
    fun startScan() {

        if (!hasBluetoothPermission()) {

            _status.value =
                "Bluetooth permission required"

            return
        }

        if (!isBluetoothEnabled()) {

            _status.value =
                "Bluetooth is OFF"

            return
        }

        if (scanning) {
            return
        }

        _devices.value =
            emptyList()

        val scanner =
            bluetoothAdapter
                ?.bluetoothLeScanner

        if (scanner == null) {

            _status.value =
                "BLE scanner unavailable"

            return
        }

        scanning =
            true

        _status.value =
            "Scanning for MatchO..."

        try {

            scanner.startScan(
                scannerCallback
            )

        } catch (e: Exception) {

            scanning =
                false

            _status.value =
                "Scan error: ${e.message}"
        }
    }

    // ================================================================
    // STOP SCAN
    // ================================================================

    @SuppressLint("MissingPermission")
    fun stopScan() {

        if (
            hasBluetoothPermission() &&
            scanning
        ) {

            try {

                bluetoothAdapter
                    ?.bluetoothLeScanner
                    ?.stopScan(
                        scannerCallback
                    )

            } catch (_: Exception) {
            }
        }

        scanning =
            false

        if (!_connected.value) {

            _status.value =
                "Scan stopped"
        }
    }

    // ================================================================
    // CONNECT
    // ================================================================

    @SuppressLint("MissingPermission")
    fun connect(
        device: BluetoothDevice
    ) {

        if (!hasBluetoothPermission()) {

            _status.value =
                "Bluetooth permission required"

            return
        }

        lastDevice = device
        userDisconnected = false

        stopScan()

        try {
            bluetoothGatt?.close()
        } catch (_: Exception) {
        }

        bluetoothGatt =
            null

        writeCharacteristic =
            null

        notifyCharacteristic =
            null

        resetRxChunks()

        val displayName =
            try {
                device.name
            } catch (_: SecurityException) {
                null
            }
                ?: device.address

        _status.value =
            "Connecting to $displayName..."

        try {

            bluetoothGatt =
                if (
                    Build.VERSION.SDK_INT >=
                    Build.VERSION_CODES.M
                ) {

                    device.connectGatt(
                        context,
                        false,
                        gattCallback,
                        BluetoothDevice.TRANSPORT_LE
                    )

                } else {

                    @Suppress("DEPRECATION")
                    device.connectGatt(
                        context,
                        false,
                        gattCallback
                    )
                }

            // Persist MAC address for future auto-connect calls
            saveAutoConnectAddress(device.address)

            // Surface the real BLE MAC immediately — this is what the UI
            // should show, independent of anything the ESP32 reports back.
            _connectedDeviceAddress.value =
                device.address

        } catch (e: Exception) {

            _connected.value =
                false

            _connectedDeviceAddress.value =
                ""

            _status.value =
                "Connection error: ${e.message}"

            bluetoothGatt =
                null
        }
    }

    // ================================================================
    // DISCONNECT
    // ================================================================

    @SuppressLint("MissingPermission")
    fun disconnect() {

        userDisconnected = true
        reconnectJob?.cancel()

        stopDataPolling()

        val gatt =
            bluetoothGatt

        if (gatt != null) {

            if (
                hasBluetoothPermission()
            ) {

                try {
                    gatt.disconnect()
                } catch (_: Exception) {
                }

                try {
                    gatt.close()
                } catch (_: Exception) {
                }
            }
        }

        bluetoothGatt =
            null

        writeCharacteristic =
            null

        notifyCharacteristic =
            null

        resetRxChunks()

        _connected.value =
            false

        _connectedDeviceAddress.value =
            ""

        _status.value =
            "Disconnected"

        _firmwareProgress.value =
            -1
    }

    // ================================================================
    // SEND STRING
    // ================================================================

    @SuppressLint("MissingPermission")
    fun send(
        data: String
    ): Boolean {

        if (!hasBluetoothPermission()) {

            _status.value =
                "Bluetooth permission required"

            return false
        }

        val gatt =
            bluetoothGatt

        val characteristic =
            writeCharacteristic

        if (
            gatt == null ||
            characteristic == null ||
            !_connected.value
        ) {

            _status.value =
                "Not connected"

            return false
        }

        if (firmwareTransferActive && data.contains("\"cmd\":\"GET_DATA\"")) {
            return false
        }

        val bytes =
            data.toByteArray(
                Charsets.UTF_8
            )

        characteristic.writeType =
            BluetoothGattCharacteristic
                .WRITE_TYPE_DEFAULT

        return try {

            if (
                Build.VERSION.SDK_INT >=
                Build.VERSION_CODES.TIRAMISU
            ) {

                gatt.writeCharacteristic(
                    characteristic,
                    bytes,
                    BluetoothGattCharacteristic
                        .WRITE_TYPE_DEFAULT
                ) ==
                        BluetoothStatusCodes.SUCCESS

            } else {

                @Suppress("DEPRECATION")
                characteristic.value =
                    bytes

                @Suppress("DEPRECATION")
                gatt.writeCharacteristic(
                    characteristic
                )
            }

        } catch (e: Exception) {

            _status.value =
                "BLE send error: ${e.message}"

            false
        }
    }

    // ================================================================
    // DRAIN OLD RESPONSES
    // ================================================================

    private fun drainIncoming() {

        while (
            incoming.tryReceive()
                .isSuccess
        ) {
            // Discard stale response.
        }
    }

    // ================================================================
    // WAIT FOR JSON
    // ================================================================

    private suspend fun awaitJson(
        timeoutMs: Long,
        predicate: (JSONObject) -> Boolean
    ): JSONObject? {

        return withTimeoutOrNull(
            timeoutMs
        ) {

            while (
                coroutineContext.isActive
            ) {

                val raw =
                    try {
                        incoming.receive()
                    } catch (
                        e: CancellationException
                    ) {
                        throw e
                    }

                val obj =
                    try {
                        JSONObject(raw)
                    } catch (_: Exception) {
                        null
                    }

                if (
                    obj != null &&
                    predicate(obj)
                ) {

                    return@withTimeoutOrNull obj
                }
            }

            null
        }
    }

    // ================================================================
    // GENERIC JSON REQUEST
    // ================================================================

    suspend fun requestJson(
        cmd: String,
        timeoutMs: Long = 5000
    ): JSONObject? {

        drainIncoming()

        val command =
            JSONObject().apply {
                put(
                    "cmd",
                    cmd
                )
            }.toString()

        if (!send(command)) {
            return null
        }

        return awaitJson(
            timeoutMs
        ) {
            true
        }
    }

    // ================================================================
    // AUTOMATIC DATA POLLING
    // ================================================================

    private fun startDataPolling() {

        stopDataPolling()

        dataPollingJob =
            scope.launch {

                delay(500)

                while (
                    isActive &&
                    _connected.value
                ) {

                    try {

                        send(
                            """{"cmd":"GET_DATA"}"""
                        )

                    } catch (_: Exception) {
                    }

                    delay(2000)
                }
            }
    }

    private fun stopDataPolling() {

        dataPollingJob?.cancel()

        dataPollingJob =
            null
    }

    // ================================================================
    // WIFI SCAN
    // ================================================================

    suspend fun scanWifi():
            List<JSONObject> {

        drainIncoming()

        if (
            !send(
                """{"cmd":"SCAN_WIFI"}"""
            )
        ) {
            return emptyList()
        }

        val response =
            awaitJson(
                10000
            ) {

                it.optString(
                    "status"
                ) == "wifi_scan"
            }

        return response
            ?.optJSONArray(
                "networks"
            )
            ?.let { arr ->

                List(
                    arr.length()
                ) { i ->

                    arr.getJSONObject(
                        i
                    )
                }

            }
            ?.sortedByDescending {

                it.optInt(
                    "rssi",
                    -100
                )

            }
            ?: emptyList()
    }

    // ================================================================
    // BARCODE SCANNER - SCAN FROM THE PHONE ITSELF
    // ================================================================
    //
    // The ESP32-delegated scan (scanScanner() below) only sees what the
    // ESP32's own classic-BT radio finds. Some barcode scanners are hard
    // for the ESP32 to discover but show up fine in the phone's own
    // Bluetooth settings. This block scans with the PHONE's radio instead,
    // and once a scanner is picked, hands its MAC address to the ESP32
    // (SAVE_BT_MAC) and unpairs it from the phone so it's free to pair
    // with the ESP32 instead.

    data class ClassicBtDevice(
        val name: String,
        val mac: String,
        val bonded: Boolean
    )

    private val _phoneScannerDevices =
        MutableStateFlow<List<ClassicBtDevice>>(emptyList())

    val phoneScannerDevices: StateFlow<List<ClassicBtDevice>> =
        _phoneScannerDevices.asStateFlow()

    private val _phoneScanActive =
        MutableStateFlow(false)

    val phoneScanActive: StateFlow<Boolean> =
        _phoneScanActive.asStateFlow()

    private var discoveryReceiver: BroadcastReceiver? = null

    /**
     * Starts a classic-Bluetooth discovery using the PHONE's own radio
     * (same mechanism as Android Settings > Bluetooth uses). Results are
     * published to [phoneScannerDevices] as they arrive.
     */
    @SuppressLint("MissingPermission")
    fun startPhoneScannerDiscovery() {
        val adapter = bluetoothAdapter

        if (adapter == null || !adapter.isEnabled) {
            _status.value = "Phone Bluetooth is off"
            return
        }

        if (!hasBluetoothPermission()) {
            _status.value = "Bluetooth permission required"
            return
        }

        // Only show newly discovered devices - not devices already
        // paired/stored on the phone, so start from an empty list.
        _phoneScannerDevices.value = emptyList()

        if (discoveryReceiver == null) {
            discoveryReceiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    when (intent.action) {
                        BluetoothDevice.ACTION_FOUND -> {
                            val device: BluetoothDevice? =
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                    intent.getParcelableExtra(
                                        BluetoothDevice.EXTRA_DEVICE,
                                        BluetoothDevice::class.java
                                    )
                                } else {
                                    @Suppress("DEPRECATION")
                                    intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                                }

                            val mac = device?.address ?: return
                            if (!hasBluetoothPermission()) return

                            val bonded =
                                device.bondState == BluetoothDevice.BOND_BONDED

                            // Only surface new, not-yet-paired devices -
                            // devices already stored/bonded on the phone
                            // are skipped.
                            if (bonded) return

                            val name = try {
                                device.name
                            } catch (_: SecurityException) {
                                null
                            } ?: "Unknown device"

                            val current = _phoneScannerDevices.value
                            if (current.none { it.mac == mac }) {
                                _phoneScannerDevices.value =
                                    current + ClassicBtDevice(name, mac, bonded)
                            }
                        }

                        BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                            _phoneScanActive.value = false
                        }
                    }
                }
            }

            val filter = IntentFilter().apply {
                addAction(BluetoothDevice.ACTION_FOUND)
                addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(
                    discoveryReceiver,
                    filter,
                    Context.RECEIVER_EXPORTED
                )
            } else {
                context.registerReceiver(discoveryReceiver, filter)
            }
        }

        if (adapter.isDiscovering) {
            adapter.cancelDiscovery()
        }

        _phoneScanActive.value = adapter.startDiscovery()
        if (!_phoneScanActive.value) {
            _status.value = "Could not start phone Bluetooth scan"
        }
    }

    /**
     * Stops an in-progress phone-side discovery. Safe to call even if no
     * scan is running.
     */
    @SuppressLint("MissingPermission")
    fun stopPhoneScannerDiscovery() {
        val adapter = bluetoothAdapter
        if (adapter?.isDiscovering == true && hasBluetoothPermission()) {
            adapter.cancelDiscovery()
        }
        _phoneScanActive.value = false
    }

    /**
     * Unregisters the discovery BroadcastReceiver. Call from cleanup()/
     * onDestroy so the receiver doesn't leak once the screen is gone.
     */
    fun releasePhoneScannerReceiver() {
        discoveryReceiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (_: Exception) {
                // Already unregistered - ignore.
            }
        }
        discoveryReceiver = null
    }

    /**
     * Call when the user taps a device found by the phone-side scan.
     * Hands the MAC address to the ESP32 (so it knows which scanner to
     * pair with) and, if the phone itself is bonded to that scanner,
     * unpairs it from the phone so it's free for the ESP32 to connect to.
     */
    @SuppressLint("MissingPermission")
    fun selectPhoneScannerDevice(device: ClassicBtDevice): Boolean {
        stopPhoneScannerDiscovery()

        if (device.bonded) {
            unpairFromPhone(device.mac)
        }

        // Tell the ESP32 which scanner to connect to.
        return saveScanner(device.mac)
    }

    @SuppressLint("MissingPermission")
    private fun unpairFromPhone(mac: String) {
        val adapter = bluetoothAdapter ?: return
        if (!hasBluetoothPermission()) return

        val remoteDevice = try {
            adapter.getRemoteDevice(mac)
        } catch (_: Exception) {
            return
        }

        // There's no public API to unpair a device; removeBond() is the
        // long-standing hidden API every Bluetooth-settings-style app uses.
        try {
            val method = remoteDevice.javaClass.getMethod("removeBond")
            method.invoke(remoteDevice)
        } catch (e: Exception) {
            _status.value = "Could not release scanner from phone: ${e.message}"
        }
    }

    // ================================================================
    // BARCODE SCANNER / CLASSIC BT SCAN (ESP32-SIDE, LEGACY)
    // ================================================================
    //
    // Kept for reference / fallback: this delegates the scan to the ESP32
    // itself over BLE. Prefer startPhoneScannerDiscovery() above, which
    // scans with the phone's own radio and is what the config screen now
    // uses.

    suspend fun scanScanner():
            List<JSONObject> {

        drainIncoming()

        if (
            !send(
                """{"cmd":"SCAN_BT"}"""
            )
        ) {
            return emptyList()
        }

        val response =
            awaitJson(
                15000
            ) {

                it.optString(
                    "status"
                ) == "bt_scan"
            }

        return response
            ?.optJSONArray(
                "devices"
            )
            ?.let { arr ->

                List(
                    arr.length()
                ) { i ->

                    arr.getJSONObject(
                        i
                    )
                }

            }
            ?: emptyList()
    }

    // ================================================================
    // SAVE WIFI
    // ================================================================

    fun saveWifi(
        ssid: String,
        password: String
    ): Boolean {

        val json =
            JSONObject().apply {

                put(
                    "cmd",
                    "SET_WIFI"
                )

                put(
                    "ssid",
                    ssid
                )

                put(
                    "pass",
                    password
                )
            }

        return send(
            json.toString()
        )
    }

    // ================================================================
    // SAVE BARCODE SCANNER
    // ================================================================

    fun saveScanner(
        mac: String
    ): Boolean {

        val json =
            JSONObject().apply {

                put(
                    "cmd",
                    "SAVE_BT_MAC"
                )

                put(
                    "btMac",
                    mac
                )
            }

        return send(
            json.toString()
        )
    }

    // ================================================================
    // REQUEST SCANNER BATTERY LEVEL
    // ================================================================
    //
    // Asks the ESP32 to write the NT-1228BC's "Battery Information"
    // command-barcode payload ("%BAT_VOL#") directly to the scanner
    // over its SPP link, instead of someone physically scanning the
    // paper barcode. The scanner's reply (if it honours the command)
    // shows up a couple of seconds later in the normal telemetry poll
    // as scannerBatteryVoltage / scannerBatteryPercent.

    fun requestScannerBattery(): Boolean {
        return send(
            """{"cmd":"GET_SCANNER_BATTERY"}"""
        )
    }

    // ================================================================
    // SCANNER MODE SWITCH BARCODES
    // ================================================================
    //
    // The NT-1228BC (and similar scan-engine modules) can be
    // reconfigured by scanning one of its printed "setup" Code128
    // barcodes. Instead of physically scanning the paper, we write
    // the same literal payload straight over the SPP link via the
    // generic SCANNER_SEND command handled on the ESP32.
    //
    //   Wireless Mode barcode payload : %#IFSNO$1
    //   Bluetooth Mode barcode payload: %#IFSNO$4
    //   Bluetooth SPP barcode payload : AT+MODE=1
    //
    // "Match-O Mode" puts the scanner into the mode this app actually
    // talks to it in (classic Bluetooth SPP): it first switches the
    // radio to Bluetooth, waits 2s for that to take effect, then
    // switches the profile to SPP.

    fun setScannerWirelessMode(): Boolean {
        return sendScannerPayload("%#IFSNO$1")
    }

    suspend fun setScannerMatchOMode(): Boolean {
        if (!sendScannerPayload("%#IFSNO$4")) return false
        kotlinx.coroutines.delay(2000)
        return sendScannerPayload("AT+MODE=1")
    }

    private fun sendScannerPayload(payload: String): Boolean {
        val json =
            JSONObject().apply {
                put("cmd", "SCANNER_SEND")
                put("payload", payload)
            }
        return send(json.toString())
    }

    // ================================================================
    // SAVE TEMPERATURE OFFSET
    // ================================================================

    fun saveOffset(
        offset: Float
    ): Boolean {

        val json =
            JSONObject().apply {

                put(
                    "cmd",
                    "SET_OFFSET"
                )

                put(
                    "offset",
                    offset
                )
            }

        return send(
            json.toString()
        )
    }

    // ================================================================
    // START PATIENT / BARCODE SCAN
    // ================================================================

    fun startPatientScan(): Boolean {

        return send(
            """{"cmd":"START_PATIENT_SCAN"}"""
        )
    }

    // ================================================================
    // FIRMWARE UPDATE
    // ================================================================

    suspend fun sendFirmware(
        firmware: ByteArray,
        targetVersion: String = "",
        onProgress: (Int) -> Unit = {}
    ): Boolean {

        if (!_connected.value || firmware.isEmpty()) {
            _status.value = "Not connected or empty firmware"
            return false
        }

        if (firmware.size > 4 * 1024 * 1024) {
            _status.value = "Firmware is too large"
            return false
        }

        stopDataPolling()
        firmwareTransferActive = true
        firmwareVerificationPending = false
        drainWriteResults()
        drainIncoming()
        resetRxChunks()

        try {
            _firmwareProgress.value = 0
            _firmwareSource.value = "Bluetooth"
            _status.value = "Preparing firmware update..."

            val start = JSONObject().apply {
                put("cmd", "FW_START")
                put("size", firmware.size)
                if (targetVersion.isNotBlank()) put("version", targetVersion)
            }.toString()

            if (!writeCommandAndWait(start, 10000)) {
                _status.value = "Failed to send FW_START"
                return false
            }

            val ready = awaitJson(30000) {
                val status = it.optString("status")
                status == "fw_ready" || status == "fw_error"
            } ?: run {
                _status.value = "ESP32 did not respond to firmware update request"
                return false
            }

            if (ready.optString("status") == "fw_error") {
                val message = ready.optString("message", "unknown_error")
                val reason = ready.optString("reason", "")
                val size = ready.optLong("size", -1)
                val partition = ready.optLong("partitionSize", -1)
                _status.value = buildString {
                    append("ESP32 rejected firmware: ").append(message)
                    if (reason.isNotBlank()) append(" (").append(reason).append(")")
                    if (size >= 0 && partition >= 0) {
                        append(" [bin=").append(size).append(", OTA=").append(partition).append("]")
                    }
                }
                return false
            }

            val mtuPayload = min(
                DEFAULT_CHUNK,
                (negotiatedMtu - 3 - OTA_HEADER).coerceAtLeast(15)
            )

            var offset = 0
            var seq = 0

            while (offset < firmware.size) {
                if (!_connected.value) {
                    _status.value = "BLE disconnected during firmware update"
                    return false
                }

                val count = min(mtuPayload, firmware.size - offset)
                val packet = ByteArray(OTA_HEADER + count)
                packet[0] = 0xF1.toByte()
                packet[1] = ((seq ushr 24) and 0xFF).toByte()
                packet[2] = ((seq ushr 16) and 0xFF).toByte()
                packet[3] = ((seq ushr 8) and 0xFF).toByte()
                packet[4] = (seq and 0xFF).toByte()
                System.arraycopy(firmware, offset, packet, OTA_HEADER, count)

                // No ESP32 fw_ack. WRITE_TYPE_DEFAULT is serialized by Android
                // and onCharacteristicWrite() confirms the GATT write completed.
                if (!writeRaw(packet, OTA_WRITE_TIMEOUT_MS)) {
                    _status.value = "BLE firmware packet write failed: $seq"
                    return false
                }

                offset += count
                seq++

                val progress = (offset * 100L / firmware.size).toInt().coerceIn(0, 100)
                _firmwareProgress.value = progress
                _status.value = "Updating firmware: $progress%"
                onProgress(progress)
            }

            if (!writeCommandAndWait("""{"cmd":"FW_END"}""", 10000)) {
                _status.value = "Failed to send FW_END"
                return false
            }

            val result = awaitJson(15000) {
                val status = it.optString("status")
                status == "fw_written" || status == "fw_error"
            }

            if (result == null) {
                _status.value = "ESP32 did not confirm firmware write"
                return false
            }

            if (result.optString("status") == "fw_written") {
                _firmwareProgress.value = 100
                firmwareVerificationPending = true
                _status.value = "Firmware written. ESP32 restarting..."
                // The BLE link is expected to disconnect now. Success is NOT
                // declared until the ESP32 boots and reports otaStatus=success.
                return true
            }

            val message = result.optString("message", "unknown_error")
            val reason = result.optString("reason", "")
            _status.value = if (reason.isNotBlank()) {
                "Firmware update failed: $message ($reason)"
            } else {
                "Firmware update failed: $message"
            }
            return false

        } finally {
            firmwareTransferActive = false
            drainWriteResults()
            if (_firmwareProgress.value < 100) {
                _firmwareProgress.value = -1
            }
        }
    }

    // ================================================================
    // FIRMWARE UPDATE — NETWORK (WiFi/HTTP) OTA
    // ================================================================
    //
    // Matches the ESP32 firmware's network OTA path: instead of chunking
    // the .bin over BLE, we hand the ESP32 a direct download URL and it
    // pulls + flashes the firmware itself over its own WiFi connection.
    // This is the PRIORITY transport — see updateFirmwareWithPriority()
    // below, which decides whether to use this or fall back to the
    // existing sendFirmware() (Bluetooth) path.
    //
    // The ESP32 responds to this FW_START with one of:
    //   - "fw_ready"  -> download/flash started, progress frames follow
    //   - "fw_error"  -> rejected outright (bad size, no space, etc.)
    //   - "fw_info"   -> "no_wifi_falling_back_to_ble" (WiFi dropped
    //                     between our GET_DATA check and this command) —
    //                     the caller should retry over Bluetooth.
    // Once started, it reports "fw_progress" frames until it finishes
    // with "fw_written" (success, ESP32 is restarting) or "fw_error".

    suspend fun sendFirmwareViaNetwork(
        url: String,
        targetVersion: String = "",
        onProgress: (Int) -> Unit = {}
    ): Boolean {

        if (!_connected.value || url.isBlank()) {
            _status.value = "Not connected or missing firmware URL"
            return false
        }

        stopDataPolling()
        firmwareTransferActive = true
        firmwareVerificationPending = false
        drainWriteResults()
        drainIncoming()
        resetRxChunks()

        try {
            _firmwareProgress.value = 0
            _firmwareSource.value = "Network"
            _status.value = "Requesting network firmware update..."

            val start = JSONObject().apply {
                put("cmd", "FW_START")
                put("url", url)
                if (targetVersion.isNotBlank()) put("version", targetVersion)
            }.toString()

            if (!writeCommandAndWait(start, 10000)) {
                _status.value = "Failed to send FW_START (network)"
                return false
            }

            val ready = awaitJson(30000) {
                val status = it.optString("status")
                status == "fw_ready" || status == "fw_error" || status == "fw_info"
            } ?: run {
                _status.value = "ESP32 did not respond to network firmware request"
                return false
            }

            when (ready.optString("status")) {
                "fw_info" -> {
                    _status.value = "ESP32 has no WiFi right now - falling back to Bluetooth"
                    return false
                }
                "fw_error" -> {
                    val message = ready.optString("message", "unknown_error")
                    val reason = ready.optString("reason", "")
                    val size = ready.optLong("size", -1)
                    val partition = ready.optLong("partitionSize", -1)
                    _status.value = buildString {
                        append("ESP32 rejected network firmware: ").append(message)
                        if (reason.isNotBlank()) append(" (").append(reason).append(")")
                        if (size >= 0 && partition >= 0) {
                            append(" [bin=").append(size).append(", OTA=").append(partition).append("]")
                        }
                    }
                    return false
                }
            }

            // fw_ready: the ESP32 is downloading and flashing on its own.
            _status.value = "ESP32 downloading firmware over WiFi..."

            while (true) {
                val update = awaitJson(60000) {
                    val status = it.optString("status")
                    status == "fw_progress" || status == "fw_written" ||
                            status == "fw_error" || status == "fw_aborted"
                } ?: run {
                    _status.value = "ESP32 stopped responding during network update"
                    return false
                }

                when (update.optString("status")) {
                    "fw_progress" -> {
                        val received = update.optLong("received", 0)
                        val expected = update.optLong("expected", 1).coerceAtLeast(1)
                        val progress = (received * 100L / expected).toInt().coerceIn(0, 100)
                        _firmwareProgress.value = progress
                        _status.value = "Updating firmware over WiFi: $progress%"
                        onProgress(progress)
                    }
                    "fw_written" -> {
                        _firmwareProgress.value = 100
                        firmwareVerificationPending = true
                        _status.value = "Firmware written. ESP32 restarting..."
                        // Same as the Bluetooth path: success is NOT declared
                        // until the ESP32 boots and reports otaStatus=success.
                        return true
                    }
                    "fw_aborted" -> {
                        _status.value = "Network firmware update aborted"
                        return false
                    }
                    "fw_error" -> {
                        val message = update.optString("message", "unknown_error")
                        _status.value = "Firmware update failed: $message"
                        return false
                    }
                }
            }

        } finally {
            firmwareTransferActive = false
            drainWriteResults()
            if (_firmwareProgress.value < 100) {
                _firmwareProgress.value = -1
            }
        }
    }

    // ================================================================
    // FIRMWARE UPDATE — AUTOMATIC PRIORITY (Network first, Bluetooth fallback)
    // ================================================================
    //
    // This is the entry point the app should call for an update: it
    // mirrors the ESP32-side priority in FW_START. If a direct firmware
    // URL is available and the ESP32 currently reports WiFi connected,
    // the update is pulled straight over HTTP by the ESP32 itself. If
    // WiFi isn't connected, or the network attempt is rejected or fails
    // to complete, this transparently falls back to the existing
    // Bluetooth chunked transfer using localFirmwareBytes (the file
    // FirmwareUpdateManager already downloaded to the phone).

    suspend fun updateFirmwareWithPriority(
        networkUrl: String,
        targetVersion: String = "",
        localFirmwareBytes: ByteArray?,
        onProgress: (Int) -> Unit = {}
    ): Boolean {

        if (!_connected.value) {
            _status.value = "Not connected"
            return false
        }

        if (networkUrl.isNotBlank()) {
            val statusJson = requestJson("GET_DATA", 5000)
            val wifiConnected = statusJson?.optBoolean("wifiConnected", false) ?: false

            if (wifiConnected) {
                val networkOk = sendFirmwareViaNetwork(networkUrl, targetVersion, onProgress)
                if (networkOk) return true
                // Network path was attempted (or explicitly declined by the
                // ESP32) and didn't succeed — fall through to Bluetooth below.
            }
        }

        if (localFirmwareBytes == null || localFirmwareBytes.isEmpty()) {
            _status.value = "Network update unavailable and no local firmware to fall back to"
            return false
        }

        return sendFirmware(localFirmwareBytes, targetVersion, onProgress)
    }

    // ================================================================
    // WRITE RAW BLE DATA
    // ================================================================

    private fun drainWriteResults() {
        while (writeResults.tryReceive().isSuccess) {
            // Discard callbacks belonging to an earlier command.
        }
    }

    private suspend fun writeCommandAndWait(
        data: String,
        timeoutMs: Long
    ): Boolean {
        val bytes = data.toByteArray(Charsets.UTF_8)
        drainWriteResults()

        val gatt = bluetoothGatt ?: return false
        val characteristic = writeCharacteristic ?: return false
        if (!_connected.value || !hasBluetoothPermission()) return false

        val started = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(
                    characteristic,
                    bytes,
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                ) == BluetoothStatusCodes.SUCCESS
            } else {
                @Suppress("DEPRECATION")
                characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                @Suppress("DEPRECATION")
                characteristic.value = bytes
                @Suppress("DEPRECATION")
                gatt.writeCharacteristic(characteristic)
            }
        } catch (_: Exception) {
            false
        }

        if (!started) return false
        return withTimeoutOrNull(timeoutMs) {
            writeResults.receive()
        } ?: false
    }

    @SuppressLint("MissingPermission")
    private suspend fun writeRaw(
        data: ByteArray,
        timeoutMs: Long = 10000L
    ): Boolean {
        val gatt =
            bluetoothGatt
                ?: return false

        val characteristic =
            writeCharacteristic
                ?: return false

        if (
            !_connected.value ||
            !hasBluetoothPermission()
        ) {
            return false
        }

        // Never allow a previous GATT callback to satisfy this packet.
        drainWriteResults()

        val started = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(
                    characteristic,
                    data,
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                ) == BluetoothStatusCodes.SUCCESS
            } else {
                @Suppress("DEPRECATION")
                characteristic.writeType =
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT

                @Suppress("DEPRECATION")
                characteristic.value = data

                @Suppress("DEPRECATION")
                gatt.writeCharacteristic(characteristic)
            }
        } catch (e: Exception) {
            _status.value = "BLE send error: ${e.message}"
            false
        }

        if (!started) {
            return false
        }

        // WRITE_TYPE_DEFAULT must complete before the next OTA packet is sent.
        return withTimeoutOrNull(timeoutMs) {
            writeResults.receive()
        } ?: false
    }

    // ================================================================
    // ENABLE BLE NOTIFICATIONS
    // ================================================================

    @SuppressLint("MissingPermission")
    private fun enableNotifications(
        gatt: BluetoothGatt,
        characteristic:
        BluetoothGattCharacteristic
    ) {

        if (
            !hasBluetoothPermission()
        ) {
            return
        }

        try {

            gatt.setCharacteristicNotification(
                characteristic,
                true
            )

            val descriptor =
                characteristic.getDescriptor(
                    CCCD_UUID
                )

            if (descriptor != null) {

                if (
                    Build.VERSION.SDK_INT >=
                    Build.VERSION_CODES.TIRAMISU
                ) {

                    gatt.writeDescriptor(
                        descriptor,
                        BluetoothGattDescriptor
                            .ENABLE_NOTIFICATION_VALUE
                    )

                } else {

                    @Suppress("DEPRECATION")
                    descriptor.value =
                        BluetoothGattDescriptor
                            .ENABLE_NOTIFICATION_VALUE

                    @Suppress("DEPRECATION")
                    gatt.writeDescriptor(
                        descriptor
                    )
                }
            }

        } catch (e: Exception) {

            _status.value =
                "Notification setup failed: ${e.message}"
        }
    }

    // ================================================================
    // CLEAR RECEIVED DATA
    // ================================================================

    fun clearReceivedData() {

        _lastReceivedData.value =
            ""
    }

    // ================================================================
    // CLEANUP
    // ================================================================

    fun cleanup() {
        stopDataPolling()
        stopScan()
        stopPhoneScannerDiscovery()
        releasePhoneScannerReceiver()
        disconnect()
        scope.cancel()
    }
}