package com.ferrotune.music.push

import android.content.Context
import android.os.Build
import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.PushDeviceRequest
import com.ferrotune.music.BuildConfig
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Firebase Cloud Messaging, which lets the server wake this app for a remote
 * "play here" while it is idle with its session stream closed. Configured at
 * build time from a `google-services.json` (see app/build.gradle.kts); builds
 * without one never touch Firebase.
 */
object PushConfig {
    val isConfigured: Boolean
        get() = BuildConfig.FIREBASE_APP_ID.isNotEmpty()

    fun initialize(context: Context) {
        if (!isConfigured || FirebaseApp.getApps(context).isNotEmpty()) return
        FirebaseApp.initializeApp(
            context,
            FirebaseOptions.Builder()
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                .build(),
        )
    }
}

/** Keeps the active account's server told which FCM token wakes this install. */
@Singleton
class PushRegistrar @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
    private val accounts: Accounts,
) {
    /** Registers [token] (or the current one) if the server can send pushes. */
    suspend fun register(token: String? = null) {
        if (!PushConfig.isConfigured) return
        runCatching {
            val api = apiProvider.requireApi()
            if (!apiCall { api.ping() }.pushEnabled) return
            val fcmToken = token ?: currentToken() ?: return
            apiCall {
                api.registerPushDevice(
                    PushDeviceRequest(
                        clientId = accounts.clientId(),
                        token = fcmToken,
                        deviceLabel = Build.MODEL,
                    ),
                )
            }
        }
    }

    /** Stops the active account's server from waking this install (sign-out). */
    suspend fun unregister() {
        if (!PushConfig.isConfigured) return
        runCatching {
            val api = apiProvider.requireApi()
            apiCall { api.unregisterPushDevice(accounts.clientId()) }
        }
    }

    private suspend fun currentToken(): String? = suspendCancellableCoroutine { continuation ->
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            continuation.resume(if (task.isSuccessful) task.result else null)
        }
    }
}
