package com.ferrotune.core.network

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class ApiCallTest {

    @Test
    fun `connection failures get a readable message`() {
        assertEquals("Can't reach the server", transportMessage(ConnectException("Failed to connect to /10.0.2.2:4040")))
        assertEquals("Can't reach the server", transportMessage(UnknownHostException("music.example")))
        assertEquals("The server took too long to respond", transportMessage(SocketTimeoutException("timeout")))
        assertEquals("Certificate rejected", transportMessage(IOException("Certificate rejected")))
    }

    @Test
    fun `transport failures become status 0 api exceptions`() = runTest {
        try {
            apiCall { throw ConnectException("Failed to connect") }
            fail("expected an exception")
        } catch (e: FerrotuneApiException) {
            assertEquals(0, e.statusCode)
            assertEquals("Can't reach the server", e.message)
        }
    }

    @Test
    fun `readableMessage covers failures that bypassed apiCall`() {
        assertEquals("Can't reach the server", ConnectException("Failed to connect to /10.0.2.2:4040").readableMessage())
        assertEquals("Not found", FerrotuneApiException(404, "Not found").readableMessage())
        assertEquals("boom", IllegalStateException("boom").readableMessage())
        assertEquals(null, IllegalStateException("").readableMessage())
    }
}
