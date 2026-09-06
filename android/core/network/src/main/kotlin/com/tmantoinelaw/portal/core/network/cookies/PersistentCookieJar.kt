package com.tmantoinelaw.portal.core.network.cookies

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import java.net.URLDecoder

/**
 * The app's one cookie jar. Holds whatever `Set-Cookie` gave us, the session
 * cookie, the remember cookie, `XSRF-TOKEN`, the trusted-device cookies, and
 * hands the decoded CSRF token to the request interceptor. Names are never
 * hard-coded: production may rename the session cookie through SESSION_COOKIE.
 */
class PersistentCookieJar(private val store: CookieStore) : CookieJar {

    @Serializable
    private data class Stored(
        val name: String,
        val value: String,
        val expiresAt: Long,
        val domain: String,
        val path: String,
        val secure: Boolean,
        val httpOnly: Boolean,
        val hostOnly: Boolean,
    )

    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Any()
    private var cookies: MutableList<Cookie> = load()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        synchronized(lock) {
            for (c in cookies) {
                this.cookies.removeAll { it.name == c.name && it.domain == c.domain && it.path == c.path }
                if (c.expiresAt > System.currentTimeMillis() && c.value.isNotEmpty()) this.cookies.add(c)
            }
            persist()
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(lock) {
        val now = System.currentTimeMillis()
        val expired = cookies.filter { it.expiresAt <= now }
        if (expired.isNotEmpty()) { cookies.removeAll(expired); persist() }
        cookies.filter { it.matches(url) }
    }

    /** The URL-decoded `XSRF-TOKEN` value for this origin, the way every web helper sends it (current-user.js:137-150). */
    fun xsrfToken(url: HttpUrl): String? = synchronized(lock) {
        cookies.firstOrNull { it.name == "XSRF-TOKEN" && it.matches(url) }?.value?.let { URLDecoder.decode(it, "UTF-8") }
    }

    /** True when something other than the CSRF cookie is held: a session or a remember cookie. */
    fun hasSession(url: HttpUrl): Boolean = synchronized(lock) {
        cookies.any { it.name != "XSRF-TOKEN" && it.matches(url) && it.expiresAt > System.currentTimeMillis() }
    }

    fun clear() = synchronized(lock) {
        cookies.clear()
        store.clear()
    }

    private fun persist() {
        val stored = cookies.map { Stored(it.name, it.value, it.expiresAt, it.domain, it.path, it.secure, it.httpOnly, it.hostOnly) }
        store.write(json.encodeToString(ListSerializer(Stored.serializer()), stored))
    }

    private fun load(): MutableList<Cookie> {
        val raw = store.read() ?: return mutableListOf()
        return runCatching {
            json.decodeFromString(ListSerializer(Stored.serializer()), raw).map { s ->
                Cookie.Builder().name(s.name).value(s.value).expiresAt(s.expiresAt).path(s.path).apply {
                    if (s.hostOnly) hostOnlyDomain(s.domain) else domain(s.domain)
                    if (s.secure) secure()
                    if (s.httpOnly) httpOnly()
                }.build()
            }.toMutableList()
        }.getOrElse { mutableListOf() }
    }
}
