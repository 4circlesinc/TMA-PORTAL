package com.tmantoinelaw.portal.core.data.auth

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class PkceTest {
    @Test
    fun `challenge is the base64url SHA-256 of the verifier (RFC 7636 appendix B)`() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test
    fun `a verifier is 43 url-safe characters, as the server validates (size 43, regex)`() {
        val v = Pkce.verifier()
        assertEquals(43, v.length)
        assertTrue(v.matches(Regex("^[A-Za-z0-9_-]+$")))
        assertNotEquals(v, Pkce.verifier())
    }
}
