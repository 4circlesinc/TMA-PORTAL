package com.tmantoinelaw.portal.core.data.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** The desktop's verifier/challenge pair (desktop/main.js:651,711-712): base64url without padding. */
object Pkce {
    fun verifier(): String = base64Url(ByteArray(32).also { SecureRandom().nextBytes(it) })

    fun challenge(verifier: String): String =
        base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    private fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}
