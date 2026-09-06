package com.tmantoinelaw.portal.feature.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.navigation.Route
import com.tmantoinelaw.portal.core.ui.theme.Tma
import kotlinx.coroutines.launch

/**
 * The shell around every signed-in screen (prompt §7.7, §8): on phones a
 * header bubble and a left drawer, on tablets and larger the persistent
 * sidebar beside the page. There is no bottom tab bar; the web retired it.
 */
@Composable
fun PortalShell(
    identity: Identity,
    title: String,
    activeNavId: String?,
    avatarUrl: String?,
    onNavigate: (Route) -> Unit,
    onToggleTheme: () -> Unit,
    onProfile: () -> Unit,
    onSettings: () -> Unit,
    onSignOut: () -> Unit,
    headerActions: @Composable RowScopeActions.() -> Unit = {},
    content: @Composable () -> Unit,
) {
    val layout = currentLayout()
    if (layout == Layout.Compact) {
        val drawer = rememberDrawerState(DrawerValue.Closed)
        val scope = rememberCoroutineScope()
        ModalNavigationDrawer(
            drawerState = drawer,
            drawerContent = {
                ModalDrawerSheet(
                    drawerContainerColor = Tma.colors.surface,
                    modifier = Modifier.width(280.dp),
                ) {
                    Sidebar(
                        identity = identity,
                        activeId = activeNavId,
                        avatarUrl = avatarUrl,
                        phone = true,
                        onNavigate = { scope.launch { drawer.close() }; onNavigate(it) },
                        onSignOut = onSignOut,
                    )
                }
            },
        ) {
            Column(Modifier.fillMaxSize().background(Tma.colors.page)) {
                Header(
                    title = title, identity = identity, avatarUrl = avatarUrl, phone = true,
                    onMenu = { scope.launch { drawer.open() } },
                    onToggleTheme = onToggleTheme, onProfile = onProfile, onSettings = onSettings, onSignOut = onSignOut,
                    actions = headerActions,
                )
                Box(Modifier.fillMaxSize().navigationBarsPadding()) { content() }
            }
        }
    } else {
        Row(Modifier.fillMaxSize().background(Tma.colors.page)) {
            Sidebar(
                identity = identity,
                activeId = activeNavId,
                avatarUrl = avatarUrl,
                phone = false,
                onNavigate = onNavigate,
                onSignOut = onSignOut,
                modifier = Modifier.width(240.dp).fillMaxHeight(),
            )
            Column(Modifier.fillMaxSize()) {
                Header(
                    title = title, identity = identity, avatarUrl = avatarUrl, phone = false,
                    onMenu = {},
                    onToggleTheme = onToggleTheme, onProfile = onProfile, onSettings = onSettings, onSignOut = onSignOut,
                    actions = headerActions,
                )
                Box(Modifier.fillMaxSize().navigationBarsPadding()) { content() }
            }
        }
    }
}
