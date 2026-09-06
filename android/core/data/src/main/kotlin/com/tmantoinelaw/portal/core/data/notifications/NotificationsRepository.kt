package com.tmantoinelaw.portal.core.data.notifications

import com.tmantoinelaw.portal.core.data.realtime.RealtimeCoordinator
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import com.tmantoinelaw.portal.core.data.store.SnapshotStore
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import com.tmantoinelaw.portal.core.network.api.PortalJson
import com.tmantoinelaw.portal.core.network.realtime.RealtimeState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The notification store (public/js/notify-store.js, prompt §11.14): the list
 * and the badge, `notification.created` prepended and the badge set to the
 * absolute `unread`, `/count` as the badge's source of truth, reconciled on
 * every reconnect and foreground, polled every 60 s only while the socket is
 * not healthy. The last page is remembered for the warm boot.
 */
@Singleton
class NotificationsRepository @Inject constructor(
    private val http: PortalHttp,
    private val realtime: RealtimeCoordinator,
    private val session: SessionRepository,
    private val snapshots: SnapshotStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _items = MutableStateFlow<List<NotificationDto>>(emptyList())
    val items: StateFlow<List<NotificationDto>> = _items.asStateFlow()

    private val _unread = MutableStateFlow(0)
    val unread: StateFlow<Int> = _unread.asStateFlow()

    private val _actionRequired = MutableStateFlow(0)
    val actionRequired: StateFlow<Int> = _actionRequired.asStateFlow()

    private val _nextCursor = MutableStateFlow<Long?>(null)
    val hasMore: Boolean get() = _nextCursor.value != null

    private val _loaded = MutableStateFlow(false)
    /** True once the server has answered (the web's `real`), never merely "something finished". */
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    private val _created = MutableSharedFlow<NotificationDto>(extraBufferCapacity = 16)
    /** A notification that just arrived over the socket: toast it, and raise an OS notification when backgrounded. */
    val created: SharedFlow<NotificationDto> = _created.asSharedFlow()

    init {
        realtime.events.filter { it.event == "notification.created" }.onEach { event ->
            val obj = event.obj ?: return@onEach
            val dto = runCatching { PortalJson.decodeFromJsonElement(NotificationDto.serializer(), obj.getValue("notification")) }.getOrNull() ?: return@onEach
            _items.value = listOf(dto) + _items.value.filter { it.id != dto.id }
            event.long("unread")?.let { _unread.value = it.toInt() }
            _created.tryEmit(dto)
            persist()
        }.launchIn(scope)
        realtime.connected.onEach { catchUp() }.launchIn(scope)
        session.identity.onEach { identity -> if (identity == null) forget() else hydrate() }.launchIn(scope)
        session.signedOut.onEach { forget() }.launchIn(scope)
        scope.launch {
            // The poll fallback: the count every 60 s, only while the socket is not connected.
            while (isActive) {
                delay(60_000)
                if (session.identity.value != null && realtime.state.value != RealtimeState.Connected) refreshCount()
            }
        }
    }

    private suspend fun hydrate() {
        snapshots.read(SNAPSHOT, NotificationsPage.serializer())?.let { page ->
            if (_items.value.isEmpty()) { _items.value = page.items; _unread.value = page.unread }
        }
        catchUp()
    }

    /** Fresh count and first page; the caller's list keeps scrolling from `loadMore`. */
    suspend fun catchUp() {
        if (session.identity.value == null) return
        refreshCount()
        runCatching { loadFirstPage() }
    }

    suspend fun refreshCount() {
        runCatching {
            val c = http.get("/portal/notifications/count", NotificationCounts.serializer())
            _unread.value = c.unread
            _actionRequired.value = c.actionRequired
        }
    }

    suspend fun loadFirstPage(unreadOnly: Boolean = false, actionRequired: Boolean = false): Result<Unit> = runCatching {
        val page = http.get(query(null, unreadOnly, actionRequired), NotificationsPage.serializer())
        _items.value = page.items
        _nextCursor.value = page.nextCursor
        _unread.value = page.unread
        _loaded.value = true
        if (!unreadOnly && !actionRequired) persist()
    }

    suspend fun loadMore(unreadOnly: Boolean = false, actionRequired: Boolean = false): Result<Unit> = runCatching {
        val cursor = _nextCursor.value ?: return@runCatching
        val page = http.get(query(cursor, unreadOnly, actionRequired), NotificationsPage.serializer())
        _items.value = _items.value + page.items.filter { n -> _items.value.none { it.id == n.id } }
        _nextCursor.value = page.nextCursor
        _unread.value = page.unread
    }

    private fun query(cursor: Long?, unreadOnly: Boolean, actionRequired: Boolean): String = buildString {
        append("/portal/notifications?limit=30")
        if (cursor != null) append("&cursor=").append(cursor)
        if (unreadOnly) append("&unread=1")
        if (actionRequired) append("&actionRequired=1")
    }

    suspend fun markRead(id: String) = act("/portal/notifications/$id/read") { it.copy(read = true) }
    suspend fun markUnread(id: String) = act("/portal/notifications/$id/unread") { it.copy(read = false) }
    suspend fun complete(id: String) = act("/portal/notifications/$id/complete") { it.copy(completed = true, read = true) }

    suspend fun readAll(): Result<Unit> = runCatching {
        _items.value = _items.value.map { it.copy(read = true) }
        val answer = http.post("/portal/notifications/read-all", null, UnreadAnswer.serializer())
        _unread.value = answer.unread
        persist()
    }

    suspend fun delete(id: String): Result<Unit> = runCatching {
        val before = _items.value
        _items.value = before.filter { it.id != id }
        try {
            val answer = http.delete("/portal/notifications/$id", null, UnreadAnswer.serializer())
            _unread.value = answer.unread
            persist()
        } catch (e: IOException) {
            _items.value = before
            throw e
        }
    }

    /** Optimistic, then the server's absolute `unread` wins. */
    private suspend fun act(path: String, patch: (NotificationDto) -> NotificationDto): Result<Unit> = runCatching {
        val before = _items.value
        _items.value = before.map { if (path.contains("/${it.id}/")) patch(it) else it }
        try {
            val answer = http.post(path, null, NotificationItemAnswer.serializer())
            _unread.value = answer.unread
            answer.item?.let { fresh -> _items.value = _items.value.map { if (it.id == fresh.id) fresh else it } }
            persist()
        } catch (e: IOException) {
            _items.value = before
            throw e
        }
    }

    private suspend fun persist() {
        snapshots.write(SNAPSHOT, NotificationsPage(_items.value.take(50), _nextCursor.value, _unread.value), NotificationsPage.serializer())
    }

    private fun forget() {
        _items.value = emptyList(); _unread.value = 0; _actionRequired.value = 0; _nextCursor.value = null; _loaded.value = false
    }

    private companion object { const val SNAPSHOT = "notifications:first" }
}
