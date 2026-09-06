package com.tmantoinelaw.portal.core.data.auth

import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import com.tmantoinelaw.portal.core.network.cookies.InMemoryCookieStore
import com.tmantoinelaw.portal.core.network.cookies.PersistentCookieJar
import com.tmantoinelaw.portal.core.network.session.SessionState
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SignInHandoffTest {
    private val server = MockWebServer()
    private lateinit var handoff: SignInHandoff
    private lateinit var verifiers: InMemoryVerifierStore
    private lateinit var jar: PersistentCookieJar

    @Before
    fun setUp() {
        server.start()
        val config = PortalConfig(server.url("/").toString().trimEnd('/'), false, "TMAPortal/test (Android 16)")
        jar = PersistentCookieJar(InMemoryCookieStore())
        val client = OkHttpClient.Builder().cookieJar(jar).followRedirects(false).build()
        verifiers = InMemoryVerifierStore()
        handoff = SignInHandoff(PortalHttp(client, config, SessionState()), verifiers)
    }

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun `start remembers the verifier and sends its challenge`() {
        val url = handoff.startUrl("google")
        val verifier = verifiers.stored()!!
        assertTrue(url.endsWith("/auth/desktop/start?challenge=${Pkce.challenge(verifier)}&provider=google"))
        assertTrue(handoff.hasPendingVerifier())
    }

    @Test
    fun `a 302 home with cookies is a signed-in session and the verifier is spent`() = runTest {
        handoff.startUrl(null)
        val verifier = verifiers.stored()!!
        server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "/").addHeader("Set-Cookie", "tm-antoine-advisory-session=abc; Path=/; HttpOnly"))
        val token = "t".repeat(64)
        assertEquals(SignInHandoff.Claim.Success, handoff.claim(token))
        val sent = server.takeRequest()
        assertEquals("/auth/desktop/claim?token=$token&verifier=$verifier", sent.path)
        assertNull(verifiers.stored())
        assertTrue(jar.hasSession(server.url("/")))
    }

    @Test
    fun `a bounce to the login page is a rejection`() = runTest {
        handoff.startUrl(null)
        server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "/auth/login"))
        assertEquals(SignInHandoff.Claim.Rejected, handoff.claim("t".repeat(64)))
        assertNull(verifiers.stored())
    }

    @Test
    fun `a deep link without a verifier on this device is refused before any request`() = runTest {
        assertEquals(SignInHandoff.Claim.NoVerifier, handoff.claim("t".repeat(64)))
        assertEquals(0, server.requestCount)
    }
}
