package com.tmantoinelaw.portal

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tmantoinelaw.portal.core.data.auth.SignInHandoff
import com.tmantoinelaw.portal.core.data.prefs.DevicePrefs
import com.tmantoinelaw.portal.core.network.Connectivity
import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.network.cookies.PersistentCookieJar
import com.tmantoinelaw.portal.core.ui.theme.ThemeMode
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrl
import javax.inject.Inject

/** What the host must do that the page cannot (desktop/main.js ipc + sign-in handoff). */
sealed interface AppEvent {
    data class OpenOutside(val url: String) : AppEvent
    data class ShowSignInWaiting(val providerLabel: String) : AppEvent
    /** The browser signed in and the claim brought back cookies: hand them to the page and load the portal. */
    data class SessionClaimed(val setCookieLines: List<String>) : AppEvent
    data class LoadPortal(val path: String) : AppEvent
    data class Notice(val title: String, val message: String) : AppEvent
}

@HiltViewModel
class AppViewModel @Inject constructor(
    private val handoff: SignInHandoff,
    private val jar: PersistentCookieJar,
    private val prefs: DevicePrefs,
    val config: PortalConfig,
    val connectivity: Connectivity,
) : ViewModel() {
    private val _events = MutableSharedFlow<AppEvent>(extraBufferCapacity = 8)
    val events: SharedFlow<AppEvent> = _events.asSharedFlow()

    /** Light unless the person chose otherwise (prompt §7.2); the page's `data-theme` is the authority once it loads. */
    val themeMode: StateFlow<ThemeMode> = prefs.themeMode.map { it.toThemeMode() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, ThemeMode.Light)

    /** The system-browser URL of the current handoff (pendingBrowserSignInUrl). */
    private var pendingBrowserSignInUrl: String? = null

    /** desktop/main.js startBrowserSignIn: verifier + challenge, the browser opens /auth/desktop/start, the window waits. */
    fun startBrowserSignIn(provider: String?) {
        val url = handoff.startUrl(provider)
        pendingBrowserSignInUrl = url
        _events.tryEmit(AppEvent.OpenOutside(url))
        _events.tryEmit(AppEvent.ShowSignInWaiting(when (provider) { "google" -> "Google"; "microsoft" -> "Microsoft"; else -> "" }))
    }

    fun reopenBrowserSignIn() { pendingBrowserSignInUrl?.let { _events.tryEmit(AppEvent.OpenOutside(it)) } }

    fun cancelBrowserSignIn() {
        handoff.cancel()
        pendingBrowserSignInUrl = null
        _events.tryEmit(AppEvent.LoadPortal("/auth/login"))
    }

    /** `tmaportal://auth?token=…` came back: claim it with the verifier (claimBrowserSession). */
    fun onAuthToken(token: String) {
        viewModelScope.launch {
            when (handoff.claim(token)) {
                SignInHandoff.Claim.Success -> {
                    pendingBrowserSignInUrl = null
                    val lines = jar.loadForRequest(config.origin.toHttpUrl()).map { it.toString() }
                    _events.tryEmit(AppEvent.SessionClaimed(lines))
                }
                SignInHandoff.Claim.NoVerifier -> _events.tryEmit(AppEvent.Notice("Sign-in could not be completed", "Start signing in from this window rather than from the browser, and finish in the tab it opens."))
                SignInHandoff.Claim.Rejected -> _events.tryEmit(AppEvent.LoadPortal("/auth/login"))
                SignInHandoff.Claim.Offline -> _events.tryEmit(AppEvent.Notice("Sign-in could not be completed", "The portal could not be reached. Try again when you have a connection."))
            }
        }
    }

    fun rememberTheme(dark: Boolean) { viewModelScope.launch { prefs.setThemeMode(if (dark) "dark" else "light") } }

    private fun String.toThemeMode() = when (this) { "dark" -> ThemeMode.Dark; "system" -> ThemeMode.System; else -> ThemeMode.Light }
}
