package com.tmantoinelaw.portal.web

import android.net.Uri

/**
 * Where a navigation may go, copied from desktop/main.js attachNavigationRules
 * and desktop/signin-provider.js: the portal and the OAuth hosts load in the
 * shell, a social sign-in from the sign-in page goes to the real browser
 * (Google refuses OAuth inside an embedded webview), everything else opens
 * outside.
 */
class NavigationRules(private val origin: String) {
    private val socialRedirect = Regex("^/auth/social/(google|microsoft)/redirect\\b")
    private val connectReturns = setOf("getting-started", "connectors", "profile", "email", "calendar", "onboarding", "account-setup-email")
    private val authHosts = setOf("accounts.google.com", "login.microsoftonline.com", "login.live.com", "oauth.googleusercontent.com")

    fun isPortalUrl(url: String): Boolean = originOf(url) == origin

    /** The OAuth hosts a connect flow walks through (prompt §12). */
    fun isAuthUrl(url: String): Boolean = runCatching { Uri.parse(url).host?.lowercase() in authHosts }.getOrDefault(false)

    fun isSocialRedirect(url: String): Boolean = isPortalUrl(url) && socialRedirect.containsMatchIn(Uri.parse(url).path.orEmpty())

    private fun isConnectPage(path: String) = path == "/auth/getting-started" || path.startsWith("/auth/getting-started/") || path == "/auth/setup" || path.startsWith("/auth/setup/")

    private fun isConnectRedirect(url: String): Boolean = runCatching {
        val u = Uri.parse(url)
        if (listOf("sync_all", "sync_email", "sync_calendar", "sync_onedrive", "sync_sharepoint").any { u.getQueryParameter(it) != null }) return true
        (u.getQueryParameter("return") ?: "") in connectReturns
    }.getOrDefault(false)

    /** "google" or "microsoft" when this link is a sign-in (not a connect) started from the sign-in page; else null. */
    fun signInProviderFor(url: String, currentUrl: String?): String? {
        if (!isSocialRedirect(url) || isConnectRedirect(url)) return null
        val from = runCatching { Uri.parse(currentUrl.orEmpty()) }.getOrNull() ?: return null
        if (originOf(currentUrl.orEmpty()) != origin) return null
        val path = from.path.orEmpty()
        val signingIn = (path == "/" || path.startsWith("/auth/")) && !path.startsWith("/auth/desktop") && !isConnectPage(path)
        if (!signingIn) return null
        return socialRedirect.find(Uri.parse(url).path.orEmpty())?.groupValues?.get(1)
    }

    private fun originOf(url: String): String? = runCatching {
        val u = Uri.parse(url)
        val scheme = u.scheme ?: return null
        val host = u.host ?: return null
        val port = u.port
        val defaultPort = (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
        "$scheme://$host" + if (port == -1 || defaultPort) "" else ":$port"
    }.getOrNull()
}
