package com.ferrotune.feature.feedback

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.PixelCopy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume
import kotlin.math.max
import kotlin.math.roundToInt

private const val MAX_IMAGE_SIDE = 2560

/** Captures the activity window, including SurfaceView/GL content where supported. */
suspend fun Activity.captureWindow(): Bitmap {
    val view = window.decorView
    val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val ok = suspendCancellableCoroutine { continuation ->
            PixelCopy.request(window, bitmap, { result ->
                continuation.resume(result == PixelCopy.SUCCESS)
            }, Handler(Looper.getMainLooper()))
        }
        if (ok) return bitmap
    }
    view.draw(Canvas(bitmap))
    return bitmap
}

fun Bitmap.scaledToMax(maxSide: Int = MAX_IMAGE_SIDE): Bitmap {
    val ratio = maxSide.toFloat() / max(width, height)
    if (ratio >= 1f) return this
    return Bitmap.createScaledBitmap(this, (width * ratio).roundToInt(), (height * ratio).roundToInt(), true)
}

suspend fun Context.loadImage(uri: Uri): Bitmap? = withContext(Dispatchers.IO) {
    contentResolver.openInputStream(uri)?.use(BitmapFactory::decodeStream)?.scaledToMax()
}

/** PNG keeps text crisp; large captures fall back to JPEG to stay small. */
suspend fun Bitmap.toDataUrl(): String = withContext(Dispatchers.Default) {
    val png = ByteArrayOutputStream().also { compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    val (mime, bytes) = if (png.size < 2_500_000) {
        "image/png" to png
    } else {
        "image/jpeg" to ByteArrayOutputStream().also { compress(Bitmap.CompressFormat.JPEG, 88, it) }.toByteArray()
    }
    "data:$mime;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
}

/** Draws annotation strokes (in image pixels) onto a copy of the bitmap. */
fun Bitmap.withStrokes(strokes: List<Stroke>): Bitmap {
    if (strokes.isEmpty()) return this
    val out = copy(Bitmap.Config.ARGB_8888, true)
    val canvas = Canvas(out)
    for (stroke in strokes) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = stroke.width
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            color = stroke.color
            setShadowLayer(stroke.width, 0f, 0f, 0x73000000)
        }
        val (x0, y0) = stroke.points.first()
        val (x1, y1) = stroke.points.last()
        when (stroke.tool) {
            Tool.Pen -> canvas.drawPath(
                Path().apply {
                    moveTo(x0, y0)
                    stroke.points.drop(1).forEach { (x, y) -> lineTo(x, y) }
                    if (stroke.points.size == 1) lineTo(x0 + 0.1f, y0)
                },
                paint,
            )
            Tool.Ellipse -> canvas.drawOval(RectF(minOf(x0, x1), minOf(y0, y1), maxOf(x0, x1), maxOf(y0, y1)), paint)
            Tool.Rect -> canvas.drawRect(RectF(minOf(x0, x1), minOf(y0, y1), maxOf(x0, x1), maxOf(y0, y1)), paint)
        }
    }
    return out
}
