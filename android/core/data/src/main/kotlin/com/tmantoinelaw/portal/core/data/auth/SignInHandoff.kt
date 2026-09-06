package com.tmantoinelaw.portal.core.data.auth

import com.tmantoinelaw.portal.core.network.api.PortalHttp
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The desktop's sign-in handoff, unchanged (app/Http/Controllers/DesktopAuthController.php):
 *
 *   app: verifier = random, challenge = sha256(verifier)   → browser: /auth/desktop/start?challenge=…
 *   browser: sign in by any method                          → /auth/desktop/finish mints a token
 *   browser → app: tmaportal://auth?token=…
 *   app: GET /auth/desktop/claim?token=…&verifier=…         → 302 / with the session cookies
 *
 * The token is single use even on failure, and the verifier is forgotten the
 * moment it is spent, so a link grabbed by another app is worth nothing.
 */
@Singleton
class SignInHandoff @Inject constructor(
    private val http: PortalHttp,
    private val verifiers: VerifierStore,
) {
    sealed interface Claim {
        data object Success : Claim
        /** The token was burnt or the pair did not verify; the reason is only an HTML flash on the login page. */
        data object Rejected : Claim
        /** The deep link arrived with no verifier on this device: the sign-in was not started here. */
        data object NoVerifier : Claim
        data object Offline : Claim
    }

    /** Where to send the browser. Remembers the verifier first so a cold-start deep link can still claim. */
    fun startUrl(provider: String? = null): String {
        val verifier = Pkce.verifier()
        verifiers.remember(verifier)
        val challenge = Pkce.challenge(verifier)
        val query = buildString {
            append("challenge=").append(challenge)
            if (provider == "google" || provider == "microsoft") append("&provider=").append(provider)
        }
        return http.config.url("/auth/desktop/start?$query")
    }

    fun hasPendingVerifier(): Boolean = verifiers.stored() != null

    fun cancel() = verifiers.forget()

    suspend fun claim(token: String): Claim {
        if (token.length != 64) return Claim.Rejected
        val verifier = verifiers.stored() ?: return Claim.NoVerifier
        verifiers.forget()
        return try {
            http.raw(http.request("/auth/desktop/claim?token=$token&verifier=$verifier").get().build()) {
                // Success is a 302 to the portal root; every refusal is a 302 to the
                // sign-in page (whatever path that page has), so only "/" counts.
                val location = it.header("Location").orEmpty()
                val path = location.substringAfter("://", location).substringAfter("/", "").substringBefore("?").trimEnd('/')
                when {
                    it.code == 302 && path.isEmpty() -> Claim.Success
                    else -> Claim.Rejected
                }
            }
        } catch (e: IOException) {
            Claim.Offline
        }
    }
}
