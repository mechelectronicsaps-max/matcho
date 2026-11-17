package com.example.match_o

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Battery0Bar
import androidx.compose.material.icons.filled.Battery1Bar
import androidx.compose.material.icons.filled.Battery3Bar
import androidx.compose.material.icons.filled.Battery5Bar
import androidx.compose.material.icons.filled.BatteryFull
import androidx.compose.material.icons.filled.BatteryUnknown
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.BluetoothSearching
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.NetworkWifi
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Router
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Thermostat
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.google.zxing.common.BitMatrix
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.util.Locale
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.round
import kotlin.math.sin

object MatchOColors {
    val Background = Color(0xFF000000)
    val Surface = Color(0xFF0D0D0D)
    val SurfaceElevated = Color(0xFF141814)
    val PrimaryGreen = Color(0xFF00E676)
    val DeepGreen = Color(0xFF00C853)
    val DimGreen = Color(0xFF1B3A2A)
    val TextPrimary = Color(0xFFE8FFF0)
    val TextSecondary = Color(0xFF7CAE8C)
    val HeatAmber = Color(0xFFFFB300)
    val AlertRed = Color(0xFFFF3333)
}

private const val FIRMWARE_NOTIFICATION_CHANNEL_ID = "firmware_updates"
private const val FIRMWARE_NOTIFICATION_ID = 1001

private fun showFirmwareDownloadedNotification(context: Context, version: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
        != PackageManager.PERMISSION_GRANTED
    ) {
        // No notification permission on Android 13+; the in-app toast/icon
        // state still shows the download is ready.
        return
    }

    val notification = NotificationCompat.Builder(context, FIRMWARE_NOTIFICATION_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_download_done)
        .setContentTitle("Firmware download complete")
        .setContentText("Firmware $version is ready. Open Match-O and tap Update Firmware to install.")
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .build()

    NotificationManagerCompat.from(context).notify(FIRMWARE_NOTIFICATION_ID, notification)
}

private val MatchODarkScheme = darkColorScheme(
    primary = MatchOColors.PrimaryGreen,
    onPrimary = Color.Black,
    background = MatchOColors.Background,
    onBackground = MatchOColors.TextPrimary,
    surface = MatchOColors.Surface,
    onSurface = MatchOColors.TextPrimary,
    secondary = MatchOColors.DeepGreen,
    onSecondary = Color.Black
)

private enum class AppScreen {
    SCANNING,
    DEVICE_LIST,
    DASHBOARD
}

class MainActivity : ComponentActivity() {

    private lateinit var bleManager: Esp32BleManager
    lateinit var firmwareManager: FirmwareUpdateManager

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            startBleScan()
        }

    private val enableBluetoothLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            if (bleManager.isBluetoothEnabled()) {
                bleManager.startScan()
            }
        }

    val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
            if (isGranted) {
                openBarcodeScanner()
            } else {
                Toast.makeText(this, "Camera permission is required to scan samples", Toast.LENGTH_SHORT).show()
            }
        }

    val barcodeLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == RESULT_OK) {
                val scannedData = result.data?.getStringExtra("SCAN_RESULT") ?: ""
                Toast.makeText(this, "Scanned Sample: $scannedData", Toast.LENGTH_LONG).show()
            }
        }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* no-op either way */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bleManager = Esp32BleManager(this)
        firmwareManager = FirmwareUpdateManager(this)

        createFirmwareNotificationChannel()
        requestNotificationPermissionIfNeeded()

        setContent {
            MaterialTheme(colorScheme = MatchODarkScheme) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MatchOColors.Background
                ) {
                    MatchOApp(
                        activityScope = lifecycleScope,
                        bleManager = bleManager,
                        firmwareManager = firmwareManager,
                        requestPermissions = { requestBluetoothPermissions() },
                        onScanPatientSample = { requestCameraPermissionAndScan() }
                    )
                }
            }
        }
    }

    private fun createFirmwareNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                FIRMWARE_NOTIFICATION_CHANNEL_ID,
                "Firmware Updates",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifies when a new Match-O firmware download finishes"
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun requestCameraPermissionAndScan() {
        cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
    }

    private fun openBarcodeScanner() {
        val intent = Intent(this, BarcodeScannerActivity::class.java)
        barcodeLauncher.launch(intent)
    }

    private fun requestBluetoothPermissions() {
        val permissions =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                arrayOf(
                    Manifest.permission.BLUETOOTH_SCAN,
                    Manifest.permission.BLUETOOTH_CONNECT
                )
            } else {
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        permissionLauncher.launch(permissions)
    }

    private fun startBleScan() {
        if (!bleManager.isBluetoothEnabled()) {
            enableBluetoothLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            return
        }
        bleManager.startScan()
    }

    override fun onDestroy() {
        bleManager.cleanup()
        super.onDestroy()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MatchOApp(
    activityScope: kotlinx.coroutines.CoroutineScope,
    bleManager: Esp32BleManager,
    firmwareManager: FirmwareUpdateManager,
    requestPermissions: () -> Unit,
    onScanPatientSample: () -> Unit
) {
    val context = LocalContext.current
    val connected by bleManager.connected.collectAsState()
    val status by bleManager.status.collectAsState()
    val devices by bleManager.devices.collectAsState()
    val receivedData by bleManager.lastReceivedData.collectAsState()
    val firmwareProgress by bleManager.firmwareProgress.collectAsState()
    val firmwareSource by bleManager.firmwareSource.collectAsState()
    val otaInstalledVersion by bleManager.otaInstalledVersion.collectAsState()
    val firmwareState by firmwareManager.firmwareState.collectAsState()

    var screen by remember { mutableStateOf(AppScreen.SCANNING) }
    var isScanning by remember { mutableStateOf(false) }
    var menuExpanded by remember { mutableStateOf(false) }

    val connectedMac by bleManager.connectedDeviceAddress.collectAsState()

    // Pressing the system/hardware Back button steps back to the previous
    // screen instead of closing the app. Only intercepted when there IS a
    // previous in-app screen to go to — on SCANNING (the root screen) Back
    // is left enabled=false so the normal "exit app" behaviour still applies.
    BackHandler(enabled = screen != AppScreen.SCANNING) {
        when (screen) {
            AppScreen.DEVICE_LIST -> {
                bleManager.stopScan()
                screen = AppScreen.SCANNING
            }
            AppScreen.DASHBOARD -> {
                // Same as the "Disconnect" menu action — there's no
                // "screen before Dashboard" to return to since Dashboard
                // is reached automatically on connect from either screen.
                bleManager.disconnect()
                screen = AppScreen.SCANNING
            }
            AppScreen.SCANNING -> Unit
        }
    }

    val menuFirmwareInfiniteTransition = rememberInfiniteTransition(label = "menu_firmware_spin")
    val menuFirmwareSpinAngle by menuFirmwareInfiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1000, easing = LinearEasing)
        ),
        label = "menu_firmware_spin_angle"
    )

    // Automatically checks the server for a new firmware version every time
    // the app opens (does NOT push anything to the ESP32 - that still only
    // happens when the user taps "Update Firmware"). This must NOT be
    // gated on firmwareState.isDownloaded: that flag stays true across
    // launches once ANY version has ever been cached, so a guard like
    // "only check if nothing is downloaded yet" would mean the app only
    // ever auto-checks once, the very first time it's ever used, and never
    // again after that. checkForUpdatesAndDownload() already does its own
    // cheap version.json check and skips re-downloading when the cached
    // file already matches the latest version, so it's safe to call every
    // launch. If a new version IS found, this is what drives the
    // "Downloading Firmware" card and the spinning icon into view, and the
    // Update Firmware card's color change (green -> red) once it finishes -
    // both already reactive to firmwareState, they just need something to
    // actually kick off a download without the user tapping first.
    LaunchedEffect(Unit) {
        if (!firmwareState.isDownloading) {
            firmwareManager.checkForUpdatesAndDownload()
        }
    }

    // Fires the "download finished" notification exactly once, on the
    // transition out of isDownloading into a completed, downloaded state
    // (not on the initial state restored from a previous session).
    var wasDownloading by remember { mutableStateOf(false) }
    LaunchedEffect(firmwareState.isDownloading, firmwareState.isDownloaded) {
        if (wasDownloading && !firmwareState.isDownloading && firmwareState.isDownloaded) {
            showFirmwareDownloadedNotification(context, firmwareState.version)
            Toast.makeText(
                context,
                "Firmware ${firmwareState.version} downloaded - tap Update Firmware to install",
                Toast.LENGTH_LONG
            ).show()
        }
        wasDownloading = firmwareState.isDownloading
    }

    // Persists the confirmed installed version once the ESP32 boots the
    // new firmware and reports otaStatus=success. Without this, the app's
    // "installed_version" bookkeeping (and the "Update Firmware (vX)"
    // label) never advances past its old value, even after a successful
    // update — the ESP32 confirming success is not enough on its own;
    // the phone has to be told to remember it too.
    LaunchedEffect(otaInstalledVersion) {
        val confirmedVersion = otaInstalledVersion
        if (!confirmedVersion.isNullOrBlank()) {
            firmwareManager.markFirmwareInstalled(confirmedVersion)
            Toast.makeText(
                context,
                "MATCH-O updated to $confirmedVersion",
                Toast.LENGTH_LONG
            ).show()
            bleManager.clearOtaInstalledVersion()
        }
    }

    val triggerDirectFirmwareUpdate: () -> Unit = {
        if (firmwareState.isDownloading) {
            Toast.makeText(
                context,
                "Already checking / downloading firmware...",
                Toast.LENGTH_SHORT
            ).show()
        } else if (firmwareState.isDownloaded) {
            val file = File(firmwareState.filePath)

            if (file.exists()) {
                activityScope.launch {
                    bleManager.updateFirmwareWithPriority(
                        firmwareState.firmwareUrl,
                        firmwareState.version,
                        file.readBytes()
                    ) { _ -> }
                }
            } else {
                Toast.makeText(
                    context,
                    "Firmware file missing",
                    Toast.LENGTH_SHORT
                ).show()
            }
        } else {
            // Nothing downloaded yet - check the server and download the
            // latest firmware now (this used to run automatically on app
            // start; now it only runs when the user taps this button).
            Toast.makeText(
                context,
                "Checking for firmware updates...",
                Toast.LENGTH_SHORT
            ).show()

            activityScope.launch {
                firmwareManager.checkForUpdatesAndDownload()

                val updatedState = firmwareManager.firmwareState.value
                if (updatedState.isDownloaded) {
                    val file = File(updatedState.filePath)
                    if (file.exists()) {
                        bleManager.updateFirmwareWithPriority(
                            updatedState.firmwareUrl,
                            updatedState.version,
                            file.readBytes()
                        ) { _ -> }
                    } else {
                        Toast.makeText(
                            context,
                            "Firmware file missing",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                } else {
                    Toast.makeText(
                        context,
                        "No firmware update available",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }
    }

    LaunchedEffect(connected) {
        if (connected) {
            while (bleManager.connected.value) {
                if (bleManager.firmwareProgress.value < 0) {
                    bleManager.send("""{"cmd":"GET_DATA"}""")
                }
                delay(2000)
            }
        }
    }

    if (connected && screen != AppScreen.DASHBOARD) {
        screen = AppScreen.DASHBOARD
    }

    Column(modifier = Modifier.fillMaxSize()) {

        TopAppBar(
            title = {
                Text(
                    text = "Match-O",
                    color = MatchOColors.PrimaryGreen,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 18.sp
                )
            },
            actions = {
                Box {
                    IconButton(onClick = { menuExpanded = true }) {
                        Icon(
                            imageVector = Icons.Default.MoreVert,
                            contentDescription = "Menu",
                            tint = MatchOColors.PrimaryGreen
                        )
                    }
                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false }
                    ) {
                        if (connected) {
                            DropdownMenuItem(
                                text = { Text("Disconnect") },
                                leadingIcon = {
                                    Icon(Icons.Default.Bluetooth, contentDescription = null)
                                },
                                onClick = {
                                    menuExpanded = false
                                    bleManager.disconnect()
                                    screen = AppScreen.SCANNING
                                }
                            )
                        } else {
                            DropdownMenuItem(
                                text = { Text("Connect") },
                                leadingIcon = {
                                    Icon(Icons.Default.Bluetooth, contentDescription = null)
                                },
                                onClick = {
                                    menuExpanded = false
                                    val targetMac = bleManager.getAutoConnectAddress()
                                    if (targetMac != null) {
                                        val bluetoothAdapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
                                        val device = bluetoothAdapter?.getRemoteDevice(targetMac)
                                        if (device != null) {
                                            bleManager.connect(device)
                                        } else {
                                            requestPermissions()
                                            screen = AppScreen.DEVICE_LIST
                                        }
                                    } else {
                                        requestPermissions()
                                        screen = AppScreen.DEVICE_LIST
                                    }
                                }
                            )
                        }
                        DropdownMenuItem(
                            text = {
                                Text(
                                    if (firmwareState.isDownloading)
                                        "Downloading Firmware ${(firmwareState.downloadProgress * 100).toInt()}%"
                                    else
                                        "Update Firmware (${firmwareState.version})"
                                )
                            },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Default.SystemUpdate,
                                    contentDescription = null,
                                    tint = if (firmwareState.isDownloaded) MatchOColors.AlertRed else MatchOColors.PrimaryGreen,
                                    modifier = Modifier.rotate(if (firmwareState.isDownloading) menuFirmwareSpinAngle else 0f)
                                )
                            },
                            onClick = {
                                menuExpanded = false
                                triggerDirectFirmwareUpdate()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("About Us") },
                            leadingIcon = {
                                Icon(Icons.Default.Info, contentDescription = null)
                            },
                            onClick = { menuExpanded = false }
                        )
                    }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = MatchOColors.Background,
                titleContentColor = MatchOColors.PrimaryGreen
            )
        )

        when (screen) {
            AppScreen.SCANNING -> {
                BluetoothScanScreen(
                    isScanning = isScanning,
                    status = status,
                    onStartScan = {
                        isScanning = true
                        requestPermissions()
                        screen = AppScreen.DEVICE_LIST
                    }
                )
            }

            AppScreen.DEVICE_LIST -> {
                DeviceListScreen(
                    devices = devices,
                    status = status,
                    onRescan = {
                        isScanning = true
                        requestPermissions()
                    },
                    onStopScan = {
                        isScanning = false
                        bleManager.stopScan()
                    },
                    onSelectDevice = { device ->
                        bleManager.connect(device)
                    },
                    onBack = {
                        bleManager.stopScan()
                        screen = AppScreen.SCANNING
                    }
                )
            }

            AppScreen.DASHBOARD -> {
                DashboardScreen(
                    bleManager = bleManager,
                    status = status,
                    receivedData = receivedData,
                    connectedMac = connectedMac,
                    firmwareState = firmwareState,
                    onFirmwareUpdate = triggerDirectFirmwareUpdate,
                    onScanPatientSample = onScanPatientSample
                )
            }
        }

        if (firmwareProgress >= 0) {
            AlertDialog(
                onDismissRequest = { },
                title = { Text("Firmware Update") },
                text = {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        FirmwareDownloadRing(
                            progress = firmwareProgress / 100f,
                            diameter = 110.dp
                        )
                        Text(
                            text = if (firmwareProgress >= 100)
                                "Firmware transferred successfully. MATCH-O is restarting..."
                            else if (firmwareSource == "Network")
                                "Updating firmware over WiFi: $firmwareProgress%"
                            else
                                "Sending firmware over Bluetooth: $firmwareProgress%",
                            textAlign = TextAlign.Center
                        )
                    }
                },
                confirmButton = {}
            )
        }
    }
}

@Composable
fun DashboardScreen(
    bleManager: Esp32BleManager,
    status: String,
    receivedData: String,
    connectedMac: String,
    firmwareState: FirmwareState,
    onFirmwareUpdate: () -> Unit,
    onScanPatientSample: () -> Unit
) {
    var wifiDialog by remember { mutableStateOf(false) }
    var scannerDialog by remember { mutableStateOf(false) }
    var offsetPasswordDialog by remember { mutableStateOf(false) }
    var offsetDialog by remember { mutableStateOf(false) }
    var showMatchOBarcodesDialog by remember { mutableStateOf(false) }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val telemetry = remember(receivedData) {
        try { JSONObject(receivedData) } catch (_: Exception) { JSONObject() }
    }

    val temp = telemetry.optDouble("currentTemp", Double.NaN)
    val rssi = telemetry.optInt("wifiRSSI", -100)
    val ip = telemetry.optString("ip", "0.0.0.0")
    val mac = connectedMac.ifBlank { "--:--:--:--:--:--" }
    val ssid = telemetry.optString("ssid", "")
    val offset = telemetry.optDouble("offset", 0.0)
    val scannerConnected = telemetry.optBoolean("btConnected", false)
    val scannerBatteryVoltage = telemetry.optDouble("scannerBatteryVoltage", -1.0)
    val scannerBatteryPercent = telemetry.optInt("scannerBatteryPercent", -1)
    val scannerBatteryPending = telemetry.optBoolean("scannerBatteryPending", false)
    val hasScannerBattery = scannerBatteryPercent in 0..100

    val scannerBatteryIcon = when {
        scannerBatteryPending -> Icons.Default.BatteryUnknown
        !hasScannerBattery -> Icons.Default.BatteryUnknown
        scannerBatteryPercent <= 15 -> Icons.Default.Battery0Bar
        scannerBatteryPercent <= 40 -> Icons.Default.Battery1Bar
        scannerBatteryPercent <= 70 -> Icons.Default.Battery3Bar
        scannerBatteryPercent <= 90 -> Icons.Default.Battery5Bar
        else -> Icons.Default.BatteryFull
    }

    val scannerBatteryColor = when {
        !hasScannerBattery -> MatchOColors.TextSecondary
        scannerBatteryPercent <= 20 -> MatchOColors.AlertRed
        scannerBatteryPercent <= 50 -> MatchOColors.HeatAmber
        else -> MatchOColors.PrimaryGreen
    }

    val scannerBatteryValue = when {
        scannerBatteryPending -> "Checking..."
        !hasScannerBattery -> "--%"
        scannerBatteryVoltage > 0 -> String.format(Locale.US, "%d%% (%.2fV)", scannerBatteryPercent, scannerBatteryVoltage)
        else -> "$scannerBatteryPercent%"
    }

    val signalCategory = when {
        rssi <= -99 -> "UNKNOWN"
        rssi >= -65 -> "GOOD"
        rssi >= -80 -> "AVERAGE"
        else -> "BAD"
    }

    val signalColor = when (signalCategory) {
        "GOOD" -> MatchOColors.PrimaryGreen
        "AVERAGE" -> MatchOColors.HeatAmber
        "BAD" -> MatchOColors.AlertRed
        else -> MatchOColors.TextSecondary
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MatchOColors.Background)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        item {
            Text(
                text = if (status == "Ready" || status.startsWith("Connected"))
                    "Device Status" else status,
                color = MatchOColors.PrimaryGreen,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
        }

        item {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.height(330.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                    HeatwaveTelemetryCard(
                        label = "Temperature",
                        value = if (temp.isNaN()) "--.- °C"
                        else String.format(Locale.US, "%.1f °C", temp)
                    )
                }
                item {
                    WifiDotsTelemetryCard(
                        label = "WiFi Strength",
                        value = if (rssi <= -99) "-- dBm" else "$rssi dBm",
                        badgeText = signalCategory,
                        badgeColor = signalColor
                    )
                }
                item {
                    TelemetryCard(Icons.Default.Router, "IP Address", ip)
                }
                item {
                    TelemetryCard(Icons.Default.Bluetooth, "Bluetooth MAC", mac)
                }
                item {
                    ScannerBatteryTelemetryCard(
                        label = if (scannerConnected) "Scanner Battery (tap to check)" else "Scanner Battery",
                        value = scannerBatteryValue,
                        icon = scannerBatteryIcon,
                        color = scannerBatteryColor,
                        onClick = {
                            if (scannerConnected) bleManager.requestScannerBattery()
                        }
                    )
                }
                item {
                    ScannerModeButtonsCard(
                        wirelessMuted = !scannerConnected,
                        onWirelessClick = {
                            if (scannerConnected) {
                                bleManager.setScannerWirelessMode()
                                Toast.makeText(context, "Wireless mode sent to scanner", Toast.LENGTH_SHORT).show()
                            } else {
                                Toast.makeText(context, "Scanner not connected", Toast.LENGTH_SHORT).show()
                            }
                        },
                        onMatchOClick = {
                            showMatchOBarcodesDialog = true
                        }
                    )
                }
            }
        }

        item {
            Text(
                text = "Configuration",
                color = MatchOColors.PrimaryGreen,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
        }

        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ConfigRow(
                    icon = Icons.Default.NetworkWifi,
                    title = "WiFi Configuration",
                    subtitle = if (ssid.isBlank()) "Find nearby WiFi and configure" else "Connected: $ssid",
                    onClick = { wifiDialog = true }
                )
                ConfigRow(
                    icon = Icons.Default.QrCodeScanner,
                    title = "Barcode Scanner Configuration",
                    subtitle = when {
                        !scannerConnected -> "Find and select scanner"
                        hasScannerBattery -> "Scanner connected • $scannerBatteryPercent% battery"
                        else -> "Scanner connected"
                    },
                    onClick = { scannerDialog = true }
                )
                ConfigRow(
                    icon = Icons.Default.Tune,
                    title = "Temperature Offset",
                    subtitle = String.format(Locale.US, "Current offset: %.2f °C", offset),
                    onClick = { offsetPasswordDialog = true }
                )
            }
        }

        item {
            Text(
                text = "Actions",
                color = MatchOColors.PrimaryGreen,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
        }

        if (firmwareState.isDownloading) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MatchOColors.SurfaceElevated),
                    border = BorderStroke(1.dp, MatchOColors.DimGreen),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text(
                            text = "Downloading Firmware ${firmwareState.version}",
                            color = MatchOColors.TextPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        FirmwareDownloadRing(progress = firmwareState.downloadProgress)
                    }
                }
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                ActionCard(
                    icon = Icons.Default.QrCodeScanner,
                    label = "Scan Patient Sample",
                    modifier = Modifier.weight(1f),
                    onClick = onScanPatientSample
                )

                ActionCard(
                    icon = if (firmwareState.isDownloaded) Icons.Default.SystemUpdate else Icons.Default.Download,
                    label = if (firmwareState.isDownloading)
                        "Downloading Firmware ${(firmwareState.downloadProgress * 100).toInt()}%"
                    else
                        "Update Firmware (${firmwareState.version})",
                    modifier = Modifier.weight(1f),
                    iconTint = if (firmwareState.isDownloaded) MatchOColors.AlertRed else MatchOColors.PrimaryGreen,
                    isSpinning = firmwareState.isDownloading,
                    onClick = onFirmwareUpdate
                )
            }
        }
    }

    if (wifiDialog) {
        WifiConfigDialog(
            bleManager = bleManager,
            onDismiss = { wifiDialog = false }
        )
    }

    if (scannerDialog) {
        ScannerConfigDialog(
            bleManager = bleManager,
            onDismiss = { scannerDialog = false }
        )
    }

    if (offsetPasswordDialog) {
        PasswordPromptDialog(
            title = "Temperature Offset",
            message = "Enter password to access this setting.",
            onDismiss = { offsetPasswordDialog = false },
            onSuccess = {
                offsetPasswordDialog = false
                offsetDialog = true
            }
        )
    }

    if (offsetDialog) {
        OffsetDialog(
            bleManager = bleManager,
            initialOffset = offset.toFloat(),
            currentTemp = temp,
            onDismiss = { offsetDialog = false }
        )
    }

    if (showMatchOBarcodesDialog) {
        MatchOBarcodesDialog(
            onDismiss = { showMatchOBarcodesDialog = false },
            onSendAutomatically = {
                if (scannerConnected) {
                    scope.launch {
                        bleManager.setScannerMatchOMode()
                        Toast.makeText(context, "Match-O mode sent to scanner", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    Toast.makeText(context, "Scanner not connected", Toast.LENGTH_SHORT).show()
                }
            }
        )
    }
}

@Composable
fun ActionCard(
    icon: ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    iconTint: Color = MatchOColors.PrimaryGreen,
    isSpinning: Boolean = false,
    onClick: () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "action_card_spin")
    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1000, easing = LinearEasing)
        ),
        label = "action_card_spin_angle"
    )

    Card(
        modifier = modifier
            .aspectRatio(1.3f)
            .clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = MatchOColors.SurfaceElevated),
        border = BorderStroke(1.dp, MatchOColors.PrimaryGreen),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = iconTint,
                modifier = Modifier
                    .size(30.dp)
                    .rotate(if (isSpinning) rotation else 0f)
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = label,
                color = MatchOColors.TextPrimary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center
            )
        }
    }
}

// ================================================================
// FIRMWARE DOWNLOAD RING
// ================================================================
//
// A circular progress widget for the firmware download step:
//   - the circle fills with an animated "water" wave that rises to
//     match download progress
//   - the percentage is shown centered in the circle
//   - small sparkling dots orbit slowly around the outside, each
//     twinkling on its own staggered cycle

@Composable
fun FirmwareDownloadRing(
    progress: Float,
    modifier: Modifier = Modifier,
    diameter: Dp = 110.dp
) {
    val animatedFill by animateFloatAsState(
        targetValue = progress.coerceIn(0f, 1f),
        animationSpec = tween(durationMillis = 400, easing = LinearEasing),
        label = "firmware_fill_level"
    )

    val infiniteTransition = rememberInfiniteTransition(label = "firmware_ring")

    val wavePhase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = (2 * PI).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2200, easing = LinearEasing)
        ),
        label = "firmware_wave_phase"
    )

    val dotsRotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 7000, easing = LinearEasing)
        ),
        label = "firmware_dots_rotation"
    )

    val dotCount = 8
    val dotAlphas = (0 until dotCount).map { index ->
        val alpha by infiniteTransition.animateFloat(
            initialValue = 0.15f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 900, delayMillis = index * 110, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            ),
            label = "firmware_dot_sparkle_$index"
        )
        alpha
    }

    Box(
        modifier = modifier.size(diameter + 44.dp),
        contentAlignment = Alignment.Center
    ) {
        // Sparkling dots orbiting outside the circle
        Canvas(modifier = Modifier.matchParentSize()) {
            val center = Offset(size.width / 2f, size.height / 2f)
            val outerRadius = (diameter.toPx() / 2f) + 18.dp.toPx()

            for (i in 0 until dotCount) {
                val angleDeg = dotsRotation + (360f / dotCount) * i
                val angleRad = Math.toRadians(angleDeg.toDouble())
                val dotCenter = Offset(
                    x = center.x + outerRadius * cos(angleRad).toFloat(),
                    y = center.y + outerRadius * sin(angleRad).toFloat()
                )
                val dotAlpha = dotAlphas[i]
                drawCircle(
                    color = MatchOColors.PrimaryGreen.copy(alpha = dotAlpha),
                    radius = 2.dp.toPx() + (2.dp.toPx() * dotAlpha),
                    center = dotCenter
                )
            }
        }

        // Main circle with animated water fill
        Canvas(modifier = Modifier.size(diameter)) {
            val radius = size.minDimension / 2f
            val center = Offset(size.width / 2f, size.height / 2f)
            val circlePath = Path().apply {
                addOval(Rect(center = center, radius = radius))
            }

            drawCircle(color = MatchOColors.Surface, radius = radius, center = center)

            clipPath(circlePath) {
                val fillTop = size.height * (1f - animatedFill)
                val amplitude = 4.dp.toPx()
                val waveLength = size.width / 1.3f
                val steps = 32
                val stepX = size.width / steps

                fun wavePath(phaseOffset: Float): Path {
                    return Path().apply {
                        moveTo(0f, size.height)
                        lineTo(0f, fillTop)
                        for (i in 0..steps) {
                            val x = i * stepX
                            val y = fillTop + sin(wavePhase + phaseOffset + x / waveLength) * amplitude
                            lineTo(x, y)
                        }
                        lineTo(size.width, size.height)
                        close()
                    }
                }

                // Back wave (dimmer, phase-shifted for depth)
                drawPath(
                    path = wavePath(phaseOffset = PI.toFloat() / 2f),
                    color = MatchOColors.DeepGreen.copy(alpha = 0.55f)
                )
                // Front wave
                drawPath(
                    path = wavePath(phaseOffset = 0f),
                    color = MatchOColors.PrimaryGreen.copy(alpha = 0.85f)
                )
            }

            drawCircle(
                color = MatchOColors.PrimaryGreen,
                radius = radius,
                center = center,
                style = Stroke(width = 2.dp.toPx())
            )
        }

        Text(
            text = "${(animatedFill * 100).toInt()}%",
            color = MatchOColors.TextPrimary,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
fun BluetoothScanScreen(
    isScanning: Boolean,
    status: String,
    onStartScan: () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "ble_pulse")
    val pulseCount = 3
    val pulseDurationMs = 2400

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MatchOColors.Background)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(180.dp)
        ) {
            for (i in 0 until pulseCount) {
                val pulseProgress by infiniteTransition.animateFloat(
                    initialValue = 0f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(
                            durationMillis = pulseDurationMs,
                            delayMillis = i * (pulseDurationMs / pulseCount),
                            easing = LinearEasing
                        ),
                        repeatMode = RepeatMode.Restart
                    ),
                    label = "pulse_ring_$i"
                )

                Box(
                    modifier = Modifier
                        .size(110.dp + (70.dp * pulseProgress))
                        .background(
                            color = MatchOColors.PrimaryGreen.copy(
                                alpha = (1f - pulseProgress) * 0.35f
                            ),
                            shape = CircleShape
                        )
                )
            }

            val glowAlpha by infiniteTransition.animateFloat(
                initialValue = 0.15f,
                targetValue = 0.4f,
                animationSpec = infiniteRepeatable(
                    animation = tween(durationMillis = 900, easing = LinearEasing),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "icon_glow"
            )

            Box(
                modifier = Modifier
                    .size(126.dp)
                    .background(
                        color = MatchOColors.PrimaryGreen.copy(alpha = glowAlpha),
                        shape = CircleShape
                    )
            )

            Box(
                modifier = Modifier
                    .size(110.dp)
                    .background(
                        color = MatchOColors.SurfaceElevated,
                        shape = CircleShape
                    )
                    .border(
                        width = 2.dp,
                        color = MatchOColors.PrimaryGreen,
                        shape = CircleShape
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Bluetooth,
                    contentDescription = "Bluetooth",
                    tint = MatchOColors.PrimaryGreen,
                    modifier = Modifier.size(52.dp)
                )
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        Text(
            text = if (isScanning) "Scanning for devices..." else "Ready to connect",
            color = MatchOColors.TextPrimary,
            fontSize = 18.sp,
            fontWeight = FontWeight.Medium
        )

        Spacer(modifier = Modifier.height(6.dp))

        Text(
            text = status,
            color = MatchOColors.TextSecondary,
            fontSize = 13.sp
        )

        Spacer(modifier = Modifier.height(36.dp))

        GreenActionButton(
            text = "SCAN FOR MATCH-O DEVICE",
            icon = Icons.Default.BluetoothSearching,
            onClick = onStartScan
        )
    }
}

@Composable
fun DeviceListScreen(
    devices: List<BluetoothDevice>,
    status: String,
    onRescan: () -> Unit,
    onStopScan: () -> Unit,
    onSelectDevice: (BluetoothDevice) -> Unit,
    onBack: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MatchOColors.Background)
            .padding(20.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Select MATCH-O Device",
                color = MatchOColors.PrimaryGreen,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                IconButton(onClick = onRescan) {
                    Icon(
                        imageVector = Icons.Default.BluetoothSearching,
                        contentDescription = "Rescan",
                        tint = MatchOColors.PrimaryGreen
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            text = status,
            color = MatchOColors.TextSecondary,
            fontSize = 12.sp
        )

        Spacer(modifier = Modifier.height(16.dp))

        if (devices.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = Icons.Default.BluetoothSearching,
                        contentDescription = null,
                        tint = MatchOColors.DimGreen,
                        modifier = Modifier.size(48.dp)
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "No devices found yet",
                        color = MatchOColors.TextSecondary
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(items = devices, key = { it.address }) { device ->
                    DeviceRow(
                        device = device,
                        onConnect = { onSelectDevice(device) }
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            GreenOutlineButton(
                text = "Stop Scan",
                modifier = Modifier.weight(1f),
                onClick = onStopScan
            )
            GreenOutlineButton(
                text = "Back",
                modifier = Modifier.weight(1f),
                onClick = onBack
            )
        }
    }
}

@Composable
fun DeviceRow(
    device: BluetoothDevice,
    onConnect: () -> Unit
) {
    val name = try { device.name ?: "Unknown MATCH-O" } catch (_: SecurityException) { "Unknown MATCH-O" }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onConnect() },
        colors = CardDefaults.cardColors(containerColor = MatchOColors.Surface),
        border = BorderStroke(1.dp, MatchOColors.DimGreen),
        shape = RoundedCornerShape(14.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Bluetooth,
                    contentDescription = null,
                    tint = MatchOColors.PrimaryGreen,
                    modifier = Modifier.size(28.dp)
                )
                Column(modifier = Modifier.padding(start = 12.dp)) {
                    Text(
                        text = name,
                        color = MatchOColors.TextPrimary,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        text = "MAC: ${device.address}",
                        color = MatchOColors.TextSecondary,
                        fontSize = 12.sp
                    )
                }
            }

            GreenActionButton(text = "Connect", onClick = onConnect, compact = true)
        }
    }
}

private const val OFFSET_SETTING_PASSWORD = "Lifetech@2026"

@Composable
private fun PasswordPromptDialog(
    title: String,
    message: String,
    onDismiss: () -> Unit,
    onSuccess: () -> Unit
) {
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(message, color = MatchOColors.TextSecondary, fontSize = 13.sp)
                OutlinedTextField(
                    value = password,
                    onValueChange = {
                        password = it
                        error = false
                    },
                    label = { Text("Password") },
                    singleLine = true,
                    isError = error,
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        TextButton(onClick = { showPassword = !showPassword }) {
                            Text(if (showPassword) "HIDE" else "SHOW")
                        }
                    }
                )
                if (error) {
                    Text(
                        text = "Incorrect password. Please try again.",
                        color = Color(0xFFFF5252),
                        fontSize = 12.sp
                    )
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                if (password == OFFSET_SETTING_PASSWORD) {
                    onSuccess()
                } else {
                    error = true
                }
            }) { Text("UNLOCK") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("CANCEL") }
        }
    )
}

@Composable
private fun WifiConfigDialog(
    bleManager: Esp32BleManager,
    onDismiss: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var networks by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var selectedSsid by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        loading = true
        networks = bleManager.scanWifi()
        loading = false
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("WiFi Configuration") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (loading) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(22.dp))
                        Spacer(modifier = Modifier.size(8.dp))
                        Text("Finding nearby WiFi...")
                    }
                } else if (networks.isEmpty()) {
                    Text("No WiFi networks found. Tap RESCAN.")
                } else {
                    networks.forEach { net ->
                        val name = net.optString("ssid")
                        val signal = net.optInt("rssi")
                        Text(
                            text = "$name  ($signal dBm)",
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { selectedSsid = name }
                                .padding(vertical = 8.dp),
                            color = if (selectedSsid == name)
                                MatchOColors.PrimaryGreen else MatchOColors.TextPrimary
                        )
                    }
                }

                if (selectedSsid.isNotBlank()) {
                    Text("Selected: $selectedSsid", color = MatchOColors.PrimaryGreen)
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("WiFi Password") },
                        singleLine = true
                    )
                }
            }
        },
        confirmButton = {
            Row {
                TextButton(onClick = {
                    loading = true
                    scope.launch {
                        networks = bleManager.scanWifi()
                        loading = false
                    }
                }) { Text("RESCAN") }
                Button(
                    enabled = selectedSsid.isNotBlank() && !loading,
                    onClick = {
                        bleManager.saveWifi(selectedSsid, password)
                        onDismiss()
                    }
                ) { Text("SAVE") }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("CANCEL") }
        }
    )
}

@Composable
private fun ScannerConfigDialog(
    bleManager: Esp32BleManager,
    onDismiss: () -> Unit
) {
    // Scans with the PHONE's own Bluetooth radio (same as Android
    // Settings > Bluetooth). Once a device is picked, its MAC is handed
    // to the ESP32 and the scanner is unpaired from the phone so the
    // ESP32 is free to connect to it.
    val devices by bleManager.phoneScannerDevices.collectAsState()
    val scanning by bleManager.phoneScanActive.collectAsState()

    DisposableEffect(Unit) {
        bleManager.startPhoneScannerDiscovery()
        onDispose {
            bleManager.stopPhoneScannerDiscovery()
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Barcode Scanner") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = "Searching this phone's Bluetooth for the scanner. " +
                            "Selecting one hands it off to the device and unpairs " +
                            "it from this phone.",
                    color = MatchOColors.TextSecondary,
                    fontSize = 12.sp
                )

                Text(
                    text = "Tip: once connected, tap the \"Scanner Battery\" card on " +
                            "the dashboard any time to check the battery level - no need " +
                            "to physically scan the battery barcode.",
                    color = MatchOColors.TextSecondary,
                    fontSize = 11.sp
                )

                if (scanning) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(22.dp))
                        Spacer(modifier = Modifier.size(8.dp))
                        Text("Searching scanners...")
                    }
                }

                if (!scanning && devices.isEmpty()) {
                    Text("No scanner found. Put the scanner in pairing mode and rescan.")
                } else {
                    devices.forEach { d ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    bleManager.selectPhoneScannerDevice(d)
                                    onDismiss()
                                }
                                .padding(vertical = 8.dp)
                        ) {
                            Text(d.name, color = MatchOColors.TextPrimary)
                            Text(d.mac, color = MatchOColors.TextSecondary, fontSize = 12.sp)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                bleManager.startPhoneScannerDiscovery()
            }) { Text("RESCAN") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("CANCEL") }
        }
    )
}

@Composable
private fun OffsetDialog(
    bleManager: Esp32BleManager,
    initialOffset: Float,
    currentTemp: Double,
    onDismiss: () -> Unit
) {
    var offsetValue by remember(initialOffset) { mutableStateOf(initialOffset) }
    var isEditing by remember { mutableStateOf(false) }
    var editText by remember(initialOffset) {
        mutableStateOf(String.format(Locale.US, "%.2f", initialOffset))
    }

    fun pushLive(newValue: Float) {
        offsetValue = newValue
        editText = String.format(Locale.US, "%.2f", newValue)
        bleManager.saveOffset(newValue)
    }

    fun revertAndClose() {
        if (offsetValue != initialOffset) {
            bleManager.saveOffset(initialOffset)
        }
        onDismiss()
    }

    AlertDialog(
        onDismissRequest = { revertAndClose() },
        title = { Text("Temperature Offset") },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text(
                    text = "Rotate the knob — the offset applies live on the device as you turn it.",
                    color = MatchOColors.TextSecondary,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center
                )

                Box(
                    modifier = Modifier.size(210.dp),
                    contentAlignment = Alignment.Center
                ) {
                    OffsetKnob(
                        offset = offsetValue,
                        onOffsetChange = { pushLive(it) },
                        modifier = Modifier.fillMaxSize()
                    )

                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = if (currentTemp.isNaN()) "--.- °C"
                            else String.format(Locale.US, "%.1f °C", currentTemp),
                            color = MatchOColors.TextPrimary,
                            fontSize = 22.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = "Live Temp",
                            color = MatchOColors.TextSecondary,
                            fontSize = 10.sp
                        )
                    }
                }

                if (isEditing) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedTextField(
                            value = editText,
                            onValueChange = { editText = it },
                            singleLine = true,
                            label = { Text("Offset (°C)") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.width(150.dp)
                        )
                        TextButton(onClick = {
                            editText.toFloatOrNull()?.let { pushLive(it) }
                            isEditing = false
                        }) { Text("DONE") }
                    }
                } else {
                    TextButton(onClick = {
                        editText = String.format(Locale.US, "%.2f", offsetValue)
                        isEditing = true
                    }) {
                        Text("EDIT MANUALLY")
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                val finalValue = if (isEditing) (editText.toFloatOrNull() ?: offsetValue) else offsetValue
                pushLive(finalValue)
                onDismiss()
            }) { Text("SET") }
        },
        dismissButton = {
            TextButton(onClick = { revertAndClose() }) { Text("CANCEL") }
        }
    )
}

private const val OFFSET_KNOB_STEP = 0.1f
private const val DEGREES_PER_STEP = 12f

@Composable
private fun OffsetKnob(
    offset: Float,
    onOffsetChange: (Float) -> Unit,
    modifier: Modifier = Modifier
) {
    val latestOffset = rememberUpdatedState(offset)
    val latestOnOffsetChange = rememberUpdatedState(onOffsetChange)
    val textMeasurer = rememberTextMeasurer()

    var lastAngleDeg by remember { mutableStateOf<Float?>(null) }
    var accumulatedDeg by remember { mutableStateOf(0f) }
    var knobRotationDeg by remember { mutableStateOf(0f) }

    fun angleOf(pos: Offset, center: Offset): Float {
        val dx = pos.x - center.x
        val dy = pos.y - center.y
        return Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
    }

    Canvas(
        modifier = modifier
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { pos ->
                        val center = Offset(size.width / 2f, size.height / 2f)
                        lastAngleDeg = angleOf(pos, center)
                        accumulatedDeg = 0f
                    },
                    onDragEnd = { lastAngleDeg = null },
                    onDragCancel = { lastAngleDeg = null }
                ) { change, _ ->
                    change.consume()
                    val center = Offset(size.width / 2f, size.height / 2f)
                    val angle = angleOf(change.position, center)
                    val previous = lastAngleDeg
                    if (previous != null) {
                        var delta = angle - previous
                        if (delta > 180f) delta -= 360f
                        if (delta < -180f) delta += 360f

                        accumulatedDeg += delta
                        knobRotationDeg += delta

                        while (accumulatedDeg >= DEGREES_PER_STEP) {
                            val next = round((latestOffset.value + OFFSET_KNOB_STEP) * 100f) / 100f
                            latestOnOffsetChange.value(next)
                            accumulatedDeg -= DEGREES_PER_STEP
                        }
                        while (accumulatedDeg <= -DEGREES_PER_STEP) {
                            val next = round((latestOffset.value - OFFSET_KNOB_STEP) * 100f) / 100f
                            latestOnOffsetChange.value(next)
                            accumulatedDeg -= DEGREES_PER_STEP
                        }
                    }
                    lastAngleDeg = angle
                }
            }
    ) {
        val strokeWidth = 10.dp.toPx()
        val radius = (size.minDimension - strokeWidth) / 2f
        val center = Offset(size.width / 2f, size.height / 2f)

        drawCircle(
            color = MatchOColors.DimGreen,
            radius = radius,
            center = center,
            style = Stroke(width = strokeWidth)
        )

        val tickCount = 24
        for (i in 0 until tickCount) {
            val angleRad = Math.toRadians((i * (360f / tickCount)).toDouble())
            val innerR = radius - strokeWidth
            val outerR = radius + strokeWidth / 2f
            drawLine(
                color = MatchOColors.TextSecondary.copy(alpha = 0.4f),
                start = Offset(
                    center.x + (innerR * cos(angleRad)).toFloat(),
                    center.y + (innerR * sin(angleRad)).toFloat()
                ),
                end = Offset(
                    center.x + (outerR * cos(angleRad)).toFloat(),
                    center.y + (outerR * sin(angleRad)).toFloat()
                ),
                strokeWidth = 2f
            )
        }

        val indicatorAngleRad = Math.toRadians(knobRotationDeg.toDouble())
        val dotCenter = Offset(
            center.x + (radius * cos(indicatorAngleRad)).toFloat(),
            center.y + (radius * sin(indicatorAngleRad)).toFloat()
        )
        drawCircle(
            color = MatchOColors.PrimaryGreen,
            radius = strokeWidth / 1.4f,
            center = dotCenter
        )

        val labelText = String.format(Locale.US, "%+.1f", latestOffset.value)
        val textLayout = textMeasurer.measure(
            text = AnnotatedString(labelText),
            style = TextStyle(
                color = MatchOColors.PrimaryGreen,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold
            )
        )
        val labelRadius = radius + strokeWidth * 1.7f
        val labelCenter = Offset(
            center.x + (labelRadius * cos(indicatorAngleRad)).toFloat(),
            center.y + (labelRadius * sin(indicatorAngleRad)).toFloat()
        )
        drawText(
            textLayoutResult = textLayout,
            topLeft = Offset(
                labelCenter.x - textLayout.size.width / 2f,
                labelCenter.y - textLayout.size.height / 2f
            )
        )

        val faceRadius = radius - strokeWidth * 1.6f
        drawCircle(
            color = MatchOColors.SurfaceElevated,
            radius = faceRadius,
            center = center
        )
        drawCircle(
            color = MatchOColors.PrimaryGreen,
            radius = faceRadius,
            center = center,
            style = Stroke(width = 2.dp.toPx())
        )
    }
}

@Composable
fun TelemetryCard(
    icon: ImageVector,
    label: String,
    value: String
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1.6f),
        colors = CardDefaults.cardColors(containerColor = MatchOColors.SurfaceElevated),
        border = BorderStroke(1.dp, MatchOColors.DimGreen),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(14.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = MatchOColors.PrimaryGreen,
                modifier = Modifier.size(22.dp)
            )
            Column {
                Text(
                    text = value,
                    color = MatchOColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = label,
                    color = MatchOColors.TextSecondary,
                    fontSize = 11.sp
                )
            }
        }
    }
}

@Composable
fun HeatwaveTelemetryCard(
    label: String,
    value: String
) {
    val infiniteTransition = rememberInfiniteTransition(label = "heatwave")

    val wavePhase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = (2 * PI).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1800, easing = LinearEasing)
        ),
        label = "heat_wave_phase"
    )

    val iconGlow by infiniteTransition.animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 800, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "heat_icon_glow"
    )

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1.6f),
        colors = CardDefaults.cardColors(containerColor = MatchOColors.SurfaceElevated),
        border = BorderStroke(1.dp, MatchOColors.DimGreen),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(14.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(24.dp)
            ) {
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val amplitude = size.height / 3.2f
                    for (line in 0..2) {
                        val path = Path()
                        val baseY = size.height - (line * amplitude * 0.55f) - amplitude / 2f
                        var x = 0f
                        var started = false
                        while (x <= size.width) {
                            val y = baseY + amplitude * sin(wavePhase + x / 34f + line * 1.4f)
                            if (!started) {
                                path.moveTo(x, y)
                                started = true
                            } else {
                                path.lineTo(x, y)
                            }
                            x += 4f
                        }
                        drawPath(
                            path = path,
                            color = MatchOColors.HeatAmber.copy(alpha = 0.35f - line * 0.08f),
                            style = Stroke(width = 2.5f)
                        )
                    }
                }

                Icon(
                    imageVector = Icons.Default.Thermostat,
                    contentDescription = label,
                    tint = MatchOColors.HeatAmber.copy(alpha = iconGlow),
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .size(20.dp)
                )
            }

            Column {
                Text(
                    text = value,
                    color = MatchOColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = label,
                    color = MatchOColors.TextSecondary,
                    fontSize = 11.sp
                )
            }
        }
    }
}

@Composable
fun WifiDotsTelemetryCard(
    label: String,
    value: String,
    badgeText: String,
    badgeColor: Color
) {
    val infiniteTransition = rememberInfiniteTransition(label = "wifi_dots")
    val dotCount = 4

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1.6f),
        colors = CardDefaults.cardColors(containerColor = MatchOColors.SurfaceElevated),
        border = BorderStroke(1.dp, MatchOColors.DimGreen),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(14.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    for (dot in 0 until dotCount) {
                        val dotAlpha by infiniteTransition.animateFloat(
                            initialValue = 0.25f,
                            targetValue = 1f,
                            animationSpec = infiniteRepeatable(
                                animation = tween(
                                    durationMillis = 700,
                                    delayMillis = dot * 160,
                                    easing = LinearEasing
                                ),
                                repeatMode = RepeatMode.Reverse
                            ),
                            label = "wifi_dot_$dot"
                        )

                        Box(
                            modifier = Modifier
                                .size(width = 6.dp, height = (8 + dot * 5).dp)
                                .background(
                                    color = MatchOColors.PrimaryGreen.copy(alpha = dotAlpha),
                                    shape = RoundedCornerShape(2.dp)
                                )
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .background(
                            color = badgeColor.copy(alpha = 0.2f),
                            shape = RoundedCornerShape(6.dp)
                        )
                        .border(1.dp, badgeColor, RoundedCornerShape(6.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = badgeText,
                        color = badgeColor,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Column {
                Text(
                    text = value,
                    color = MatchOColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = label,
                    color = MatchOColors.TextSecondary,
                    fontSize = 11.sp
                )
            }
        }
    }
}

@Composable
fun ScannerBatteryTelemetryCard(
    label: String,
    value: String,
    icon: ImageVector,
    color: Color,
    onClick: () -> Unit = {}
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1.6f)
            .clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = MatchOColors.SurfaceElevated),
        border = BorderStroke(1.dp, MatchOColors.DimGreen),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(14.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = color,
                modifier = Modifier.size(22.dp)
            )
            Column {
                Text(
                    text = value,
                    color = MatchOColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = label,
                    color = MatchOColors.TextSecondary,
                    fontSize = 11.sp
                )
            }
        }
    }
}

@Composable
fun ScannerModeButtonsCard(
    wirelessMuted: Boolean,
    onWirelessClick: () -> Unit,
    onMatchOClick: () -> Unit
) {
    // Stacks two buttons so their combined height (plus the gap
    // between them) matches the battery card's height exactly, since
    // both sit in the same grid cell width/aspect ratio.
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1.6f),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        ScannerModeButton(
            text = if (wirelessMuted) "Wireless Mode (Scanner Offline)" else "Wireless Mode",
            icon = Icons.Default.NetworkWifi,
            enabled = !wirelessMuted,
            modifier = Modifier.weight(1f),
            onClick = onWirelessClick
        )
        ScannerModeButton(
            text = "Match-O Mode",
            icon = Icons.Default.Bluetooth,
            enabled = true,
            modifier = Modifier.weight(1f),
            onClick = onMatchOClick
        )
    }
}

@Composable
private fun ScannerModeButton(
    text: String,
    icon: ImageVector,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val contentAlpha = if (enabled) 1f else 0.4f
    val borderColor = if (enabled) MatchOColors.DimGreen else MatchOColors.TextSecondary.copy(alpha = 0.4f)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(
                color = MatchOColors.SurfaceElevated.copy(alpha = if (enabled) 1f else 0.6f),
                shape = RoundedCornerShape(14.dp)
            )
            .border(1.dp, borderColor, RoundedCornerShape(14.dp))
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = icon,
                contentDescription = text,
                tint = MatchOColors.PrimaryGreen.copy(alpha = contentAlpha),
                modifier = Modifier.size(16.dp)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = text,
                color = MatchOColors.TextPrimary.copy(alpha = contentAlpha),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

// ================================================================
// MATCH-O MODE BARCODES POPUP
// ================================================================
//
// Renders the two scanner "setup" barcodes (Bluetooth Mode, then
// Bluetooth SPP) as real, scannable Code128 barcodes generated on
// the fly with ZXing, using the exact payload text decoded from the
// scanner's printed command-barcode sheet. Point the physical
// scanner at the phone screen and scan them in order to switch it
// into Match-O (Bluetooth SPP) mode - the same effect as the
// BLE-injected setScannerMatchOMode(), but done by physically
// scanning instead, which some scan-engine modules honour more
// reliably than serial-injected commands.
//
// Requires: implementation("com.google.zxing:core:3.5.3") in the
// module's build.gradle.

@Composable
private fun MatchOBarcodesDialog(
    onDismiss: () -> Unit,
    onSendAutomatically: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Match-O Mode") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(
                    text = "No scanner connection needed for this. Point the scanner at the screen and scan these two barcodes one by one, in order, waiting about 2 seconds after the first before scanning the second.",
                    color = MatchOColors.TextSecondary,
                    fontSize = 13.sp
                )
                BarcodeWithLabel(
                    content = "%#IFSNO$4",
                    label = "1. Bluetooth Mode"
                )
                BarcodeWithLabel(
                    content = "AT+MODE=1",
                    label = "2. Bluetooth SPP"
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onSendAutomatically()
                onDismiss()
            }) { Text("SEND OVER BLE INSTEAD") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("CLOSE") }
        }
    )
}

@Composable
private fun BarcodeWithLabel(
    content: String,
    label: String
) {
    val bitmap = remember(content) { generateBarcodeBitmap(content) }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth()
    ) {
        Image(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = label,
            modifier = Modifier
                .fillMaxWidth()
                .background(Color.White, RoundedCornerShape(6.dp))
                .padding(10.dp)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = label,
            color = MatchOColors.TextPrimary,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium
        )
    }
}

private fun generateBarcodeBitmap(
    content: String,
    widthPx: Int = 700,
    heightPx: Int = 180
): Bitmap {
    val bitMatrix: BitMatrix = MultiFormatWriter().encode(
        content,
        BarcodeFormat.CODE_128,
        widthPx,
        heightPx
    )

    val bmp = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.RGB_565)
    for (x in 0 until widthPx) {
        for (y in 0 until heightPx) {
            bmp.setPixel(
                x, y,
                if (bitMatrix.get(x, y)) AndroidColor.BLACK else AndroidColor.WHITE
            )
        }
    }
    return bmp
}

@Composable
fun ConfigRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = MatchOColors.Surface),
        border = BorderStroke(1.dp, MatchOColors.DimGreen),
        shape = RoundedCornerShape(14.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .background(MatchOColors.DimGreen, shape = CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = title,
                    tint = MatchOColors.PrimaryGreen,
                    modifier = Modifier.size(20.dp)
                )
            }

            Column(modifier = Modifier.padding(start = 12.dp)) {
                Text(
                    text = title,
                    color = MatchOColors.TextPrimary,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp
                )
                Text(
                    text = subtitle,
                    color = MatchOColors.TextSecondary,
                    fontSize = 12.sp
                )
            }
        }
    }
}

@Composable
fun GreenActionButton(
    text: String,
    icon: ImageVector? = null,
    compact: Boolean = false,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .background(
                color = MatchOColors.PrimaryGreen,
                shape = RoundedCornerShape(if (compact) 10.dp else 14.dp)
            )
            .clickable { onClick() }
            .padding(
                horizontal = if (compact) 14.dp else 24.dp,
                vertical = if (compact) 8.dp else 14.dp
            ),
        contentAlignment = Alignment.Center
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = Color.Black,
                    modifier = Modifier.size(if (compact) 16.dp else 20.dp)
                )
                Spacer(modifier = Modifier.padding(start = 6.dp))
            }
            Text(
                text = text,
                color = Color.Black,
                fontWeight = FontWeight.SemiBold,
                fontSize = if (compact) 13.sp else 15.sp
            )
        }
    }
}

@Composable
fun GreenOutlineButton(
    text: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Box(
        modifier = modifier
            .background(
                color = MatchOColors.Surface,
                shape = RoundedCornerShape(12.dp)
            )
            .border(
                width = 1.dp,
                color = MatchOColors.PrimaryGreen,
                shape = RoundedCornerShape(12.dp)
            )
            .clickable { onClick() }
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            color = MatchOColors.PrimaryGreen,
            fontWeight = FontWeight.Medium,
            fontSize = 14.sp
        )
    }
}