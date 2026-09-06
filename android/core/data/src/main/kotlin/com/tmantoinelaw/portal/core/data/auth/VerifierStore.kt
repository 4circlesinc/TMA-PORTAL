package com.tmantoinelaw.portal.core.data.auth

/** Where the pending verifier waits for the browser to come back. Encrypted on the device; in memory in tests. */
interface VerifierStore {
    fun remember(verifier: String)
    fun stored(): String?
    fun forget()
}

class InMemoryVerifierStore : VerifierStore {
    private var value: String? = null
    override fun remember(verifier: String) { value = verifier }
    override fun stored(): String? = value
    override fun forget() { value = null }
}
