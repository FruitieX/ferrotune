package com.ferrotune.feature.auth

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/**
 * "Sign in with passkey" through the server's OIDC provider (Pocket ID).
 *
 * The app opens `<server>/api/auth/oidc/start` in a Custom Tab; after the
 * provider, the server redirects to [REDIRECT_URI] with a single-use code
 * that the app's redirect activity hands to [OidcRedirects].
 * The code is bound to a PKCE verifier only this install knows, so another
 * app catching the custom scheme can't redeem it.
 */
object OidcLogin {
    const val REDIRECT_URI = "ferrotune://oidc/callback"

    data class Pkce(val verifier: String, val challenge: String)

    sealed interface Redirect {
        data class Code(val code: String) : Redirect
        data class Failure(val message: String) : Redirect
    }

    fun newPkce(random: SecureRandom = SecureRandom()): Pkce {
        val bytes = ByteArray(32).also(random::nextBytes)
        val verifier = base64Url(bytes)
        return Pkce(verifier, challengeFor(verifier))
    }

    fun challengeFor(verifier: String): String =
        base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    /** Unpadded base64url (java.util.Base64 needs API 26, android.util.Base64 isn't in JVM tests). */
    internal fun base64Url(bytes: ByteArray): String {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        val out = StringBuilder((bytes.size * 4 + 2) / 3)
        var i = 0
        while (i < bytes.size) {
            val b0 = bytes[i].toInt() and 0xff
            val b1 = if (i + 1 < bytes.size) bytes[i + 1].toInt() and 0xff else 0
            val b2 = if (i + 2 < bytes.size) bytes[i + 2].toInt() and 0xff else 0
            out.append(alphabet[b0 shr 2])
            out.append(alphabet[((b0 and 0x03) shl 4) or (b1 shr 4)])
            if (i + 1 < bytes.size) out.append(alphabet[((b1 and 0x0f) shl 2) or (b2 shr 6)])
            if (i + 2 < bytes.size) out.append(alphabet[b2 and 0x3f])
            i += 3
        }
        return out.toString()
    }

    fun startUrl(serverUrl: String, challenge: String): String {
        fun enc(value: String) = URLEncoder.encode(value, "UTF-8")
        return "${serverUrl.trimEnd('/')}/api/auth/oidc/start" +
            "?redirect=${enc(REDIRECT_URI)}&challenge=${enc(challenge)}"
    }

    /** Whether [uri] is the end of a sign-in meant for this app. */
    fun isRedirect(uri: String): Boolean = uri.substringBefore('?') == REDIRECT_URI

    fun parseRedirect(uri: String): Redirect {
        if (!isRedirect(uri)) return Redirect.Failure("Unexpected sign-in response")
        val query = runCatching { URI(uri).rawQuery }.getOrNull().orEmpty()
        val params = query.split('&')
            .filter { it.isNotEmpty() }
            .associate { pair ->
                val key = pair.substringBefore('=')
                val value = pair.substringAfter('=', "")
                URLDecoder.decode(key, "UTF-8") to URLDecoder.decode(value, "UTF-8")
            }
        params["error"]?.let { return Redirect.Failure(it) }
        val code = params["code"]?.takeIf { it.isNotBlank() }
            ?: return Redirect.Failure("The server sent no sign-in code")
        return Redirect.Code(code)
    }
}

/** Hands sign-in redirects from the redirect activity to the login screen. */
@Singleton
class OidcRedirects @Inject constructor() {
    private val latest = MutableStateFlow<String?>(null)
    val pending: StateFlow<String?> = latest.asStateFlow()

    fun deliver(uri: String) {
        latest.value = uri
    }

    /** Clears [uri] once handled, unless a newer redirect replaced it. */
    fun consume(uri: String) {
        latest.compareAndSet(uri, null)
    }
}

/** A sign-in waiting for its redirect; kept on disk in case the app is killed meanwhile. */
data class PendingOidcLogin(val serverUrl: String, val verifier: String)

interface PendingOidcLoginStore {
    fun save(login: PendingOidcLogin)
    fun take(): PendingOidcLogin?
}

@Singleton
class SharedPrefsPendingOidcLoginStore @Inject constructor(
    @ApplicationContext context: Context,
) : PendingOidcLoginStore {
    private val prefs = context.getSharedPreferences("ferrotune_oidc", Context.MODE_PRIVATE)

    override fun save(login: PendingOidcLogin) {
        prefs.edit()
            .putString(KEY_SERVER, login.serverUrl)
            .putString(KEY_VERIFIER, login.verifier)
            .putLong(KEY_STARTED, System.currentTimeMillis())
            .apply()
    }

    override fun take(): PendingOidcLogin? {
        val server = prefs.getString(KEY_SERVER, null)
        val verifier = prefs.getString(KEY_VERIFIER, null)
        val started = prefs.getLong(KEY_STARTED, 0)
        prefs.edit().clear().apply()
        if (server == null || verifier == null) return null
        // The server forgets a sign-in after ten minutes.
        if (System.currentTimeMillis() - started > 10 * 60 * 1000) return null
        return PendingOidcLogin(server, verifier)
    }

    private companion object {
        const val KEY_SERVER = "server_url"
        const val KEY_VERIFIER = "verifier"
        const val KEY_STARTED = "started_at"
    }
}
