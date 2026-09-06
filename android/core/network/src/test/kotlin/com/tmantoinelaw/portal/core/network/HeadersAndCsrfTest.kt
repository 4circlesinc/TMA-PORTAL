package com.tmantoinelaw.portal.core.network

import com.tmantoinelaw.portal.core.network.cookies.InMemoryCookieStore
import com.tmantoinelaw.portal.core.network.cookies.PersistentCookieJar
import com.tmantoinelaw.portal.core.network.interceptors.CsrfRetryInterceptor
import com.tmantoinelaw.portal.core.network.interceptors.PortalHeadersInterceptor
import com.tmantoinelaw.portal.core.network.session.SessionState
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HeadersAndCsrfTest {
    private val server = MockWebServer()
    private lateinit var config: PortalConfig
    private lateinit var jar: PersistentCookieJar
    private lateinit var session: SessionState
    private lateinit var client: OkHttpClient

    @Before
    fun setUp() {
        server.start()
        config = PortalConfig(server.url("/").toString().trimEnd('/'), rewriteLocalhost = false, userAgent = "TMAPortal/test (Android 16)")
        jar = PersistentCookieJar(InMemoryCookieStore())
        session = SessionState()
        client = OkHttpClient.Builder()
            .cookieJar(jar)
            .followRedirects(false)
            .addInterceptor(PortalHeadersInterceptor(config, jar, session))
            .addInterceptor(CsrfRetryInterceptor(config, jar, session))
            .build()
    }

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun `every request negotiates JSON and names Android`() {
        server.enqueue(MockResponse().setBody("{}"))
        client.newCall(Request.Builder().url(config.url("/me")).build()).execute().close()
        val sent = server.takeRequest()
        assertEquals("application/json", sent.getHeader("Accept"))
        assertEquals("XMLHttpRequest", sent.getHeader("X-Requested-With"))
        assertEquals("TMAPortal/test (Android 16)", sent.getHeader("User-Agent"))
        assertNull(sent.getHeader("X-XSRF-TOKEN"))
    }

    @Test
    fun `writes echo the URL-decoded XSRF cookie and the socket id`() {
        server.enqueue(MockResponse().setBody("{}").addHeader("Set-Cookie", "XSRF-TOKEN=abc%3D%3D; Path=/"))
        client.newCall(Request.Builder().url(config.url("/me")).build()).execute().close()
        server.takeRequest()
        session.socketId.value = "123.456"
        server.enqueue(MockResponse().setBody("{}"))
        client.newCall(Request.Builder().url(config.url("/portal/x")).post("{}".toRequestBody()).build()).execute().close()
        val sent = server.takeRequest()
        assertEquals("abc==", sent.getHeader("X-XSRF-TOKEN"))
        assertEquals("123.456", sent.getHeader("X-Socket-ID"))
    }

    @Test
    fun `a 419 refreshes the token with one GET and retries the write once`() {
        server.enqueue(MockResponse().setResponseCode(419).setBody("""{"message":"CSRF token mismatch."}"""))
        server.enqueue(MockResponse().setBody("{}").addHeader("Set-Cookie", "XSRF-TOKEN=fresh; Path=/"))
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        val response = client.newCall(Request.Builder().url(config.url("/portal/x")).post("{}".toRequestBody()).build()).execute()
        assertEquals(200, response.code)
        response.close()
        assertEquals("POST", server.takeRequest().method)
        val refresh = server.takeRequest()
        assertEquals("GET", refresh.method)
        assertEquals("/me", refresh.path)
        val retry = server.takeRequest()
        assertEquals("fresh", retry.getHeader("X-XSRF-TOKEN"))
        assertEquals(3, server.requestCount)
    }

    @Test
    fun `the jar survives a reload`() {
        val store = InMemoryCookieStore()
        val first = PersistentCookieJar(store)
        val url = server.url("/")
        first.saveFromResponse(url, listOf(okhttp3.Cookie.parse(url, "tm-antoine-advisory-session=s1; Path=/; HttpOnly")!!))
        val second = PersistentCookieJar(store)
        assertEquals(true, second.hasSession(url))
        assertEquals("s1", second.loadForRequest(url).single().value)
    }
}
