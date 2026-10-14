package com.ferrotune.feature.feedback

import com.ferrotune.core.network.FerrotuneJson
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FeedbackReportTest {
    @Test
    fun serializesTheHubSubmissionShape() {
        val json = FerrotuneJson.parseToJsonElement(
            FeedbackReport(
                kind = FeedbackKind.Idea,
                message = "  Add lyrics  ",
                reporter = " ",
                page = "ferrotune-android://home",
                userAgent = "Ferrotune Android",
                context = mapOf("device" to "Pixel"),
                logs = listOf("E/Player: boom"),
                screenshots = listOf("data:image/png;base64,AAAA"),
            ).toJson(),
        ).jsonObject

        assertEquals(FEEDBACK_APP_ID, json["app"]!!.jsonPrimitive.content)
        assertEquals("idea", json["kind"]!!.jsonPrimitive.content)
        assertEquals("Add lyrics", json["message"]!!.jsonPrimitive.content)
        assertEquals("android", json["source"]!!.jsonPrimitive.content)
        assertTrue(json["reporter"].toString() == "null")
        val context = json["context"]!!.jsonObject
        assertEquals("Pixel", context["device"]!!.jsonPrimitive.content)
        assertEquals("E/Player: boom", context["logs"]!!.jsonArray.single().jsonPrimitive.content)
        assertEquals(1, json["screenshots"]!!.jsonArray.size)
    }

    @Test
    fun omitsLogsWhenThereAreNone() {
        val json = FerrotuneJson.parseToJsonElement(
            FeedbackReport(FeedbackKind.Bug, "x", null, null, null, emptyMap(), emptyList(), emptyList()).toJson(),
        ).jsonObject
        assertFalse("logs" in json["context"]!!.jsonObject)
    }

    @Test
    fun keepsTheNewestLogLines() {
        val raw = "--------- beginning of main\n" + (1..100).joinToString("\n") { "W/Tag: line $it" }
        val lines = recentLogLines(raw, max = 3)
        assertEquals(listOf("W/Tag: line 98", "W/Tag: line 99", "W/Tag: line 100"), lines)
    }
}
