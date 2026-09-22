package com.ferrotune.core.network

import kotlinx.serialization.json.Json

/**
 * Shared JSON configuration for the native API. Unknown fields are ignored so
 * the client keeps working when the server adds response fields.
 */
val FerrotuneJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    coerceInputValues = true
}
