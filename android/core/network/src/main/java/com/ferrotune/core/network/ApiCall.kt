package com.ferrotune.core.network

import com.ferrotune.core.network.dto.ApiErrorDto
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import retrofit2.HttpException

/**
 * Runs an API call, translating HTTP and transport errors into
 * [FerrotuneApiException] with the server-provided `error` message when present.
 */
suspend fun <T> apiCall(block: suspend () -> T): T =
    try {
        block()
    } catch (e: HttpException) {
        val serverMessage = e.response()?.errorBody()?.string()
            ?.let { body -> runCatching { FerrotuneJson.decodeFromString<ApiErrorDto>(body).error }.getOrNull() }
        throw FerrotuneApiException(e.code(), serverMessage ?: "Request failed (${e.code()})")
    } catch (e: IOException) {
        throw FerrotuneApiException(0, transportMessage(e))
    }

/** A message fit for people for any failure, including ones that bypassed [apiCall]. */
fun Throwable.readableMessage(): String? = when (this) {
    is FerrotuneApiException -> message
    is HttpException -> "Request failed (${code()})"
    is IOException -> transportMessage(this)
    else -> message?.takeIf { it.isNotBlank() }
}

/** OkHttp's messages ("Failed to connect to /10.0.2.2:4040") are not meant for people. */
internal fun transportMessage(e: IOException): String = when (e) {
    is ConnectException, is UnknownHostException, is NoRouteToHostException ->
        "Can't reach the server"
    is SocketTimeoutException -> "The server took too long to respond"
    else -> e.message ?: "Can't reach the server"
}
