package com.example.match_o

import android.bluetooth.BluetoothDevice

data class Esp32Device(
    val device: BluetoothDevice,
    val name: String,
    val address: String
)