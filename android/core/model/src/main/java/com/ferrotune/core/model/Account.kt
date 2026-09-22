package com.ferrotune.core.model

import kotlinx.serialization.Serializable

/**
 * A saved login for one user on one server.
 *
 * [id] is stable per user + server, matching the web client's account key.
 */
@Serializable
data class Account(
    val id: String,
    val label: String,
    val serverUrl: String,
    val username: String,
    val userId: Long,
    val email: String? = null,
    val isAdmin: Boolean = false,
    val sessionToken: String,
    val sessionExpiresAt: String,
) {
    companion object {
        fun key(userId: Long, serverUrl: String): String = "$userId@$serverUrl"

        fun displayLabel(username: String, serverUrl: String): String {
            val host = runCatching { java.net.URI(serverUrl).host }.getOrNull()
            return if (host.isNullOrBlank()) username else "$username@$host"
        }
    }
}
