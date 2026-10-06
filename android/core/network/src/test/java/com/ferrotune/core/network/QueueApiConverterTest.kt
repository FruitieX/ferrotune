package com.ferrotune.core.network

import com.ferrotune.core.network.dto.MoveInQueueRequest
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueApiConverterTest {
    @Test fun `queue move converts its response even when callers ignore it`() = runTest {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            assertEquals("/api/queue/move", chain.request().url.encodedPath)
            Response.Builder()
                .request(chain.request())
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
                .body("""{"success":true,"newIndex":2,"totalCount":5}""".toResponseBody())
                .build()
        }.build()
        val api = FerrotuneApiFactory().create("https://ferrotune.test", client)
        val response = api.moveInQueue(MoveInQueueRequest("session-1", 4, 2))
        assertTrue(response.success)
        assertEquals(2L, response.newIndex)
        assertEquals(5L, response.totalCount)
    }
}
