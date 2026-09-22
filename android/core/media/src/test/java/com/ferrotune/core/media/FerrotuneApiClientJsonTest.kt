package com.ferrotune.core.media

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FerrotuneApiClientJsonTest {
    @Test
    fun normalizesJsonNullOwnerFieldsToKotlinNull() {
        assertNull(normalizeNullableJsonString(null))
        assertNull(normalizeNullableJsonString(JSONObject.NULL))
    }

    @Test
    fun preservesNonNullOwnerFieldsAndTreatsEmptyStringsAsNull() {
        assertEquals("phone-client", normalizeNullableJsonString("phone-client"))
        assertEquals("ferrotune-mobile", normalizeNullableJsonString("ferrotune-mobile"))
        assertNull(normalizeNullableJsonString(""))
    }
}
