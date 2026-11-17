package com.example.match_o

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

class BluetoothManager(
    private val context: Context
) {

    private val bluetoothAdapter: BluetoothAdapter? by lazy {

        val manager =
            context.getSystemService(
                Context.BLUETOOTH_SERVICE
            ) as android.bluetooth.BluetoothManager

        manager.adapter
    }


    private var bluetoothGatt: BluetoothGatt? = null

    private var writeCharacteristic:
            BluetoothGattCharacteristic? = null


    private val _connected =
        MutableStateFlow(false)

    val connected: StateFlow<Boolean> =
        _connected


    private val _lastReceivedData =
        MutableStateFlow("")

    val lastReceivedData: StateFlow<String> =
        _lastReceivedData


    private val _status =
        MutableStateFlow("Disconnected")

    val status: StateFlow<String> =
        _status


    /*
     * ============================================================
     * CONNECT
     * ============================================================
     */

    @SuppressLint("MissingPermission")
    fun connect(device: BluetoothDevice) {

        if (!hasBluetoothPermission()) {
            _status.value =
                "Bluetooth permission required"

            return
        }

        disconnect()

        _status.value =
            "Connecting..."

        bluetoothGatt =
            device.connectGatt(
                context,
                false,
                gattCallback,
                BluetoothDevice.TRANSPORT_LE
            )
    }


    /*
     * ============================================================
     * DISCONNECT
     * ============================================================
     */

    @SuppressLint("MissingPermission")
    fun disconnect() {

        try {

            bluetoothGatt?.disconnect()

            bluetoothGatt?.close()

        } catch (_: Exception) {
        }

        bluetoothGatt = null

        writeCharacteristic = null

        _connected.value = false

        _status.value =
            "Disconnected"
    }


    /*
     * ============================================================
     * SEND DATA
     * ============================================================
     */

    @SuppressLint("MissingPermission")
    fun send(data: ByteArray): Boolean {

        if (!hasBluetoothPermission()) {

            _status.value =
                "Bluetooth permission required"

            return false
        }

        val gatt =
            bluetoothGatt
                ?: return false

        val characteristic =
            writeCharacteristic
                ?: return false


        return try {

            characteristic.value = data

            characteristic.writeType =
                BluetoothGattCharacteristic
                    .WRITE_TYPE_DEFAULT

            gatt.writeCharacteristic(
                characteristic
            )

        } catch (_: Exception) {

            false
        }
    }


    /*
     * ============================================================
     * SEND STRING
     * ============================================================
     */

    fun send(text: String): Boolean {

        return send(
            text.toByteArray()
        )
    }


    /*
     * ============================================================
     * BLUETOOTH CALLBACK
     * ============================================================
     */

    private val gattCallback =
        object : BluetoothGattCallback() {


            @SuppressLint("MissingPermission")
            override fun onConnectionStateChange(
                gatt: BluetoothGatt,
                status: Int,
                newState: Int
            ) {

                if (
                    status == BluetoothGatt.GATT_SUCCESS &&
                    newState ==
                    BluetoothProfile.STATE_CONNECTED
                ) {

                    _connected.value =
                        true

                    _status.value =
                        "Connected"

                    gatt.discoverServices()

                } else {

                    _connected.value =
                        false

                    _status.value =
                        "Disconnected"

                    try {
                        gatt.close()
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
                        "Service discovery failed"

                    return
                }


                val service =
                    gatt.getService(
                        UUID.fromString(
                            Esp32Protocol.SERVICE_UUID
                        )
                    )


                if (service == null) {

                    _status.value =
                        "ESP32 service not found"

                    return
                }


                writeCharacteristic =
                    service.getCharacteristic(
                        UUID.fromString(
                            Esp32Protocol.WRITE_UUID
                        )
                    )


                val notifyCharacteristic =
                    service.getCharacteristic(
                        UUID.fromString(
                            Esp32Protocol.NOTIFY_UUID
                        )
                    )


                if (
                    writeCharacteristic == null
                ) {

                    _status.value =
                        "Write characteristic not found"

                    return
                }


                if (
                    notifyCharacteristic != null
                ) {

                    enableNotifications(
                        gatt,
                        notifyCharacteristic
                    )
                }


                _status.value =
                    "Ready"
            }


            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic:
                BluetoothGattCharacteristic
            ) {

                if (
                    characteristic.uuid ==
                    UUID.fromString(
                        Esp32Protocol.NOTIFY_UUID
                    )
                ) {

                    val data =
                        characteristic.value

                    val text =
                        data.toString(
                            Charsets.UTF_8
                        )

                    _lastReceivedData.value =
                        text
                }
            }


            @Deprecated("Deprecated Bluetooth API")
            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic:
                BluetoothGattCharacteristic,
                value: ByteArray
            ) {

                if (
                    characteristic.uuid ==
                    UUID.fromString(
                        Esp32Protocol.NOTIFY_UUID
                    )
                ) {

                    _lastReceivedData.value =
                        value.toString(
                            Charsets.UTF_8
                        )
                }
            }
        }


    /*
     * ============================================================
     * ENABLE NOTIFICATIONS
     * ============================================================
     */

    @SuppressLint("MissingPermission")
    private fun enableNotifications(
        gatt: BluetoothGatt,
        characteristic:
        BluetoothGattCharacteristic
    ) {

        gatt.setCharacteristicNotification(
            characteristic,
            true
        )


        val descriptor =
            characteristic.getDescriptor(
                UUID.fromString(
                    "00002902-0000-1000-8000-00805f9b34fb"
                )
            )


        if (descriptor != null) {

            descriptor.value =
                BluetoothGattDescriptor
                    .ENABLE_NOTIFICATION_VALUE

            gatt.writeDescriptor(
                descriptor
            )
        }
    }


    /*
     * ============================================================
     * PERMISSION
     * ============================================================
     */

    private fun hasBluetoothPermission():
            Boolean {

        return if (
            android.os.Build.VERSION.SDK_INT >=
            android.os.Build.VERSION_CODES.S
        ) {

            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_CONNECT
            ) ==
                    PackageManager.PERMISSION_GRANTED

        } else {

            true
        }
    }
}