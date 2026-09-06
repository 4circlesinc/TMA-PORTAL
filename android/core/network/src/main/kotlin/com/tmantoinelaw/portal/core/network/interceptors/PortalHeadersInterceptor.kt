package com.tmantoinelaw.portal.core.network.interceptors

import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.network.cookies.PersistentCookieJar
import com.tmantoinelaw.portal.core.network.session.SessionState
import okhttp3.Interceptor
import okhttp3.Response

/**
 * The headers every portal request carries (prompt §5.2): JSON negotiation so
 * failures arrive as JSON rather than HTML redirects, the decoded CSRF cookie
 * on every write, the socket id so the server's `toOthers()` skips this device,
 * and a user agent that names Android.
 */
class PortalHeadersInterceptor(
    private val config: PortalConfig,
    private val jar: PersistentCookieJar,
    private val session: SessionState,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (!request.url.toString().startsWith(config.origin)) return chain.proceed(request)

        val builder = request.newBuilder()
            .header("Accept", "application/json")
            .header("X-Requested-With", "XMLHttpRequest")
            .header("User-Agent", config.userAgent)
        if (request.method != "GET" && request.method != "HEAD") {
            jar.xsrfToken(request.url)?.let { builder.header("X-XSRF-TOKEN", it) }
            session.socketId.value?.let { builder.header("X-Socket-ID", it) }
        }
        return chain.proceed(builder.build())
    }
}
