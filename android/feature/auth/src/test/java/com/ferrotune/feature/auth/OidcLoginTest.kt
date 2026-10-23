package com.ferrotune.feature.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OidcLoginTest {

    @Test
    fun `challenge is the unpadded base64url SHA-256 of the verifier`() {
        // Reference value from Python's hashlib + base64.urlsafe_b64encode.
        assertEquals(
            "RaMXe5Fh41o0bhnWOTu24qehJWTErURoN0FMRU9j31I",
            OidcLogin.challengeFor("dBjftJeZ4CVP-1B0gyBVvz9ys-v4p8wbBtH2Bqf6nx0"),
        )
    }

    @Test
    fun `new pairs are random and well formed`() {
        val first = OidcLogin.newPkce()
        val second = OidcLogin.newPkce()
        assertNotEquals(first.verifier, second.verifier)
        assertEquals(43, first.verifier.length)
        assertEquals(43, first.challenge.length)
        assertEquals(OidcLogin.challengeFor(first.verifier), first.challenge)
        assertTrue(first.verifier.all { it.isLetterOrDigit() || it == '-' || it == '_' })
    }

    @Test
    fun `base64url matches the reference encoding for every padding length`() {
        assertEquals("", OidcLogin.base64Url(byteArrayOf()))
        assertEquals("_w", OidcLogin.base64Url(byteArrayOf(-1)))
        assertEquals("__8", OidcLogin.base64Url(byteArrayOf(-1, -1)))
        assertEquals("____", OidcLogin.base64Url(byteArrayOf(-1, -1, -1)))
        assertEquals("Zm9vYmFy", OidcLogin.base64Url("foobar".toByteArray()))
    }

    @Test
    fun `start url asks the server to come back to the app`() {
        assertEquals(
            "https://music.example.org/api/auth/oidc/start" +
                "?redirect=ferrotune%3A%2F%2Foidc%2Fcallback&challenge=abc-_",
            OidcLogin.startUrl("https://music.example.org/", "abc-_"),
        )
    }

    @Test
    fun `redirects carry a code or an error`() {
        assertEquals(
            OidcLogin.Redirect.Code("a b"),
            OidcLogin.parseRedirect("ferrotune://oidc/callback?code=a+b"),
        )
        assertEquals(
            OidcLogin.Redirect.Failure("not in a group"),
            OidcLogin.parseRedirect("ferrotune://oidc/callback?error=not%20in%20a%20group"),
        )
        assertTrue(OidcLogin.parseRedirect("ferrotune://oidc/callback") is OidcLogin.Redirect.Failure)
        assertTrue(OidcLogin.parseRedirect("ferrotune://other?code=x") is OidcLogin.Redirect.Failure)
        assertFalse(OidcLogin.isRedirect("https://evil.example.org/?code=x"))
    }

    @Test
    fun `a newer redirect is not cleared by consuming an older one`() {
        val redirects = OidcRedirects()
        redirects.deliver("ferrotune://oidc/callback?code=1")
        redirects.deliver("ferrotune://oidc/callback?code=2")
        redirects.consume("ferrotune://oidc/callback?code=1")
        assertEquals("ferrotune://oidc/callback?code=2", redirects.pending.value)
        redirects.consume("ferrotune://oidc/callback?code=2")
        assertEquals(null, redirects.pending.value)
    }
}
