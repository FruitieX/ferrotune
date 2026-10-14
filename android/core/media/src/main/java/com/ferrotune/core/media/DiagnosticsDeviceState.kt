package com.ferrotune.core.media

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The device and app state that explains battery and background behaviour,
 * added to remote diagnostics as `device-state.json`: what an investigator
 * would otherwise read over adb (`dumpsys`), limited to what an app may read
 * about itself.
 */
internal object DiagnosticsDeviceState {
    const val FILE_NAME = "device-state.json"
    private const val MAX_EXIT_REASONS = 10

    fun snapshot(context: Context): JSONObject = JSONObject().apply {
        put("capturedAt", isoTime(System.currentTimeMillis()))
        put("androidSdk", Build.VERSION.SDK_INT)
        put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
        put("app", app(context))
        put("process", JSONObject().apply {
            put("elapsedRealtimeMs", SystemClock.elapsedRealtime())
            put("startedAtElapsedRealtimeMs", Process.getStartElapsedRealtime())
        })
        put("power", power(context))
        put("battery", battery(context))
        put("network", network(context))
        put("recentExits", recentExits(context))
    }

    private fun app(context: Context) = JSONObject().apply {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        put("packageName", context.packageName)
        put("versionName", info.versionName)
        put(
            "versionCode",
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong(),
        )
        put("lastUpdatedAt", isoTime(info.lastUpdateTime))
    }

    private fun power(context: Context) = JSONObject().apply {
        val power = context.getSystemService(PowerManager::class.java)
        put("interactive", power.isInteractive)
        put("powerSaveMode", power.isPowerSaveMode)
        put("deviceIdleMode", power.isDeviceIdleMode)
        put("ignoringBatteryOptimizations", power.isIgnoringBatteryOptimizations(context.packageName))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val activity = context.getSystemService(ActivityManager::class.java)
            // "Restricted" in the app's battery settings.
            put("backgroundRestricted", activity.isBackgroundRestricted)
            val usage = context.getSystemService(UsageStatsManager::class.java)
            put("standbyBucket", standbyBucketName(usage.appStandbyBucket))
        }
    }

    private fun battery(context: Context) = JSONObject().apply {
        val status = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = status?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = status?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        if (level >= 0 && scale > 0) put("percent", level * 100 / scale)
        val plugged = status?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        put("plugged", plugged != 0)
        val battery = context.getSystemService(BatteryManager::class.java)
        put("charging", battery.isCharging)
    }

    private fun network(context: Context) = JSONObject().apply {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
        if (capabilities == null) {
            put("connected", false)
        } else {
            put("connected", true)
            put("transports", JSONArray(transportNames(capabilities)))
            put("validated", capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
            put("metered", !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
        }
        // Data Saver: 1 off, 2 this app exempt, 3 on.
        put("dataSaver", connectivity.restrictBackgroundStatus)
    }

    private fun transportNames(capabilities: NetworkCapabilities): List<String> = listOf(
        NetworkCapabilities.TRANSPORT_WIFI to "wifi",
        NetworkCapabilities.TRANSPORT_CELLULAR to "cellular",
        NetworkCapabilities.TRANSPORT_ETHERNET to "ethernet",
        NetworkCapabilities.TRANSPORT_VPN to "vpn",
    ).filter { (transport, _) -> capabilities.hasTransport(transport) }.map { it.second }

    private fun recentExits(context: Context) = JSONArray().apply {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@apply
        val activity = context.getSystemService(ActivityManager::class.java)
        activity.getHistoricalProcessExitReasons(context.packageName, 0, MAX_EXIT_REASONS).forEach { exit ->
            put(JSONObject().apply {
                put("at", isoTime(exit.timestamp))
                put("reason", exitReasonName(exit.reason))
                put("status", exit.status)
                put("importance", exit.importance)
                put("description", exit.description?.let(NativeAudioLogger::sanitizeForDiagnostics) ?: JSONObject.NULL)
                put("pssKb", exit.pss)
                put("rssKb", exit.rss)
            })
        }
    }

    /** `UsageStatsManager.STANDBY_BUCKET_*` names; lower buckets run less. */
    internal fun standbyBucketName(bucket: Int): String = when (bucket) {
        5 -> "exempted"
        10 -> "active"
        20 -> "working_set"
        30 -> "frequent"
        40 -> "rare"
        45 -> "restricted"
        50 -> "never"
        else -> "unknown($bucket)"
    }

    /** `ApplicationExitInfo.REASON_*` names. */
    internal fun exitReasonName(reason: Int): String = when (reason) {
        ApplicationExitInfo.REASON_EXIT_SELF -> "exit_self"
        ApplicationExitInfo.REASON_SIGNALED -> "signaled"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "low_memory"
        ApplicationExitInfo.REASON_CRASH -> "crash"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "crash_native"
        ApplicationExitInfo.REASON_ANR -> "anr"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization_failure"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission_change"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive_resource_usage"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "user_requested"
        ApplicationExitInfo.REASON_USER_STOPPED -> "user_stopped"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency_died"
        ApplicationExitInfo.REASON_OTHER -> "other"
        14 -> "freezer"
        15 -> "package_state_change"
        16 -> "package_updated"
        else -> "unknown($reason)"
    }

    private fun isoTime(epochMs: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date(epochMs))
}
