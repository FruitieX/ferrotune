package com.ferrotune.audio

import androidx.media3.common.PlaybackException

enum class PlaybackErrorCategory(val jsValue: String) {
    AUTH("auth"),
    NETWORK("network"),
    HTTP("http"),
    SOURCE_MISSING("source-missing"),
    RANGE("range"),
    DECODE("decode"),
    UNKNOWN("unknown"),
}

data class PlaybackErrorClassification(
    val category: PlaybackErrorCategory,
    val message: String,
    val retryable: Boolean,
)

fun classifyPlaybackError(
    errorCode: Int,
    httpStatusCode: Int?,
    fallbackMessage: String?,
): PlaybackErrorClassification {
    if (httpStatusCode != null) {
        return classifyHttpPlaybackError(httpStatusCode, fallbackMessage)
    }

    return when (errorCode) {
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
        PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
        -> PlaybackErrorClassification(
            PlaybackErrorCategory.NETWORK,
            "Network interrupted while streaming.",
            retryable = true,
        )

        PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> PlaybackErrorClassification(
            PlaybackErrorCategory.SOURCE_MISSING,
            "Track file is missing or unavailable.",
            retryable = false,
        )

        PlaybackException.ERROR_CODE_IO_NO_PERMISSION -> PlaybackErrorClassification(
            PlaybackErrorCategory.AUTH,
            "Playback is not authorized. Please sign in again.",
            retryable = false,
        )

        PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE -> PlaybackErrorClassification(
            PlaybackErrorCategory.RANGE,
            "Playback position is no longer available for this stream.",
            retryable = false,
        )

        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED,
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
        -> PlaybackErrorClassification(
            PlaybackErrorCategory.DECODE,
            "This track could not be decoded by the native player.",
            retryable = false,
        )

        else -> PlaybackErrorClassification(
            PlaybackErrorCategory.UNKNOWN,
            fallbackMessage?.takeIf { it.isNotBlank() } ?: "Unknown playback error",
            retryable = false,
        )
    }
}

private fun classifyHttpPlaybackError(
    httpStatusCode: Int,
    fallbackMessage: String?,
): PlaybackErrorClassification {
    return when (httpStatusCode) {
        401,
        403
        -> PlaybackErrorClassification(
            PlaybackErrorCategory.AUTH,
            "Playback authentication failed. Please sign in again.",
            retryable = false,
        )

        404 -> PlaybackErrorClassification(
            PlaybackErrorCategory.SOURCE_MISSING,
            "Track file is missing or unavailable.",
            retryable = false,
        )

        416 -> PlaybackErrorClassification(
            PlaybackErrorCategory.RANGE,
            "Playback position is no longer available for this stream.",
            retryable = false,
        )

        408,
        429,
        in 500..599
        -> PlaybackErrorClassification(
            PlaybackErrorCategory.NETWORK,
            "Network interrupted while streaming.",
            retryable = true,
        )

        in 400..499 -> PlaybackErrorClassification(
            PlaybackErrorCategory.HTTP,
            fallbackMessage?.takeIf { it.isNotBlank() }
                ?: "Streaming request failed ($httpStatusCode).",
            retryable = false,
        )

        else -> PlaybackErrorClassification(
            PlaybackErrorCategory.HTTP,
            fallbackMessage?.takeIf { it.isNotBlank() }
                ?: "Streaming request failed ($httpStatusCode).",
            retryable = false,
        )
    }
}