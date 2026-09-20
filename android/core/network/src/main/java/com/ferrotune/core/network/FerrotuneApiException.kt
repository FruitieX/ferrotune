package com.ferrotune.core.network

/**
 * An API failure with a user-presentable message.
 *
 * [statusCode] is `0` for transport failures (no HTTP response).
 */
class FerrotuneApiException(
    val statusCode: Int,
    override val message: String,
) : Exception(message)
