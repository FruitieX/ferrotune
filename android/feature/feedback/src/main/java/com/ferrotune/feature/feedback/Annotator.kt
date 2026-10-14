package com.ferrotune.feature.feedback

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.CropSquare
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Gesture
import androidx.compose.material3.Button
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke as DrawStroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

enum class Tool { Pen, Ellipse, Rect }

/** An annotation in image pixel coordinates, so screenshots can be re-edited. */
data class Stroke(
    val tool: Tool,
    val color: Int,
    val width: Float,
    val points: List<Pair<Float, Float>>,
)

private val COLORS = listOf(Color(0xFFEF4444), Color(0xFFFACC15), Color(0xFF3B82F6), Color(0xFF111827))

@Composable
fun AnnotateDialog(
    image: Bitmap,
    initial: List<Stroke>,
    onDone: (List<Stroke>) -> Unit,
    onCancel: () -> Unit,
) {
    val strokes = remember { mutableStateListOf<Stroke>().apply { addAll(initial) } }
    var current by remember { mutableStateOf<Stroke?>(null) }
    var tool by remember { mutableStateOf(Tool.Pen) }
    var color by remember { mutableStateOf(COLORS.first()) }
    val imageBitmap = remember(image) { image.asImageBitmap() }
    val strokeWidth = max(4f, max(image.width, image.height) / 300f)

    Dialog(
        onDismissRequest = onCancel,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(color = Color(0xFF0B1020), modifier = Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                Surface(color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.fillMaxWidth().padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            listOf(
                                Tool.Pen to Icons.Outlined.Gesture,
                                Tool.Ellipse to Icons.Outlined.Circle,
                                Tool.Rect to Icons.Outlined.CropSquare,
                            ).forEach { (t, icon) ->
                                FilledIconToggleButton(checked = tool == t, onCheckedChange = { tool = t }) {
                                    Icon(icon, contentDescription = t.name)
                                }
                            }
                            Spacer(Modifier.size(6.dp))
                            COLORS.forEach { c ->
                                Box(
                                    Modifier
                                        .padding(2.dp)
                                        .size(28.dp)
                                        .border(
                                            width = if (c == color) 3.dp else 1.dp,
                                            color = if (c == color) MaterialTheme.colorScheme.primary else Color.Gray,
                                            shape = CircleShape,
                                        )
                                        .padding(3.dp)
                                        .background(c, CircleShape)
                                        .clickable { color = c },
                                )
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = { strokes.removeLastOrNull() }) {
                                Icon(Icons.AutoMirrored.Outlined.Undo, contentDescription = "Undo")
                            }
                            IconButton(onClick = { strokes.clear() }) {
                                Icon(Icons.Outlined.Delete, contentDescription = "Clear marks")
                            }
                            Spacer(Modifier.weight(1f))
                            TextButton(onClick = onCancel) { Text("Cancel") }
                            Button(onClick = { onDone(strokes.toList()) }) { Text("Done") }
                        }
                    }
                }
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(12.dp)) {
                    val boxW = constraints.maxWidth.toFloat()
                    val boxH = constraints.maxHeight.toFloat()
                    val scale = minOf(boxW / image.width, boxH / image.height)
                    val drawW = image.width * scale
                    val drawH = image.height * scale
                    val origin = Offset((boxW - drawW) / 2f, (boxH - drawH) / 2f)
                    fun toImage(p: Offset) = ((p.x - origin.x) / scale) to ((p.y - origin.y) / scale)

                    Canvas(
                        Modifier
                            .fillMaxSize()
                            .pointerInput(tool, color, scale, origin) {
                                detectDragGestures(
                                    onDragStart = { start ->
                                        current = Stroke(tool, color.toArgb(), strokeWidth, listOf(toImage(start)))
                                    },
                                    onDrag = { change, _ ->
                                        val stroke = current ?: return@detectDragGestures
                                        val point = toImage(change.position)
                                        current = if (stroke.tool == Tool.Pen) {
                                            stroke.copy(points = stroke.points + point)
                                        } else {
                                            stroke.copy(points = listOf(stroke.points.first(), point))
                                        }
                                    },
                                    onDragEnd = {
                                        current?.let { stroke ->
                                            val (a, b) = stroke.points.first() to stroke.points.last()
                                            val moved = hypot(b.first - a.first, b.second - a.second) > 4f
                                            if (stroke.tool == Tool.Pen || moved) strokes.add(stroke)
                                        }
                                        current = null
                                    },
                                    onDragCancel = { current = null },
                                )
                            },
                    ) {
                        drawImage(
                            imageBitmap,
                            dstOffset = IntOffset(origin.x.roundToInt(), origin.y.roundToInt()),
                            dstSize = IntSize(drawW.roundToInt(), drawH.roundToInt()),
                        )
                        (strokes + listOfNotNull(current)).forEach { stroke ->
                            val pts = stroke.points.map { (x, y) -> Offset(origin.x + x * scale, origin.y + y * scale) }
                            val style = DrawStroke(width = stroke.width * scale, cap = StrokeCap.Round, join = StrokeJoin.Round)
                            val strokeColor = Color(stroke.color)
                            val (a, b) = pts.first() to pts.last()
                            val topLeft = Offset(minOf(a.x, b.x), minOf(a.y, b.y))
                            val size = Size(kotlin.math.abs(b.x - a.x), kotlin.math.abs(b.y - a.y))
                            when (stroke.tool) {
                                Tool.Pen -> drawPath(
                                    Path().apply {
                                        moveTo(a.x, a.y)
                                        pts.drop(1).forEach { lineTo(it.x, it.y) }
                                        if (pts.size == 1) lineTo(a.x + 0.1f, a.y)
                                    },
                                    strokeColor,
                                    style = style,
                                )
                                Tool.Ellipse -> drawOval(strokeColor, topLeft, size, style = style)
                                Tool.Rect -> drawRect(strokeColor, topLeft, size, style = style)
                            }
                        }
                    }
                }
            }
        }
    }
}
