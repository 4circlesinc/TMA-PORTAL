package com.tmantoinelaw.portal

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.data.notifications.NotificationsRepository
import com.tmantoinelaw.portal.core.data.replica.FilesReplica
import com.tmantoinelaw.portal.core.network.Connectivity
import com.tmantoinelaw.portal.feature.shell.SyncStatus
import com.tmantoinelaw.portal.feature.shell.syncStatusFor
import kotlinx.coroutines.flow.combine
import com.tmantoinelaw.portal.core.data.prefs.DevicePrefs
import com.tmantoinelaw.portal.core.data.session.MeResult
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import com.tmantoinelaw.portal.core.navigation.Route
import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.ui.theme.ThemeMode
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The app's front door: who is signed in, and whether the loading layer may lift. */
sealed interface AppState {
    data object Booting : AppState
    data object SignedOut : AppState
    data class SignedIn(val identity: Identity) : AppState
}

sealed interface AppEvent {
    /** `/me` answered with a wall: open it in a Custom Tab and ask again when the tab returns. */
    data class FinishInBrowser(val url: String) : AppEvent
    /** A portal link the app does not handle itself (prompt §8.4). */
    data class OpenInBrowser(val url: String) : AppEvent
}

@HiltViewModel
class AppViewModel @Inject constructor(
    private val session: SessionRepository,
    private val prefs: DevicePrefs,
    private val config: PortalConfig,
    notifications: NotificationsRepository,
    private val downloads: com.tmantoinelaw.portal.files.PortalDownloads,
    connectivity: Connectivity,
    replica: FilesReplica,
) : ViewModel() {
    /** The header's sync pill (prompt §9.6). */
    val syncStatus: StateFlow<SyncStatus?> = combine(connectivity.online, replica.progress) { online, p ->
        syncStatusFor(online = online, replicaRunning = p.running, replicaTaken = p.taken, waiting = 0, failed = 0, syncing = false)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** The bell's badge (`/portal/notifications/count.unread`, kept absolute by the store). */
    val unread: StateFlow<Int> = notifications.unread

    private val _state = MutableStateFlow<AppState>(AppState.Booting)
    val state: StateFlow<AppState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<AppEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<AppEvent> = _events.asSharedFlow()

    /** A `tmaportal://auth?token=` that arrived; the sign-in screen consumes it. */
    val pendingToken = MutableStateFlow<String?>(null)

    /** A portal deep link that arrived; the signed-in shell consumes it. */
    val pendingRoute = MutableStateFlow<Route?>(null)

    /** Light unless the person chose otherwise (prompt §7.2). */
    val themeMode: StateFlow<ThemeMode> = prefs.themeMode.map { it.toThemeMode() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, ThemeMode.Light)

    init {
        viewModelScope.launch {
            // Warm boot: the remembered account paints first, the network confirms behind it.
            val cached = session.current()
            if (cached != null) {
                _state.value = AppState.SignedIn(cached)
            } else if (!session.hasCookies()) {
                _state.value = AppState.SignedOut
            }
            refreshNow()
            if (_state.value is AppState.Booting) _state.value = AppState.SignedOut
        }
        viewModelScope.launch {
            session.signedOut.collect { _state.value = AppState.SignedOut }
        }
        viewModelScope.launch {
            session.identity.collect { identity ->
                if (identity != null && _state.value !is AppState.Booting) _state.value = AppState.SignedIn(identity)
            }
        }
    }

    /** Ask the server who we are. Called at boot, on foreground, and after a browser wall closes. */
    fun refresh() {
        viewModelScope.launch { refreshNow() }
    }

    private suspend fun refreshNow() {
        when (val result = session.refreshMe()) {
            is MeResult.Ok -> _state.value = AppState.SignedIn(result.identity)
            MeResult.SignedOut -> _state.value = AppState.SignedOut
            is MeResult.NeedsBrowser -> _events.tryEmit(AppEvent.FinishInBrowser(result.url))
            MeResult.Offline, is MeResult.Failed -> Unit // whatever we had stands
        }
    }

    fun onAuthToken(token: String) {
        pendingToken.value = token
        if (_state.value is AppState.Booting) _state.value = AppState.SignedOut
    }

    fun onDeepLink(route: Route?, original: String) {
        if (route == null) _events.tryEmit(AppEvent.OpenInBrowser(original)) else pendingRoute.value = route
    }

    fun toggleTheme() {
        viewModelScope.launch {
            val next = if (themeMode.value == ThemeMode.Dark) "light" else "dark"
            prefs.setThemeMode(next)
        }
    }

    fun signOut() {
        viewModelScope.launch { session.signOut() }
    }

    fun download(context: android.content.Context, url: String, name: String) = downloads.enqueue(context, url, name)

    /** Relative portal URLs (`/media/avatars/…`) need the origin; the cookie jar adds the session. */
    fun absolute(url: String): String = if (url.startsWith("http")) url else config.url(url)

    private fun String.toThemeMode() = when (this) {
        "dark" -> ThemeMode.Dark
        "system" -> ThemeMode.System
        else -> ThemeMode.Light
    }
}
