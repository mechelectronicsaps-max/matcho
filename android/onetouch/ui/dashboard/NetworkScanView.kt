package com.example.onetouch.ui.dashboard

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.onetouch.ui.footer.OneTouchColors
import com.example.onetouch.ui.header.HdrBtn
import kotlin.math.cos
import kotlin.math.sin

/* ---------------------------------------------------------------
 *  ROUTER MODE, nothing found yet :
 *  a router icon in the CENTER with a radar "ping" animation around it
 *  (rings grow and fade + a sweeping beam), and the scan progress below.
 * --------------------------------------------------------------- */
@Composable
fun NetworkScanView(
    progress: Pair<Int, Int>,
    problem: String?,
    modifier: Modifier = Modifier,
    detail: String = "",                                   // what the search does: this screen's address, how many answered
    onAddAddress: ((String, (String) -> Unit) -> Unit)? = null     // the user types the IP of a unit; the second part receives the result text
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        RadarRouter(size = 190.dp, sweeping = problem == null)

        Spacer(Modifier.height(10.dp))

        Text(
            text = problem ?: "Searching your network...",
            color = OneTouchColors.Ink,
            fontSize = 16.sp,
            fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = if (problem != null) "Connect the panel to the router (Wi-Fi or cable)"
            else if (progress.second > 0) "Listening for devices and checking address ${progress.first} of ${progress.second}"
            else "Starting...",
            color = OneTouchColors.Ink.copy(alpha = 0.65f),
            fontSize = 12.sp,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = "Devices that answer will appear here",
            color = OneTouchColors.Ink.copy(alpha = 0.5f),
            fontSize = 11.sp,
            textAlign = TextAlign.Center
        )
        if (detail.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = detail,
                color = OneTouchColors.Ink.copy(alpha = 0.6f),
                fontSize = 10.sp,
                textAlign = TextAlign.Center
            )
        }
        if (onAddAddress != null) {
            Spacer(Modifier.height(10.dp))
            AddAddressRow(onAddAddress)
        }
    }
}

/** "not found? type the IP of the unit": it is asked at every start from now on */
@Composable
private fun AddAddressRow(onAdd: (String, (String) -> Unit) -> Unit) {
    var text by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<String?>(null) }
    val shape = RoundedCornerShape(10.dp)

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BasicTextField(
                value = text,
                onValueChange = { raw ->
                    text = raw.filter { it.isDigit() || it == '.' }.take(15)
                    note = null
                },
                singleLine = true,
                textStyle = TextStyle(color = OneTouchColors.Ink, fontSize = 13.sp, fontWeight = FontWeight.Bold),
                cursorBrush = SolidColor(OneTouchColors.Accent),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier
                    .width(170.dp)
                    .height(34.dp)
                    .clip(shape)
                    .background(Color.White.copy(alpha = 0.6f), shape)
                    .border(1.dp, OneTouchColors.TealDark, shape)
                    .padding(horizontal = 10.dp),
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (text.isEmpty()) {
                            Text("IP of the unit", color = OneTouchColors.Ink.copy(alpha = 0.35f), fontSize = 13.sp)
                        }
                        inner()
                    }
                }
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "ADD", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Black,
                modifier = Modifier
                    .clip(shape)
                    .background(Brush.verticalGradient(listOf(OneTouchColors.Teal, OneTouchColors.TealDark)), shape)
                    .clickable {
                        note = "Testing $text ..."
                        onAdd(text) { result -> note = result }
                    }
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            )
        }
        note?.let {
            Spacer(Modifier.height(4.dp))
            Text(it, color = OneTouchColors.Ink.copy(alpha = 0.7f), fontSize = 10.sp, textAlign = TextAlign.Center)
        }
    }
}

/** round 3D router button with ping rings and a radar beam */
@Composable
private fun RadarRouter(size: Dp, sweeping: Boolean) {
    val accent = OneTouchColors.Accent
    val transition = rememberInfiniteTransition(label = "radar")
    val ring by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(2400, easing = LinearEasing), RepeatMode.Restart),
        label = "ring"
    )
    val beam by transition.animateFloat(
        initialValue = 0f, targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(2800, easing = LinearEasing), RepeatMode.Restart),
        label = "beam"
    )

    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val center = Offset(this.size.width / 2f, this.size.height / 2f)
            val maxRadius = this.size.minDimension / 2f

            // 3 rings that grow and fade out (the "ping")
            for (i in 0 until 3) {
                val p = (ring + i / 3f) % 1f
                drawCircle(
                    color = accent.copy(alpha = 0.7f * (1f - p)),
                    radius = maxRadius * (0.3f + 0.7f * p),
                    center = center,
                    style = Stroke(width = 2.5.dp.toPx())
                )
            }
            // fixed outer guide circle
            drawCircle(
                color = accent.copy(alpha = 0.18f), radius = maxRadius * 0.98f,
                center = center, style = Stroke(width = 1.dp.toPx())
            )

            // sweeping radar beam (a wedge + the leading line)
            if (sweeping) {
                drawArc(
                    color = accent.copy(alpha = 0.22f),
                    startAngle = beam - 55f, sweepAngle = 55f, useCenter = true,
                    topLeft = Offset(center.x - maxRadius, center.y - maxRadius),
                    size = androidx.compose.ui.geometry.Size(maxRadius * 2f, maxRadius * 2f)
                )
                val rad = Math.toRadians(beam.toDouble())
                drawLine(
                    color = accent.copy(alpha = 0.85f),
                    start = center,
                    end = Offset(center.x + maxRadius * cos(rad).toFloat(), center.y + maxRadius * sin(rad).toFloat()),
                    strokeWidth = 2.dp.toPx()
                )
            }
        }

        // the router icon in the middle (same 3D look as the round buttons)
        val button = size * 0.36f
        Box(
            modifier = Modifier
                .size(button)
                .clip(CircleShape)
                .background(Brush.verticalGradient(listOf(HdrBtn.RingTop, HdrBtn.RingBottom)), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .size(button * 0.82f)
                    .clip(CircleShape)
                    .background(Brush.verticalGradient(listOf(HdrBtn.FaceTop, HdrBtn.FaceBottom)), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Rounded.Router, contentDescription = "Router", tint = accent, modifier = Modifier.size(button * 0.5f))
            }
        }
    }
}

/* ---------------------------------------------------------------
 *  SMALL STATUS (top-left in Router mode, also while devices are shown):
 *  tiny router with a pulse + "Scanning...  142/254  |  2 found"
 * --------------------------------------------------------------- */
@Composable
fun ScanStatusChip(
    scanning: Boolean,
    progress: Pair<Int, Int>,
    found: Int,
    problem: String?,
    modifier: Modifier = Modifier
) {
    val accent = OneTouchColors.Accent
    val transition = rememberInfiniteTransition(label = "chip")
    val pulse by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart),
        label = "pulse"
    )

    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
            if (scanning && problem == null) {
                Canvas(Modifier.fillMaxSize()) {
                    drawCircle(
                        color = accent.copy(alpha = 0.7f * (1f - pulse)),
                        radius = this.size.minDimension / 2f * (0.4f + 0.6f * pulse),
                        style = Stroke(width = 1.5.dp.toPx())
                    )
                }
            }
            Icon(Icons.Rounded.Router, null, tint = accent, modifier = Modifier.size(13.dp))
        }
        Spacer(Modifier.width(6.dp))
        Text(
            text = problem
                ?: if (scanning) "Scanning...  ${progress.first}/${progress.second}   |   $found found"
                else "$found device(s) on the network",
            color = OneTouchColors.Ink.copy(alpha = 0.75f),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Preview(widthDp = 520, heightDp = 360, showBackground = true, backgroundColor = 0xFFF4FBF9)
@Composable
fun NetworkScanViewPreview() {
    NetworkScanView(progress = 142 to 254, problem = null, modifier = Modifier.fillMaxSize())
}