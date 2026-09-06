package com.tmantoinelaw.portal

import androidx.compose.runtime.Composable
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.navigation.CalendarRoute
import com.tmantoinelaw.portal.core.navigation.CallRecordingsRoute
import com.tmantoinelaw.portal.core.navigation.ClientsRoute
import com.tmantoinelaw.portal.core.navigation.DashboardRoute
import com.tmantoinelaw.portal.core.navigation.EmailRoute
import com.tmantoinelaw.portal.core.navigation.FeedRoute
import com.tmantoinelaw.portal.core.navigation.FilesRoute
import com.tmantoinelaw.portal.core.navigation.MessagesRoute
import com.tmantoinelaw.portal.core.navigation.OverviewRoute
import com.tmantoinelaw.portal.core.navigation.PeopleRoute
import com.tmantoinelaw.portal.core.navigation.ReportingRoute
import com.tmantoinelaw.portal.core.navigation.Route
import com.tmantoinelaw.portal.core.navigation.SettingsRoute
import com.tmantoinelaw.portal.core.navigation.SignaturesRoute
import com.tmantoinelaw.portal.core.navigation.TemplatesRoute
import com.tmantoinelaw.portal.core.navigation.UsersRoute
import com.tmantoinelaw.portal.core.navigation.WorkflowsRoute
import com.tmantoinelaw.portal.feature.shell.ModulePlaceholder
import com.tmantoinelaw.portal.feature.shell.NavTree
import com.tmantoinelaw.portal.feature.shell.SettingsHubScreen

/** Every portal route, each handed to its module's screen (placeholders until the module's phase). */
@Composable
fun PortalNavHost(navController: NavHostController, identity: Identity) {
    NavHost(navController = navController, startDestination = DashboardRoute) {
        composable<DashboardRoute> { ModulePlaceholder("Dashboard") }
        composable<OverviewRoute> { ModulePlaceholder("Overview") }
        composable<ClientsRoute> { ModulePlaceholder("CIP Applications") }
        composable<EmailRoute> { ModulePlaceholder("Email") }
        composable<MessagesRoute> { ModulePlaceholder("Messages") }
        composable<FeedRoute> { ModulePlaceholder("Feed") }
        composable<CalendarRoute> { ModulePlaceholder("Calendar") }
        composable<SignaturesRoute> { ModulePlaceholder("Signature requests") }
        composable<FilesRoute> { entry -> ModulePlaceholder(filesTitle(entry.toRoute<FilesRoute>().section)) }
        composable<UsersRoute> { ModulePlaceholder("Users") }
        composable<ReportingRoute> { ModulePlaceholder("Reporting") }
        composable<TemplatesRoute> { entry -> ModulePlaceholder(navLabel("templates-" + entry.toRoute<TemplatesRoute>().page, "Templates")) }
        composable<WorkflowsRoute> { entry -> ModulePlaceholder(navLabel("workflows-" + workflowsId(entry.toRoute<WorkflowsRoute>().page), "Workflows")) }
        composable<CallRecordingsRoute> { ModulePlaceholder("Call Recordings") }
        composable<PeopleRoute> { entry -> ModulePlaceholder(navLabel("people-" + peopleId(entry.toRoute<PeopleRoute>().page), "People")) }
        composable<SettingsRoute> { entry ->
            val route = entry.toRoute<SettingsRoute>()
            SettingsHubScreen(identity = identity, page = route.page, onOpen = { navController.navigate(SettingsRoute(it)) { launchSingleTop = true } })
        }
    }
}

/** The sidebar entry a back-stack entry belongs to, for highlighting and the page title. */
fun NavBackStackEntry.navId(): String? {
    val d = destination
    fun <T : Route> has(kClass: kotlin.reflect.KClass<T>) = d.hasRoute(kClass)
    return when {
        has(DashboardRoute::class) -> "dash-dashboard"
        has(OverviewRoute::class) -> "dash-project-overview"
        has(ClientsRoute::class) -> "clients"
        has(EmailRoute::class) -> "email"
        has(MessagesRoute::class) -> "so-messages"
        has(FeedRoute::class) -> "so-feed"
        has(CalendarRoute::class) -> "calendar"
        has(SignaturesRoute::class) -> "signatures"
        has(FilesRoute::class) -> "folders-" + when (toRoute<FilesRoute>().section) {
            "personal" -> "personal"; "shared" -> "shared"; "shared-with-me" -> "sharedwithme"; "favorites" -> "favorites"
            "recent" -> "recent"; "filebox" -> "filebox"; "recycle" -> "recycle"; "clients" -> "clients"; else -> "all"
        }
        has(UsersRoute::class) -> "users"
        has(ReportingRoute::class) -> "reporting"
        has(TemplatesRoute::class) -> "templates-" + toRoute<TemplatesRoute>().page
        has(WorkflowsRoute::class) -> "workflows-" + workflowsId(toRoute<WorkflowsRoute>().page)
        has(CallRecordingsRoute::class) -> "call-recordings"
        has(PeopleRoute::class) -> "people-" + peopleId(toRoute<PeopleRoute>().page)
        has(SettingsRoute::class) -> "account-settings"
        else -> null
    }
}

fun navLabel(id: String, fallback: String): String =
    NavTree.items.asSequence().flatMap { sequenceOf(it) + it.children.asSequence() }.firstOrNull { it.id == id }?.label ?: fallback

private fun filesTitle(section: String) = when (section) {
    "clients" -> "Client Folders"; "personal" -> "Personal Folders"; "shared" -> "Shared Folders"; "shared-with-me" -> "Shared with me"
    "favorites" -> "Favorites"; "recent" -> "Recent"; "filebox" -> "File Box"; "recycle" -> "Recycle Bin"; else -> "All Files"
}

private fun workflowsId(page: String) = when (page) { "feedback" -> "feedback"; "updates" -> "updates"; else -> "automated" }

private fun peopleId(page: String) = when (page) {
    "employees" -> "employees"; "clients" -> "clients"; "prospects" -> "prospects"; "shared-address-book" -> "shared-address"
    "personal-address-book" -> "personal-address"; "distribution-groups" -> "groups"; "resend-welcome-emails" -> "resend"; else -> "home"
}
