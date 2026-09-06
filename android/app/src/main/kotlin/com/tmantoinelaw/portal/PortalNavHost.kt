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
import com.tmantoinelaw.portal.core.navigation.NotificationsRoute
import com.tmantoinelaw.portal.core.navigation.OverviewRoute
import com.tmantoinelaw.portal.core.navigation.PeopleRoute
import com.tmantoinelaw.portal.core.navigation.ReportingRoute
import com.tmantoinelaw.portal.core.navigation.Route
import com.tmantoinelaw.portal.core.navigation.SettingsRoute
import com.tmantoinelaw.portal.core.navigation.SignaturesRoute
import com.tmantoinelaw.portal.core.navigation.TemplatesRoute
import com.tmantoinelaw.portal.core.navigation.UsersRoute
import com.tmantoinelaw.portal.core.navigation.WorkflowsRoute
import com.tmantoinelaw.portal.feature.home.HomeActions
import com.tmantoinelaw.portal.feature.files.FilesScreen
import com.tmantoinelaw.portal.feature.files.viewer.FileViewerScreen
import com.tmantoinelaw.portal.core.navigation.FileViewerRoute
import com.tmantoinelaw.portal.feature.home.HomeScreen
import com.tmantoinelaw.portal.feature.home.OverviewScreen
import com.tmantoinelaw.portal.core.navigation.ActivityRoute
import com.tmantoinelaw.portal.feature.notifications.NotificationsScreen
import com.tmantoinelaw.portal.feature.shell.ModulePlaceholder
import com.tmantoinelaw.portal.feature.shell.NavTree
import com.tmantoinelaw.portal.feature.shell.SettingsHubScreen

/** Every portal route, each handed to its module's screen (placeholders until the module's phase). */
@Composable
fun PortalNavHost(
    navController: NavHostController,
    identity: Identity,
    openUrl: (String) -> Unit,
    resolveUrl: (String) -> String,
    download: (url: String, name: String) -> Unit,
) {
    NavHost(navController = navController, startDestination = DashboardRoute) {
        composable<NotificationsRoute> {
            NotificationsScreen(onOpen = { item -> item.actionUrl?.let(openUrl) }, resolveUrl = resolveUrl)
        }
        composable<DashboardRoute> {
            HomeScreen(
                actions = HomeActions(
                    go = { navController.navigate(it) { launchSingleTop = true } },
                    openFile = { file, folder -> navController.navigate(FilesRoute("all", folder = folder, file = file)) { launchSingleTop = true } },
                    openFolder = { folder -> navController.navigate(FilesRoute("all", folder = folder)) { launchSingleTop = true } },
                ),
            )
        }
        composable<OverviewRoute> {
            OverviewScreen(
                go = { navController.navigate(it) { launchSingleTop = true } },
                openFile = { file, folder -> navController.navigate(FilesRoute("all", folder = folder, file = file)) { launchSingleTop = true } },
            )
        }
        composable<ActivityRoute> { ModulePlaceholder("Activity") }
        composable<ClientsRoute> { ModulePlaceholder("CIP Applications") }
        composable<EmailRoute> { ModulePlaceholder("Email") }
        composable<MessagesRoute> { ModulePlaceholder("Messages") }
        composable<FeedRoute> { ModulePlaceholder("Feed") }
        composable<CalendarRoute> { ModulePlaceholder("Calendar") }
        composable<SignaturesRoute> { ModulePlaceholder("Signature requests") }
        composable<FilesRoute> { entry ->
            val route = entry.toRoute<FilesRoute>()
            FilesScreen(
                onOpenFolder = { folder -> navController.navigate(FilesRoute(route.section, folder = folder)) { launchSingleTop = true } },
                onOpenFile = { file, folder -> navController.navigate(FileViewerRoute(file, folder, route.section)) { launchSingleTop = true } },
                onDownload = download,
            )
        }
        composable<FileViewerRoute> {
            FileViewerScreen(onClose = { navController.popBackStack() }, onDownload = download, onDelete = { })
        }
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
        has(NotificationsRoute::class) -> "notifications"
        has(ActivityRoute::class) -> "activity"
        has(FileViewerRoute::class) -> "folders-all"
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
