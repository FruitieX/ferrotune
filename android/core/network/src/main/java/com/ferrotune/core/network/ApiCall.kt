package com.ferrotune.core.network

import com.ferrotune.core.network.dto.ApiErrorDto
import retrofit2.HttpException
import java.io.IOException

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
        throw FerrotuneApiException(0, e.message ?: "Unable to connect to server")
    }
