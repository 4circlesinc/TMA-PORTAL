package com.tmantoinelaw.portal.core.network.cookies

/** Where the cookie jar keeps its bytes. Encrypted on the device; in memory in tests. */
interface CookieStore {
    fun read(): String?
    fun write(json: String)
    fun clear()
}

class InMemoryCookieStore : CookieStore {
    private var json: String? = null
    override fun read(): String? = json
    override fun write(json: String) { this.json = json }
    override fun clear() { json = null }
}
