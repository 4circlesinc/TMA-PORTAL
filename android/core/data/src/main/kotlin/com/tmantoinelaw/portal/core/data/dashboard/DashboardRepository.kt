package com.tmantoinelaw.portal.core.data.dashboard

import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.data.realtime.RealtimeCoordinator
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import com.tmantoinelaw.portal.core.data.store.SnapshotStore
import com.tmantoinelaw.portal.core.network.api.PortalException
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.JsonElement
import java.io.IOException
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

/**
 * One tile's answer, and whether the SERVER gave it (the web's `homeReal`):
 * a dead network marks a tile loaded-empty so its skeleton comes down, but a
 * snapshot is only replaced by a real answer, never by a failure.
 */
@Serializable
data class Tile<T>(val data: T? = null, val real: Boolean = false, val loadedAt: Long = 0) {
    val loaded get() = data != null || loadedAt > 0
}

/** What the board knows right now. Every field hydrates from its `home:*` snapshot before the network answers. */
data class DashboardState(
    val metrics: Tile<MetricsDto> = Tile(),
    val recent: Tile<List<FileRowDto>> = Tile(),
    val favorites: Tile<List<FileRowDto>> = Tile(),
    val staff: Tile<StaffDto> = Tile(),
    val email: Tile<EmailTile> = Tile(),
    val chats: Tile<List<ConversationRowDto>> = Tile(),
    val cip: Tile<CipDashboardDto> = Tile(),
    val work: Tile<WorkDto> = Tile(),
    val road: Tile<List<CalendarEventRowDto>> = Tile(),
    val roadDay: String = LocalDate.now().toString(),
    val prefs: BoardPrefsDto = BoardPrefsDto(),
    val period: String = "today",
)

@Serializable
data class EmailTile(val connected: Boolean = true, val messages: List<MailRowDto> = emptyList())

@Singleton
class DashboardRepository @Inject constructor(
    private val http: PortalHttp,
    private val snapshots: SnapshotStore,
    private val session: SessionRepository,
    private val realtime: RealtimeCoordinator,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow(DashboardState())
    val state: StateFlow<DashboardState> = _state.asStateFlow()

    /** Revalidation windows (portal-home.js:303-310). */
    private object Fresh {
        const val FILES = 60_000L; const val METRICS = 300_000L; const val PRESENCE = 20_000L
        const val CIP = 30_000L; const val WORK = 60_000L; const val EMAIL = 30_000L; const val CHATS = 60_000L
    }

    init {
        session.identity.onEach { if (it == null) _state.value = DashboardState() else hydrate() }.launchIn(scope)
        realtime.dataChanged.onEach { resource ->
            when (resource) {
                "files" -> refreshFiles(force = true)
                "cip" -> refreshCip(force = true)
                "workflows", "activity" -> refreshWork(force = true)
                "users" -> refreshStaff(force = true)
                "calendar" -> refreshRoad(force = true)
                "signatures" -> refreshMetrics(force = true)
            }
        }.launchIn(scope)
        realtime.events.filter { it.event == "presence.status" || it.event == "messaging.presence" }.onEach { refreshStaff(force = true) }.launchIn(scope)
        realtime.events.filter { it.event == "message.sent" || it.event == "messaging.inbox" }.onEach { refreshChats(force = true) }.launchIn(scope)
        realtime.events.filter { it.event == "notification.created" && it.string("module") == "email" }.onEach { refreshEmail(force = true) }.launchIn(scope)
        realtime.connected.onEach { refreshAll(force = true) }.launchIn(scope)
    }

    private suspend fun hydrate() {
        val s = _state.value
        _state.value = s.copy(
            metrics = snapshots.read("home:metrics", Tile.serializer(MetricsDto.serializer())) ?: s.metrics,
            recent = snapshots.read("home:files", Tile.serializer(listSer(FileRowDto.serializer()))) ?: s.recent,
            favorites = snapshots.read("home:favorites", Tile.serializer(listSer(FileRowDto.serializer()))) ?: s.favorites,
            staff = snapshots.read("home:staff", Tile.serializer(StaffDto.serializer())) ?: s.staff,
            email = snapshots.read("home:email", Tile.serializer(EmailTile.serializer())) ?: s.email,
            chats = snapshots.read("home:chats", Tile.serializer(listSer(ConversationRowDto.serializer()))) ?: s.chats,
            cip = snapshots.read("home:cip", Tile.serializer(CipDashboardDto.serializer())) ?: s.cip,
            work = snapshots.read("home:work", Tile.serializer(WorkDto.serializer())) ?: s.work,
            road = snapshots.read("home:road:${s.roadDay}", Tile.serializer(listSer(CalendarEventRowDto.serializer()))) ?: s.road,
            prefs = snapshots.read("home:layout", BoardPrefsDto.serializer()) ?: s.prefs,
        )
    }

    private fun <T> listSer(inner: KSerializer<T>) = kotlinx.serialization.builtins.ListSerializer(inner)

    fun setPeriod(period: String) {
        if (_state.value.period == period) return
        _state.update { it.copy(period = period, metrics = it.metrics.copy(loadedAt = 0)) }
        scope.launch { refreshMetrics(force = true) }
    }

    fun setRoadDay(day: String) {
        _state.update { it.copy(roadDay = day, road = Tile()) }
        scope.launch {
            snapshots.read("home:road:$day", Tile.serializer(listSer(CalendarEventRowDto.serializer())))?.let { snap -> _state.update { it.copy(road = snap) } }
            refreshRoad(force = true)
        }
    }

    /** Every loader, in parallel, each within its own freshness window unless forced. */
    suspend fun refreshAll(force: Boolean = false) {
        val identity = session.identity.value ?: return
        coroutineScope {
            listOf(
                async { refreshMetrics(force) }, async { refreshFiles(force) }, async { refreshStaff(force) },
                async { if (identity.can("mail.use")) refreshEmail(force) }, async { refreshChats(force) },
                async { refreshCip(force) }, async { if (identity.can("workflows.view")) refreshWork(force) },
                async { refreshRoad(force) }, async { refreshPrefs() },
            ).forEach { it.await() }
        }
    }

    private fun stale(at: Long, within: Long) = System.currentTimeMillis() - at > within

    suspend fun refreshMetrics(force: Boolean = false) {
        if (!force && !stale(_state.value.metrics.loadedAt, Fresh.METRICS)) return
        load("home:metrics", MetricsDto.serializer(), { http.get("/portal/dashboard/metrics?period=${_state.value.period}", MetricsDto.serializer()) }) { s, t -> s.copy(metrics = t) }
    }

    suspend fun refreshFiles(force: Boolean = false) {
        if (!force && !stale(_state.value.recent.loadedAt, Fresh.FILES)) return
        load("home:files", listSer(FileRowDto.serializer()), {
            val listing = http.get("/portal/files?section=recent&perPage=40&lean=1", FilesListingDto.serializer())
            (listing.folders + listing.files).sortedByDescending { it.updatedAt ?: it.modifiedAt ?: "" }.take(6)
        }) { s, t -> s.copy(recent = t) }
        load("home:favorites", listSer(FileRowDto.serializer()), {
            val listing = http.get("/portal/files?section=favorites&perPage=8&lean=1", FilesListingDto.serializer())
            listing.folders + listing.files
        }) { s, t -> s.copy(favorites = t) }
    }

    suspend fun refreshStaff(force: Boolean = false) {
        if (!force && !stale(_state.value.staff.loadedAt, Fresh.PRESENCE)) return
        load("home:staff", StaffDto.serializer(), { http.get("/portal/dashboard/staff", StaffDto.serializer()) }) { s, t -> s.copy(staff = t) }
    }

    suspend fun refreshEmail(force: Boolean = false) {
        if (!force && !stale(_state.value.email.loadedAt, Fresh.EMAIL)) return
        if (_state.value.email.data?.connected == false && !force) return
        load("home:email", EmailTile.serializer(), {
            val index = http.get("/portal/mail", MailIndexDto.serializer())
            if (!index.connected) EmailTile(connected = false)
            else EmailTile(connected = true, messages = http.get("/portal/mail/messages?folder=inbox&perPage=25&page=1", MailMessagesDto.serializer()).messages.take(8))
        }) { s, t -> s.copy(email = t) }
    }

    suspend fun refreshChats(force: Boolean = false) {
        if (!force && !stale(_state.value.chats.loadedAt, Fresh.CHATS)) return
        load("home:chats", listSer(ConversationRowDto.serializer()), {
            http.get("/portal/messaging/conversations", ConversationsDto.serializer()).conversations.filter { !it.archived }.take(5)
        }) { s, t -> s.copy(chats = t) }
    }

    suspend fun refreshCip(force: Boolean = false) {
        if (!force && !stale(_state.value.cip.loadedAt, Fresh.CIP)) return
        load("home:cip", CipDashboardDto.serializer(), { http.get("/portal/cip/dashboard", CipDashboardDto.serializer()) }) { s, t -> s.copy(cip = t) }
    }

    suspend fun refreshWork(force: Boolean = false) {
        if (!force && !stale(_state.value.work.loadedAt, Fresh.WORK)) return
        load("home:work", WorkDto.serializer(), { http.get("/portal/dashboard/work?want=requests,comments", WorkDto.serializer()) }) { s, t -> s.copy(work = t) }
    }

    suspend fun refreshRoad(force: Boolean = false) {
        val day = _state.value.roadDay
        if (!force && !stale(_state.value.road.loadedAt, Fresh.FILES)) return
        load("home:road:$day", listSer(CalendarEventRowDto.serializer()), {
            val next = LocalDate.parse(day).plusDays(1).toString()
            http.get("/portal/calendar/events?from=$day&to=$next", CalendarEventsDto.serializer()).events.sortedBy { it.startsAt }.take(8)
        }) { s, t -> if (s.roadDay == day) s.copy(road = t) else s }
    }

    suspend fun refreshPrefs() {
        runCatching { http.get("/me/preferences", BoardPrefsDto.serializer()) }.onSuccess { prefs ->
            _state.update { it.copy(prefs = prefs) }
            snapshots.write("home:layout", prefs, BoardPrefsDto.serializer())
        }
    }

    /** Edit Dashboard: the visibility map, the order, and the strip flag go to `/me/preferences` together (portal-home.js layoutPayload). */
    suspend fun saveLayout(tiles: Map<String, Boolean>, order: List<String>, workflowStrip: Boolean) {
        val prefs = BoardPrefsDto(tiles, DashboardLayoutDto(order), workflowStrip)
        _state.update { it.copy(prefs = prefs) }
        snapshots.write("home:layout", prefs, BoardPrefsDto.serializer())
        val body: JsonObject = buildJsonObject {
            putJsonObject("dashboardTiles") { tiles.forEach { (k, v) -> put(k, v) } }
            putJsonObject("dashboardLayout") { putJsonArray("order") { order.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } } }
            put("dashboardWorkflowStrip", workflowStrip)
        }
        runCatching { http.put("/me/preferences", body, JsonElement.serializer()) }
    }

    /** Marks a comment thread read (the Workflows page's own endpoint), so the tile row settles. */
    suspend fun markCommentRead(commentId: String) {
        runCatching { http.post("/portal/files/workflows/comments/$commentId/read", null, JsonElement.serializer()) }
        _state.update { s ->
            val w = s.work.data ?: return@update s
            s.copy(work = s.work.copy(data = w.copy(comments = w.comments.map { if (it.id == commentId) it.copy(unread = false) else it })))
        }
    }

    /**
     * The one loader shape: a real answer replaces the tile and is kept warm;
     * a failure marks the tile loaded (the skeleton comes down) and leaves
     * whatever it showed. A 403/404 answers "not for this account" (an empty
     * real tile), so a client never sees a staff card shimmer forever.
     */
    private suspend fun <T> load(key: String, serializer: KSerializer<T>, fetch: suspend () -> T, apply: (DashboardState, Tile<T>) -> DashboardState) {
        val tile: Tile<T> = try {
            Tile(data = fetch(), real = true, loadedAt = System.currentTimeMillis())
        } catch (e: PortalException) {
            if (e.status == 403 || e.status == 404) Tile(data = null, real = true, loadedAt = System.currentTimeMillis())
            else Tile(data = current(key), real = false, loadedAt = System.currentTimeMillis())
        } catch (e: IOException) {
            Tile(data = current(key), real = false, loadedAt = System.currentTimeMillis())
        }
        _state.update { apply(it, tile) }
        if (tile.real) snapshots.write(key, tile, Tile.serializer(serializer))
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> current(key: String): T? = with(_state.value) {
        when (key) {
            "home:metrics" -> metrics.data; "home:files" -> recent.data; "home:favorites" -> favorites.data; "home:staff" -> staff.data
            "home:email" -> email.data; "home:chats" -> chats.data; "home:cip" -> cip.data; "home:work" -> work.data
            else -> if (key.startsWith("home:road")) road.data else null
        } as T?
    }
}
