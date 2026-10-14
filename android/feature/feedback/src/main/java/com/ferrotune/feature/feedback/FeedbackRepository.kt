package com.ferrotune.feature.feedback

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.FerrotuneJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

data class FeedbackServerInfo(val serverUrl: String, val serverVersion: String, val hubUrl: String)

/**
 * Talks to the feedback hub the active server advertises in `GET /api/ping`
 * (`FERROTUNE_FEEDBACK_URL`). Servers without one hide the feedback button.
 */
@Singleton
class FeedbackRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    // A separate client: the hub must never receive the Ferrotune session token.
    private val client = OkHttpClient.Builder()
        .callTimeout(90, TimeUnit.SECONDS)
        .build()

    private var cached: Pair<String, FeedbackServerInfo?>? = null

    suspend fun serverInfo(): FeedbackServerInfo? = runCatching {
        val account = apiProvider.requireAccount()
        cached?.takeIf { it.first == account.id + account.serverUrl }?.let { return it.second }
        val ping = apiProvider.requireApi().ping()
        val info = ping.feedbackUrl?.takeIf { it.isNotBlank() }?.let {
            FeedbackServerInfo(account.serverUrl, ping.version, it.trimEnd('/'))
        }
        cached = account.id + account.serverUrl to info
        info
    }.getOrNull()

    /** Sends the report and returns the hub's feedback id. */
    suspend fun submit(hubUrl: String, report: FeedbackReport): Long = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$hubUrl/api/feedback")
            .post(report.toJson().toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            val json = runCatching { FerrotuneJson.parseToJsonElement(body).jsonObject }.getOrNull()
            if (!response.isSuccessful) {
                val error = json?.get("error")?.jsonPrimitive?.content ?: "HTTP ${response.code}"
                throw IOException(error)
            }
            json?.get("id")?.jsonPrimitive?.long ?: throw IOException("Unexpected response from feedback hub")
        }
    }
}
