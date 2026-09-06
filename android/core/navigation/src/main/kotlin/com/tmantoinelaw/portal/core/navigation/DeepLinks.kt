package com.tmantoinelaw.portal.core.navigation

/**
 * Portal URLs the app handles itself (prompt §8.4). Anything else, the auth
 * pages, public token links, onboarding, legal pages, stays in the browser.
 */
object DeepLinks {
    /** Paths that never load in-app; open them in a Custom Tab instead. */
    private val browserOnly = listOf("/auth", "/r/", "/s/", "/sign/", "/invite/", "/onboarding", "/privacy-policy", "/terms-of-service", "/design", "/classic")

    private val filesSections = mapOf(
        "all" to "all", "clients" to "clients", "personal" to "personal", "shared" to "shared",
        "shared-with-me" to "shared-with-me", "favorites" to "favorites", "recent" to "recent",
        "filebox" to "filebox", "recycle" to "recycle",
    )

    /** A route for a portal path (with query), or null when the browser should have it. */
    fun parse(path: String, query: Map<String, String> = emptyMap()): Route? {
        val p = path.trimEnd('/').ifEmpty { "/" }
        if (browserOnly.any { p == it.trimEnd('/') || p.startsWith(it) }) return null
        val segments = p.trim('/').split('/').filter { it.isNotEmpty() }
        return when (segments.firstOrNull()) {
            null -> DashboardRoute
            "overview" -> if (query["tab"] == "activity") ActivityRoute else OverviewRoute()
            "citizenship-applications", "clients" -> ClientsRoute(rest = segments.drop(1).joinToString("/"))
            "email" -> EmailRoute(message = query["message"], page = segments.drop(1).joinToString("/"))
            "social" -> when (segments.getOrNull(1)) {
                "messages" -> MessagesRoute(conversation = query["conversation"])
                "feed" -> FeedRoute
                else -> null
            }
            "calendar" -> CalendarRoute
            "signatures" -> SignaturesRoute
            "folders" -> filesSections[segments.getOrNull(1) ?: "all"]?.let { FilesRoute(it, query["folder"], query["file"]) }
            "users" -> UsersRoute(new = segments.getOrNull(1) == "new")
            "reporting" -> ReportingRoute
            "templates" -> TemplatesRoute(page = segments.getOrNull(1) ?: "system")
            "workflows" -> WorkflowsRoute(page = segments.getOrNull(1) ?: "requests")
            "call-recordings" -> CallRecordingsRoute
            "people" -> PeopleRoute(page = segments.getOrNull(1) ?: "home")
            "account-settings", "account", "settings" -> SettingsRoute(page = query["settings-page"] ?: query["page"])
            "security-settings" -> SettingsRoute(page = "account-security")
            "profile" -> SettingsRoute(page = "profile")
            else -> null
        }
    }
}
