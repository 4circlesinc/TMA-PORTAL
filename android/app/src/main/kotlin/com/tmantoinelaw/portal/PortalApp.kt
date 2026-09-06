package com.tmantoinelaw.portal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.navigation.DashboardRoute
import com.tmantoinelaw.portal.core.navigation.DeepLinks
import com.tmantoinelaw.portal.core.navigation.NotificationsRoute
import com.tmantoinelaw.portal.core.navigation.Route
import com.tmantoinelaw.portal.core.navigation.SettingsRoute
import com.tmantoinelaw.portal.core.ui.splash.BootSplash
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.feature.auth.SignInScreen
import com.tmantoinelaw.portal.feature.auth.openCustomTab
import com.tmantoinelaw.portal.feature.notifications.BellAction
import com.tmantoinelaw.portal.feature.shell.PortalShell
import kotlinx.coroutines.delay

/**
 * The app under the loading layer. The layer lifts once the first real screen
 * has composed and the lockup has finished rising (desktop/splash.js).
 */
@Composable
fun PortalApp(viewModel: AppViewModel, onFirstFrame: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var risen by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        onFirstFrame()
        delay(420)
        risen = true
    }
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is AppEvent.FinishInBrowser -> context.openCustomTab(event.url)
                is AppEvent.OpenInBrowser -> context.openCustomTab(event.url)
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Tma.colors.page)) {
        when (val s = state) {
            AppState.Booting -> Unit
            AppState.SignedOut -> SignInScreen(
                pendingToken = viewModel.pendingToken,
                onSignedIn = { viewModel.refresh() },
                onFinishInBrowser = { context.openCustomTab(it) },
            )
            is AppState.SignedIn -> SignedInApp(viewModel, s.identity)
        }
        BootSplash(visible = !(risen && state !is AppState.Booting))
    }
}

@Composable
private fun SignedInApp(viewModel: AppViewModel, identity: Identity) {
    val navController = rememberNavController()
    val entry by navController.currentBackStackEntryAsState()
    val navId = entry?.navId()
    val title = when (navId) {
        "notifications" -> "Notifications"
        "activity" -> "Activity"
        null -> "Dashboard"
        else -> navLabel(navId, "").ifEmpty { "Dashboard" }
    }
    val unread by viewModel.unread.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val pendingRoute by viewModel.pendingRoute.collectAsStateWithLifecycle()
    val avatarUrl = identity.avatar?.let { viewModel.absolute(it) }

    LaunchedEffect(pendingRoute) {
        pendingRoute?.let { route ->
            viewModel.pendingRoute.value = null
            navController.navigate(route) { launchSingleTop = true }
        }
    }

    fun go(route: Route) {
        navController.navigate(route) {
            launchSingleTop = true
            if (route == DashboardRoute) popUpTo(DashboardRoute) { inclusive = false }
        }
    }

    /** A portal URL from a notification or a row: in-app when the app has the screen, else the browser. */
    fun openUrl(url: String) {
        val uri = android.net.Uri.parse(if (url.startsWith("http")) url else viewModel.absolute(url))
        val query = uri.queryParameterNames.associateWith { uri.getQueryParameter(it).orEmpty() }
        val route = DeepLinks.parse(uri.path.orEmpty(), query)
        if (route != null) go(route) else context.openCustomTab(uri.toString())
    }

    PortalShell(
        identity = identity,
        title = title,
        activeNavId = navId,
        avatarUrl = avatarUrl,
        onNavigate = ::go,
        onToggleTheme = { viewModel.toggleTheme() },
        onProfile = { go(SettingsRoute("profile")) },
        onSettings = { go(SettingsRoute()) },
        onSignOut = { viewModel.signOut() },
        headerActions = { BellAction(unread = unread) { go(NotificationsRoute) } },
    ) {
        PortalNavHost(navController = navController, identity = identity, openUrl = ::openUrl, resolveUrl = viewModel::absolute, download = { url, name -> viewModel.download(context, url, name) })
    }
}
