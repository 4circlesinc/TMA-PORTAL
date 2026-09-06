package com.tmantoinelaw.portal.core.data.realtime

import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import com.tmantoinelaw.portal.core.network.realtime.RealtimeClient
import com.tmantoinelaw.portal.core.network.realtime.RealtimeEndpoint
import com.tmantoinelaw.portal.core.network.realtime.RealtimeEvent
import com.tmantoinelaw.portal.core.network.realtime.RealtimeState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Wires the socket to the account (prompt §10): configures it from `/me`,
 * holds the always-on channels, turns `data.changed` into a per-resource
 * signal debounced 300 ms (portal-live.js), and lets screens borrow channels
 * while they are open.
 */
@Singleton
class RealtimeCoordinator @Inject constructor(
    private val client: RealtimeClient,
    private val session: SessionRepository,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val state: StateFlow<RealtimeState> get() = client.state
    val events: SharedFlow<RealtimeEvent> get() = client.events
    /** Every Disconnected→Connected transition: refetch what you show. */
    val connected: SharedFlow<Unit> get() = client.connected

    private val _dataChanged = MutableSharedFlow<String>(extraBufferCapacity = 64)
    /** A resource name from `PortalDataChanged` (`files, clients, users, …, identity`), coalesced. */
    val dataChanged: SharedFlow<String> = _dataChanged.asSharedFlow()

    private val pending = HashMap<String, Job>()
    private var current: Identity? = null

    init {
        session.identity.onEach { identity -> apply(identity) }.launchIn(scope)
        session.signedOut.onEach { client.disconnect() }.launchIn(scope)
        client.events.filter { it.event == "data.changed" }.onEach { event ->
            val resource = event.string("resource") ?: return@onEach
            synchronized(pending) {
                pending[resource]?.cancel()
                pending[resource] = scope.launch {
                    delay(300)
                    synchronized(pending) { pending.remove(resource) }
                    _dataChanged.tryEmit(resource)
                }
            }
        }.launchIn(scope)
    }

    private fun apply(identity: Identity?) {
        val previous = current
        current = identity
        if (identity == null) { client.disconnect(); return }
        val rt = identity.realtime
        val endpoint = if (rt.enabled && rt.key != null && rt.host != null) RealtimeEndpoint(rt.key, rt.host, rt.port, rt.scheme == "https") else null
        if (previous != null && previous.id != identity.id) {
            listOf(userChannel(previous), inboxChannel(previous), STAFF).forEach { client.unsubscribe(it) }
        }
        client.subscribe(userChannel(identity))
        client.subscribe(inboxChannel(identity))
        if (identity.isStaff) client.subscribe(STAFF) else client.unsubscribe(STAFF)
        client.configure(endpoint)
    }

    fun setForeground(inFront: Boolean) = client.setForeground(inFront)

    /** Borrow a channel while a screen is open; release it on exit. */
    fun subscribe(channel: String) = client.subscribe(channel)
    fun unsubscribe(channel: String) = client.unsubscribe(channel)

    companion object {
        const val STAFF = "private-portal.staff"
        fun userChannel(identity: Identity) = "private-App.Models.User.${identity.id}"
        fun inboxChannel(identity: Identity) = "private-messaging.user.${identity.id}"
        fun conversation(uuid: String) = "private-conversation.$uuid"
        fun file(uuid: String) = "private-file.$uuid"
        fun feedChannel(uuid: String) = "private-feed.channel.$uuid"
        fun cipApplication(uuid: String) = "private-cip.application.$uuid"
    }
}
