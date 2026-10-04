package com.ferrotune.core.testing

import com.ferrotune.core.network.generated.GetPreferenceResponse
import com.ferrotune.core.network.generated.PreferencesResponse
import com.ferrotune.core.network.generated.SetPreferenceRequest
import kotlinx.serialization.json.JsonElement

/**
 * [FakeFerrotuneApi] with an in-memory server preference store, shared by the
 * preference repository tests.
 */
open class FakePreferencesApi : FakeFerrotuneApi() {
    val preferenceValues = mutableMapOf<String, JsonElement>()
    val writtenKeys = mutableListOf<String>()

    override suspend fun preferences(): PreferencesResponse = PreferencesResponse(
        accentColor = "rust",
        preferences = preferenceValues.toMap(),
    )

    override suspend fun setPreference(
        key: String,
        request: SetPreferenceRequest,
    ): GetPreferenceResponse {
        writtenKeys.add(key)
        preferenceValues[key] = request.value
        return GetPreferenceResponse(key = key, value = request.value)
    }
}
