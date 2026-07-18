package com.ferrotune.audio

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object NativeAudioLogger {
    private const val TAG = "NativeAudioLogger"
    private const val DIAGNOSTIC_DIRECTORY = "diagnostics/native-audio"
    private const val ACTIVE_LOG_FILE = "native-audio-current.jsonl"
    private const val MANIFEST_FILE = "manifest.json"
    private const val MAX_LOG_FILE_BYTES = 2L * 1024L * 1024L
    private const val MAX_LOG_FILE_COUNT = 5
    private const val REDACTED = "[REDACTED]"
    private val processStartedAtElapsedRealtimeMs = try {
        android.os.Process.getStartElapsedRealtime()
    } catch (_: RuntimeException) {
        // Local JVM unit tests use Android's non-runtime stubs. Diagnostics are
        // still fully populated on-device (minSdk 24 supports this API).
        -1L
    }

    private val timestampFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    @Volatile
    private var logDirectory: File? = null
    @Volatile
    private var packageName: String = "unknown"
    @Volatile
    private var storageKind: String = "uninitialized"

    @Synchronized
    fun initialize(context: Context) {
        if (logDirectory != null) return

        val applicationContext = context.applicationContext
        packageName = applicationContext.packageName

        val externalDirectory = applicationContext.getExternalFilesDir(DIAGNOSTIC_DIRECTORY)
        val selectedExternalDirectory = externalDirectory?.takeIf { ensureDirectory(it) }
        val privateDirectory = File(applicationContext.noBackupFilesDir, DIAGNOSTIC_DIRECTORY)
        val selectedDirectory = selectedExternalDirectory ?: privateDirectory.takeIf { ensureDirectory(it) }

        if (selectedDirectory == null) {
            Log.w(TAG, "Native audio diagnostics unavailable: could not create log directory")
            return
        }

        logDirectory = selectedDirectory
        storageKind = if (selectedDirectory == selectedExternalDirectory) "external" else "private"
        writeManifest(selectedDirectory)
        debug(
            TAG,
            "logger_initialized",
            "Native audio diagnostics initialized",
            mapOf(
                "storageKind" to storageKind,
                "directory" to selectedDirectory.absolutePath,
                "packageName" to packageName,
            ),
        )
    }

    fun debug(
        tag: String,
        event: String,
        message: String,
        fields: Map<String, Any?> = emptyMap(),
        throwable: Throwable? = null,
    ) = log("debug", tag, event, message, fields, throwable)

    fun info(
        tag: String,
        event: String,
        message: String,
        fields: Map<String, Any?> = emptyMap(),
        throwable: Throwable? = null,
    ) = log("info", tag, event, message, fields, throwable)

    fun warn(
        tag: String,
        event: String,
        message: String,
        fields: Map<String, Any?> = emptyMap(),
        throwable: Throwable? = null,
    ) = log("warn", tag, event, message, fields, throwable)

    fun error(
        tag: String,
        event: String,
        message: String,
        fields: Map<String, Any?> = emptyMap(),
        throwable: Throwable? = null,
    ) = log("error", tag, event, message, fields, throwable)

    @Synchronized
    private fun log(
        level: String,
        tag: String,
        event: String,
        message: String,
        fields: Map<String, Any?>,
        throwable: Throwable?,
    ) {
        val directory = logDirectory ?: return

        try {
            rotateIfNeeded(directory)
            val logFile = File(directory, ACTIVE_LOG_FILE)
            logFile.appendText(buildEvent(level, tag, event, message, fields, throwable).toString() + "\n")
        } catch (exception: Exception) {
            Log.w(TAG, "Failed to write native audio diagnostic log", exception)
        }
    }

    private fun buildEvent(
        level: String,
        tag: String,
        event: String,
        message: String,
        fields: Map<String, Any?>,
        throwable: Throwable?,
    ): JSONObject {
        return JSONObject().apply {
            put("timestamp", timestamp())
            put("elapsedRealtimeMs", SystemClock.elapsedRealtime())
            put("processId", android.os.Process.myPid())
            put("processStartedAtElapsedRealtimeMs", processStartedAtElapsedRealtimeMs)
            put("level", level)
            put("tag", sanitizeForDiagnostics(tag))
            put("event", sanitizeForDiagnostics(event))
            put("message", sanitizeForDiagnostics(message))
            put("thread", sanitizeForDiagnostics(Thread.currentThread().name))
            put("packageName", packageName)
            put("storageKind", storageKind)
            put("androidSdk", Build.VERSION.SDK_INT)
            put("deviceManufacturer", sanitizeForDiagnostics(Build.MANUFACTURER ?: "unknown"))
            put("deviceModel", sanitizeForDiagnostics(Build.MODEL ?: "unknown"))
            put("fields", fieldsToJson(fields))
            if (throwable != null) {
                put("throwable", throwableToJson(throwable))
            }
        }
    }

    private fun fieldsToJson(fields: Map<String, Any?>): JSONObject {
        return JSONObject().apply {
            fields.forEach { (key, value) ->
                put(key, sanitizeFieldForDiagnostics(key, value))
            }
        }
    }

    private fun throwableToJson(throwable: Throwable): JSONObject {
        return JSONObject().apply {
            put("class", throwable.javaClass.name)
            put("message", throwable.message?.let { sanitizeForDiagnostics(it) } ?: JSONObject.NULL)
            put(
                "stack",
                throwable.stackTrace
                    .take(12)
                    .joinToString("\n") { sanitizeForDiagnostics(it.toString()) },
            )
            throwable.cause?.let { cause ->
                put("causeClass", cause.javaClass.name)
                put("causeMessage", cause.message?.let { sanitizeForDiagnostics(it) } ?: JSONObject.NULL)
            }
        }
    }

    internal fun sanitizeFieldForDiagnostics(key: String, value: Any?): Any {
        if (isSensitiveKey(key)) return REDACTED
        return sanitizeValueForDiagnostics(value)
    }

    private fun sanitizeValueForDiagnostics(value: Any?): Any {
        return when (value) {
            null -> JSONObject.NULL
            is String -> sanitizeForDiagnostics(value)
            is Number -> value
            is Boolean -> value
            is Map<*, *> -> JSONObject().apply {
                value.forEach { (mapKey, mapValue) ->
                    val key = mapKey?.toString() ?: "null"
                    put(key, sanitizeFieldForDiagnostics(key, mapValue))
                }
            }
            is Iterable<*> -> JSONArray().apply {
                value.forEach { item -> put(sanitizeValueForDiagnostics(item)) }
            }
            else -> sanitizeForDiagnostics(value.toString())
        }
    }

    internal fun sanitizeForDiagnostics(text: String): String {
        var sanitized = text
        sanitized = Regex("(?i)(authorization\\s*[:=]\\s*)(bearer\\s+)?[^\\s,&]+")
            .replace(sanitized) { matchResult ->
                val prefix = matchResult.groupValues[1]
                val bearer = matchResult.groupValues[2]
                "$prefix$bearer$REDACTED"
            }
        sanitized = Regex("(?i)bearer\\s+[A-Za-z0-9._~+/=-]+")
            .replace(sanitized, "Bearer $REDACTED")
        sanitized = Regex("(?i)(https?://)([^\\s/@:]+):([^\\s/@]+)@")
            .replace(sanitized) { matchResult -> "${matchResult.groupValues[1]}$REDACTED@" }
        sanitized = Regex("(?i)\\b(p|t|urlToken|token|sessionToken|password)=([^&\\s]+)")
            .replace(sanitized) { matchResult -> "${matchResult.groupValues[1]}=$REDACTED" }
        return sanitized
    }

    private fun isSensitiveKey(key: String): Boolean {
        val lowerKey = key.lowercase(Locale.US)
        if (lowerKey == "p" || lowerKey == "t") return true
        val normalizedKey = lowerKey.replace("-", "").replace("_", "")
        return normalizedKey in setOf(
            "authorization",
            "bearer",
            "password",
            "token",
            "sessiontoken",
            "urltoken",
        )
    }

    private fun rotateIfNeeded(directory: File) {
        val activeFile = File(directory, ACTIVE_LOG_FILE)
        if (!activeFile.exists() || activeFile.length() < MAX_LOG_FILE_BYTES) return

        archiveFile(directory, MAX_LOG_FILE_COUNT - 1).delete()
        for (archiveIndex in (MAX_LOG_FILE_COUNT - 2) downTo 1) {
            val archive = archiveFile(directory, archiveIndex)
            if (archive.exists()) {
                archive.renameTo(archiveFile(directory, archiveIndex + 1))
            }
        }
        activeFile.renameTo(archiveFile(directory, 1))
        writeManifest(directory)
    }

    private fun archiveFile(directory: File, archiveIndex: Int): File {
        return File(directory, "native-audio-$archiveIndex.jsonl")
    }

    private fun writeManifest(directory: File) {
        try {
            val logFiles = (listOf(File(directory, ACTIVE_LOG_FILE)) +
                (1 until MAX_LOG_FILE_COUNT).map { archiveFile(directory, it) })
                .filter { it.exists() }
            val files = JSONArray().apply {
                logFiles.forEach { file ->
                    put(JSONObject().apply {
                        put("name", file.name)
                        put("bytes", file.length())
                        put("lastModifiedMs", file.lastModified())
                    })
                }
            }
            val manifest = JSONObject().apply {
                put("createdAt", timestamp())
                put("processId", android.os.Process.myPid())
                put("processStartedAtElapsedRealtimeMs", processStartedAtElapsedRealtimeMs)
                put("packageName", packageName)
                put("storageKind", storageKind)
                put("directory", directory.absolutePath)
                put("adbPullHint", "/sdcard/Android/data/$packageName/files/$DIAGNOSTIC_DIRECTORY/")
                put("activeLogFile", ACTIVE_LOG_FILE)
                put("maxLogFileBytes", MAX_LOG_FILE_BYTES)
                put("maxLogFileCount", MAX_LOG_FILE_COUNT)
                put("files", files)
            }
            File(directory, MANIFEST_FILE).writeText(manifest.toString(2))
        } catch (exception: Exception) {
            Log.w(TAG, "Failed to write native audio diagnostic manifest", exception)
        }
    }

    private fun ensureDirectory(directory: File): Boolean {
        return try {
            directory.exists() || directory.mkdirs()
        } catch (exception: Exception) {
            Log.w(TAG, "Failed to create diagnostic directory: ${directory.absolutePath}", exception)
            false
        }
    }

    @Synchronized
    private fun timestamp(): String {
        return timestampFormat.format(Date())
    }
}
