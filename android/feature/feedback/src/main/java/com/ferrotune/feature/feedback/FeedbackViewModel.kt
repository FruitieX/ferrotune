package com.ferrotune.feature.feedback

import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Process
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import javax.inject.Inject

const val MAX_SHOTS = 8

class Shot(val base: Bitmap, val strokes: List<Stroke> = emptyList(), val note: String = "") {
    val rendered: Bitmap by lazy { base.withStrokes(strokes) }
}

@HiltViewModel
class FeedbackViewModel @Inject constructor(
    private val repository: FeedbackRepository,
    @ApplicationContext private val context: Context,
) : ViewModel() {
    var info by mutableStateOf<FeedbackServerInfo?>(null)
        private set
    var shots by mutableStateOf(listOf<Shot>())
        private set

    /** The next button press captures the screen instead of opening the form. */
    var armed by mutableStateOf(false)
    var dialogOpen by mutableStateOf(false)
    var capturing by mutableStateOf(false)
    var hiddenForSession by mutableStateOf(false)
    var kind by mutableStateOf(FeedbackKind.Bug)
    var message by mutableStateOf("")
    var includeDiagnostics by mutableStateOf(true)
    var sending by mutableStateOf(false)
        private set
    var status by mutableStateOf<String?>(null)

    fun refresh() {
        viewModelScope.launch { info = repository.serverInfo() }
    }

    fun addShot(bitmap: Bitmap) {
        if (shots.size < MAX_SHOTS) shots = shots + Shot(bitmap)
    }

    fun removeShot(index: Int) {
        shots = shots.filterIndexed { i, _ -> i != index }
    }

    fun setStrokes(index: Int, strokes: List<Stroke>) {
        shots = shots.mapIndexed { i, shot -> if (i == index) Shot(shot.base, strokes, shot.note) else shot }
    }

    fun setNote(index: Int, note: String) {
        shots = shots.mapIndexed { i, shot -> if (i == index) Shot(shot.base, shot.strokes, note.take(1000)) else shot }
    }

    fun send(route: String?, onSent: (Long) -> Unit) {
        val hub = info?.hubUrl ?: return
        if (message.isBlank() && shots.isEmpty()) {
            status = "Add a short description or a screenshot."
            return
        }
        sending = true
        status = "Sending…"
        viewModelScope.launch {
            val result = runCatching {
                val diagnostics = includeDiagnostics
                val version = appVersion()
                val report = FeedbackReport(
                    kind = kind,
                    message = message,
                    page = if (diagnostics) route?.let { "ferrotune-android://$it" } else null,
                    userAgent = if (diagnostics) {
                        "Ferrotune Android $version; Android ${Build.VERSION.RELEASE}; ${Build.MANUFACTURER} ${Build.MODEL}"
                    } else {
                        null
                    },
                    context = if (diagnostics) diagnosticsContext(route, version) else mapOf("appVersion" to version),
                    logs = if (diagnostics) recentLogs() else emptyList(),
                    screenshots = shots.map { it.rendered.toDataUrl() },
                    screenshotNotes = shots.map { it.note },
                )
                repository.submit(hub, report)
            }
            sending = false
            result.onSuccess { id ->
                status = null
                shots = emptyList()
                message = ""
                kind = FeedbackKind.Bug
                dialogOpen = false
                onSent(id)
            }.onFailure { error ->
                status = "Sending failed: ${error.message ?: error.javaClass.simpleName}. Your text is kept; try again."
            }
        }
    }

    private fun appVersion(): String = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }.getOrNull() ?: "unknown"

    private fun diagnosticsContext(route: String?, version: String): Map<String, String> = buildMap {
        put("appVersion", version)
        info?.let {
            put("server", it.serverUrl)
            put("serverVersion", it.serverVersion)
        }
        route?.let { put("screen", it) }
        put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
        put("android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        val metrics = context.resources.displayMetrics
        put("display", "${metrics.widthPixels}x${metrics.heightPixels} @${metrics.density}x")
        put("language", Locale.getDefault().toLanguageTag())
    }

    /** Warnings and errors this process logged recently (own process only). */
    private suspend fun recentLogs(): List<String> = withContext(Dispatchers.IO) {
        runCatching {
            val process = ProcessBuilder(
                "logcat", "-d", "-t", "400", "-v", "time", "--pid", Process.myPid().toString(), "*:W",
            ).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().use { it.readText() }
            process.waitFor()
            recentLogLines(output)
        }.getOrDefault(emptyList())
    }
}
