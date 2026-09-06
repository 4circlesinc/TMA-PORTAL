package com.tmantoinelaw.portal.core.network.interceptors

import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.network.cookies.PersistentCookieJar
import com.tmantoinelaw.portal.core.network.session.SessionState
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response

/**
 * 419 means the `XSRF-TOKEN` we echoed is stale. Any GET refreshes the cookie
 * (the web middleware sets it on every response), so do one, retry the write
 * once with the new token, and only then give up. A 401 is a dead session and
 * is announced so the app can return to sign-in.
 */
class CsrfRetryInterceptor(
    private val config: PortalConfig,
    private val jar: PersistentCookieJar,
    private val session: SessionState,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val generation = jar.generation
        var response = chain.proceed(request)
        if (response.code == 419 && request.isWrite() && request.header(RETRIED) == null) {
            response.close()
            chain.proceed(Request.Builder().url(config.url("/me")).get().build()).close()
            val retry = request.newBuilder().header(RETRIED, "1").apply {
                jar.xsrfToken(request.url)?.let { header("X-XSRF-TOKEN", it) }
            }.build()
            response = chain.proceed(retry)
        }
        if (response.code == 401 || (response.code == 419 && request.header(RETRIED) != null)) {
            session.unauthorized.tryEmit(generation)
        }
        return response
    }

    private fun Request.isWrite() = method != "GET" && method != "HEAD"

    private companion object { const val RETRIED = "X-TMA-Csrf-Retried" }
}
