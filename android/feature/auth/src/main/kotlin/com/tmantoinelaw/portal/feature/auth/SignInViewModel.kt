package com.tmantoinelaw.portal.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tmantoinelaw.portal.core.data.auth.SignInHandoff
import com.tmantoinelaw.portal.core.data.session.MeResult
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the sign-in surface is doing. */
sealed interface SignInUi {
    data class Choose(val error: String? = null) : SignInUi
    /** The browser has the sign-in; `detail` names the provider the person picked. */
    data class Waiting(val provider: String?, val url: String) : SignInUi
    data object Claiming : SignInUi
}

sealed interface SignInEvent {
    data class OpenBrowser(val url: String) : SignInEvent
    data object SignedIn : SignInEvent
    /** A wall after the claim (pending approval, onboarding…): open it, then ask `/me` again. */
    data class FinishInBrowser(val url: String) : SignInEvent
}

@HiltViewModel
class SignInViewModel @Inject constructor(
    private val handoff: SignInHandoff,
    private val session: SessionRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow<SignInUi>(SignInUi.Choose())
    val ui: StateFlow<SignInUi> = _ui.asStateFlow()

    private val _events = MutableSharedFlow<SignInEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<SignInEvent> = _events.asSharedFlow()

    fun start(provider: String?) {
        val url = handoff.startUrl(provider)
        _ui.value = SignInUi.Waiting(provider, url)
        _events.tryEmit(SignInEvent.OpenBrowser(url))
    }

    fun reopen() {
        (_ui.value as? SignInUi.Waiting)?.let { _events.tryEmit(SignInEvent.OpenBrowser(it.url)) }
    }

    fun back() {
        handoff.cancel()
        _ui.value = SignInUi.Choose()
    }

    /** The `tmaportal://auth?token=…` return leg. */
    fun onToken(token: String) {
        _ui.value = SignInUi.Claiming
        viewModelScope.launch {
            when (handoff.claim(token)) {
                SignInHandoff.Claim.Success -> when (val me = session.refreshMe()) {
                    is MeResult.Ok -> _events.tryEmit(SignInEvent.SignedIn)
                    is MeResult.NeedsBrowser -> { _ui.value = SignInUi.Choose(); _events.tryEmit(SignInEvent.FinishInBrowser(me.url)) }
                    MeResult.Offline -> _ui.value = SignInUi.Choose(OFFLINE)
                    MeResult.SignedOut -> _ui.value = SignInUi.Choose(FAILED)
                    is MeResult.Failed -> _ui.value = SignInUi.Choose(me.error.message ?: FAILED)
                }
                SignInHandoff.Claim.Rejected -> _ui.value = SignInUi.Choose(FAILED)
                SignInHandoff.Claim.NoVerifier -> _ui.value = SignInUi.Choose(NOT_STARTED_HERE)
                SignInHandoff.Claim.Offline -> _ui.value = SignInUi.Choose(OFFLINE)
            }
        }
    }

    companion object {
        const val FAILED = "That sign-in could not be completed. Try again."
        const val NOT_STARTED_HERE = "That sign-in could not be completed. Start signing in from this app rather than from the browser, and finish in the tab it opens."
        const val OFFLINE = "The portal could not be reached. Check your connection and try again."
    }
}
