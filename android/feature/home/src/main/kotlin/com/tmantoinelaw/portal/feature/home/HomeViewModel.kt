package com.tmantoinelaw.portal.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tmantoinelaw.portal.core.data.dashboard.DashboardRepository
import com.tmantoinelaw.portal.core.data.dashboard.DashboardState
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.data.prefs.DevicePrefs
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import com.tmantoinelaw.portal.core.network.PortalConfig
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The board's tiles (portal-home.js DASH_TILES), verbatim. */
data class TileSpec(val id: String, val label: String, val desc: String, val cap: String? = null, val staffOnly: Boolean = false, val cipCard: Boolean = false)

object Board {
    val tiles = listOf(
        TileSpec("recentFiles", "Recent Files", "Files you last accessed across all of your devices."),
        TileSpec("email", "Recent Email", "Your latest inbox messages, ready to open.", cap = "mail.use"),
        TileSpec("messages", "Messages", "Your five most recent chats, with unread counts."),
        TileSpec("shortcuts", "Shortcuts", "Frequently used actions, as well as quick access to certain folders."),
        TileSpec("employees", "Employees", "Who is online, and today's work status (office, remote, leave).", staffOnly = true),
        TileSpec("favorites", "Favorites", "Files and folders you marked as favorite."),
        TileSpec("road", "Upcoming Events", "Upcoming events for the selected day."),
        TileSpec("cipStatus", "CIP Applications", "How many applications sit at each stage, and what needs picking up.", cipCard = true),
        TileSpec("requests", "Requests", "Reviews, approvals and signatures waiting on you.", cap = "workflows.view"),
        TileSpec("comments", "Comments", "The latest discussion on files that involve you.", cap = "workflows.view"),
    )
    val defaultOrder = listOf("recentFiles", "email", "cipStatus", "favorites", "road", "shortcuts", "employees", "messages", "requests", "comments")
    val periods = listOf("Today" to "today", "This week" to "week", "This month" to "month", "This year" to "year")
}

data class HomeUi(
    val identity: Identity? = null,
    val board: DashboardState = DashboardState(),
    val order: List<String> = Board.defaultOrder,
    val show: Map<String, Boolean> = emptyMap(),
    val refreshing: Boolean = false,
) {
    fun shown(id: String) = show[id] != false
}

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repository: DashboardRepository,
    private val session: SessionRepository,
    private val prefs: DevicePrefs,
    private val config: PortalConfig,
) : ViewModel() {
    private val refreshing = MutableStateFlow(false)

    val ui: StateFlow<HomeUi> = combine(session.identity, repository.state, refreshing) { identity, board, busy ->
        val order = board.prefs.dashboardLayout.order.ifEmpty { Board.defaultOrder }.filter { id -> Board.tiles.any { it.id == id } }
        HomeUi(
            identity = identity,
            board = board,
            order = order + Board.defaultOrder.filter { it !in order },
            show = board.prefs.dashboardTiles,
            refreshing = busy,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUi())

    init {
        viewModelScope.launch {
            prefs.dashboardPeriod.collect { repository.setPeriod(it) }
        }
        viewModelScope.launch { repository.refreshAll() }
    }

    fun refresh() {
        viewModelScope.launch {
            refreshing.value = true
            repository.refreshAll(force = true)
            refreshing.value = false
        }
    }

    fun setPeriod(period: String) = viewModelScope.launch { prefs.setDashboardPeriod(period) }
    fun setRoadDay(day: String) = repository.setRoadDay(day)
    fun markCommentRead(id: String) = viewModelScope.launch { repository.markCommentRead(id) }

    fun saveLayout(show: Map<String, Boolean>, order: List<String>) = viewModelScope.launch {
        repository.saveLayout(show, order, ui.value.board.prefs.dashboardWorkflowStrip)
    }

    fun absolute(url: String?): String? = url?.let { if (it.startsWith("http")) it else config.url(it) }
}
