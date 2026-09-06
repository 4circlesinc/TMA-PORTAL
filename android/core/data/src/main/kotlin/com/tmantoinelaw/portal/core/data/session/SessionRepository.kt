package com.tmantoinelaw.portal.core.data.session

import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.data.identity.IdentityStore
import com.tmantoinelaw.portal.core.data.identity.toIdentity
import com.tmantoinelaw.portal.core.network.api.MeDto
import com.tmantoinelaw.portal.core.network.api.PortalException
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import com.tmantoinelaw.portal.core.network.api.PortalJson
import com.tmantoinelaw.portal.core.network.cookies.PersistentCookieJar
import com.tmantoinelaw.portal.core.network.session.SessionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** What asking the server who we are came back with. */
sealed interface MeResult {
    data class Ok(val identity: Identity) : MeResult
    /** 401/419: the session died behind the cookie. Cache and cookies are gone. */
    data object SignedOut : MeResult
    /** A wall (pending approval, onboarding, verification, MFA policy): finish it in a Custom Tab, then ask again. */
    data class NeedsBrowser(val url: String) : MeResult
    /** No answer at all. The cached identity, if any, stands. */
    data object Offline : MeResult
    data class Failed(val error: Throwable) : MeResult
}

@Singleton
class SessionRepository @Inject constructor(
    private val http: PortalHttp,
    private val jar: PersistentCookieJar,
    private val store: IdentityStore,
    private val state: SessionState,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val refreshing = Mutex()

    /** The remembered account, painted before the network answers. Null = nobody is signed in on this device. */
    val identity: StateFlow<Identity?> = store.identity.stateIn(scope, SharingStarted.Eagerly, null)

    private val _signedOut = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    /** Fires whenever the session is found dead: the app returns to sign-in. */
    val signedOut: SharedFlow<Unit> = _signedOut

    init {
        identity.onEach { state.accountId.value = it?.id }.launchIn(scope)
        state.unauthorized.onEach { generation -> if (generation == jar.generation) forget() }.launchIn(scope)
    }

    /** True when the cookie jar holds anything that could be a session. Nobody has one on a fresh install. */
    fun hasCookies(): Boolean = jar.hasSession(http.config.origin.toHttpUrl())

    /** One `/me` in flight at a time, like the web (current-user.js). */
    suspend fun refreshMe(): MeResult = refreshing.withLock {
        try {
            http.raw(http.request("/me").get().build()) {
                when {
                    it.isSuccessful -> {
                        val raw = it.body.string()
                        val dto = PortalJson.decodeFromString(MeDto.serializer(), raw)
                        store.save(raw)
                        MeResult.Ok(dto.toIdentity())
                    }
                    it.code == 401 || it.code == 419 -> { forget(); MeResult.SignedOut }
                    it.code == 302 -> {
                        val location = it.header("Location")
                        if (location == null) MeResult.Failed(PortalException.from(it)) else {
                            val url = if (location.startsWith("http")) location else http.config.url(location)
                            if (url.contains("/auth/login")) { forget(); MeResult.SignedOut } else MeResult.NeedsBrowser(url)
                        }
                    }
                    it.code == 403 -> {
                        val error = PortalException.from(it)
                        error.redirect?.let { r -> MeResult.NeedsBrowser(if (r.startsWith("http")) r else http.config.url(r)) }
                            ?: MeResult.Failed(error)
                    }
                    else -> MeResult.Failed(PortalException.from(it))
                }
            }
        } catch (e: IOException) {
            MeResult.Offline
        }
    }

    /** `POST /auth/logout` (204), then everything the account left on this device except the write queue. */
    suspend fun signOut() {
        runCatching {
            http.raw(http.request("/auth/logout").post(okhttp3.RequestBody.EMPTY).build()) { }
        }
        forget()
    }

    private suspend fun forget() {
        jar.clear()
        store.clear()
        state.socketId.value = null
        _signedOut.tryEmit(Unit)
    }

    suspend fun current(): Identity? = identity.value ?: store.identity.first()
}
