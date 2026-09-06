package com.tmantoinelaw.portal.core.navigation

import kotlinx.serialization.Serializable

/**
 * One route per portal URL (prompt §8). Routes mirror the paths so a deep link
 * and an in-app navigation are the same thing.
 */
sealed interface Route {
    /** The portal path this screen lives at, for the address the web would show. */
    val path: String
}

@Serializable data object DashboardRoute : Route { override val path get() = "/" }
@Serializable data class OverviewRoute(val tab: String = "Overview") : Route { override val path get() = if (tab == "Overview") "/overview" else "/overview?tab=${tab.lowercase()}" }
/** The activity log (`/overview?tab=activity` on the web). */
@Serializable data object ActivityRoute : Route { override val path get() = "/overview?tab=activity" }
/** `/citizenship-applications[/rest]`: the hub's own router reads `rest` (clients.js:1170-1207). */
@Serializable data class ClientsRoute(val rest: String = "") : Route { override val path get() = "/citizenship-applications" + rest.prefixSlash() }
@Serializable data class EmailRoute(val message: String? = null, val page: String = "") : Route {
    override val path get() = "/email" + page.prefixSlash() + (message?.let { "?message=$it" } ?: "")
}
@Serializable data class MessagesRoute(val conversation: String? = null) : Route {
    override val path get() = "/social/messages" + (conversation?.let { "?conversation=$it" } ?: "")
}
@Serializable data object FeedRoute : Route { override val path get() = "/social/feed" }
@Serializable data object CalendarRoute : Route { override val path get() = "/calendar" }
@Serializable data object SignaturesRoute : Route { override val path get() = "/signatures" }
/** `section` is the File Library section slug the sidebar uses: all, personal, shared, shared-with-me, favorites, recent, filebox, recycle, clients. */
@Serializable data class FilesRoute(val section: String = "all", val folder: String? = null, val file: String? = null) : Route {
    override val path get() = "/folders/$section" + listOfNotNull(folder?.let { "folder=$it" }, file?.let { "file=$it" }).joinToString("&").let { if (it.isEmpty()) "" else "?$it" }
}
@Serializable data class UsersRoute(val new: Boolean = false) : Route { override val path get() = if (new) "/users/new" else "/users" }
@Serializable data object ReportingRoute : Route { override val path get() = "/reporting" }
/** `page`: system, email, letters, documents. */
@Serializable data class TemplatesRoute(val page: String = "system") : Route { override val path get() = if (page == "system") "/templates" else "/templates/$page" }
/** `page`: requests, feedback, updates. */
@Serializable data class WorkflowsRoute(val page: String = "requests") : Route { override val path get() = if (page == "requests") "/workflows" else "/workflows/$page" }
@Serializable data object CallRecordingsRoute : Route { override val path get() = "/call-recordings" }
/** `page`: home, employees, clients, prospects, shared-address-book, personal-address-book, distribution-groups, resend-welcome-emails. */
@Serializable data class PeopleRoute(val page: String = "home") : Route { override val path get() = if (page == "home") "/people" else "/people/$page" }
/** `page`: a settings rail id (prompt §8.3), null for the hub's first page. */
@Serializable data class SettingsRoute(val page: String? = null) : Route { override val path get() = "/account-settings" + (page?.let { "?settings-page=$it" } ?: "") }

private fun String.prefixSlash() = if (isEmpty()) "" else if (startsWith("/")) this else "/$this"

/** App-only: the web shows notifications in a popover; the app gives them a screen. */
@Serializable data object NotificationsRoute : Route { override val path get() = "/notifications" }

/** The one file viewer (prompt §11.6): full screen, opened from any list that shows a file. */
@Serializable data class FileViewerRoute(val fileId: String, val folderId: String? = null, val section: String = "all") : Route { override val path get() = "/folders/$section?file=$fileId" + (folderId?.let { "&folder=$it" } ?: "") }
