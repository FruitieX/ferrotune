package com.ferrotune.core.network

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.serializer

/**
 * Converts a generated request/query DTO into Retrofit `@QueryMap` parameters.
 *
 * Null fields are omitted; primitives are rendered with their JSON scalar
 * representation so numbers and booleans match the server's expectations.
 */
inline fun <reified T> T.toQueryMap(): Map<String, String> {
    val element = FerrotuneJson.encodeToJsonElement(serializer(), this).jsonObject
    return element.mapNotNull { (key, value) ->
        when (value) {
            JsonNull -> null
            is JsonPrimitive -> key to value.content
            else -> key to value.toString()
        }
    }.toMap()
}
