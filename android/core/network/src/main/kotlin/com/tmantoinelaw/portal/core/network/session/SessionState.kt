package com.tmantoinelaw.portal.core.network.session

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What every request needs to know about the session right now: the Reverb
 * socket id to stamp on writes (so `toOthers()` skips this device), and the
 * account the local store is scoped to.
 */
@Singleton
class SessionState @Inject constructor() {
    /** `socket_id` from `pusher:connection_established`; null while disconnected. */
    val socketId = MutableStateFlow<String?>(null)

    /** The signed-in account's id once `/me` has answered (or its cached copy was read). */
    val accountId = MutableStateFlow<Long?>(null)

    /** Learned from the last attempt, not from the connectivity manager alone (a captive portal is "online" and answers nothing). */
    val reachable = MutableStateFlow(true)

    /**
     * Fired when the server answered 401 (or 419 twice), carrying the cookie
     * jar generation the request left with. The session is dead only if the
     * jar still holds that generation; a poll that left before a sign-in
     * claim landed must not wipe the session the claim just stored.
     */
    val unauthorized = MutableSharedFlow<Long>(extraBufferCapacity = 8)
}
