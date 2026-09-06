package com.tmantoinelaw.portal.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.tmantoinelaw.portal.core.common.time.TimeLabels
import com.tmantoinelaw.portal.core.data.dashboard.CalendarEventRowDto
import com.tmantoinelaw.portal.core.data.dashboard.DashboardRepository
import com.tmantoinelaw.portal.core.data.dashboard.FileRowDto
import com.tmantoinelaw.portal.core.data.dashboard.MetricsDto
import com.tmantoinelaw.portal.core.data.dashboard.Tile
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.data.overview.OverviewRepository
import com.tmantoinelaw.portal.core.data.overview.OverviewState
import com.tmantoinelaw.portal.core.data.overview.SignInDto
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.navigation.ActivityRoute
import com.tmantoinelaw.portal.core.navigation.CalendarRoute
import com.tmantoinelaw.portal.core.navigation.FilesRoute
import com.tmantoinelaw.portal.core.navigation.NotificationsRoute
import com.tmantoinelaw.portal.core.navigation.PeopleRoute
import com.tmantoinelaw.portal.core.navigation.Route
import com.tmantoinelaw.portal.core.navigation.SettingsRoute
import com.tmantoinelaw.portal.core.navigation.UsersRoute
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.SectionError
import com.tmantoinelaw.portal.core.ui.components.SkeletonFileRow
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.feature.shell.PortalAvatar
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

data class OverviewUi(
    val identity: Identity? = null,
    val overview: OverviewState = OverviewState(),
    val road: Tile<List<CalendarEventRowDto>> = Tile(),
    val roadDay: String = "",
    val refreshing: Boolean = false,
)

@HiltViewModel
class OverviewViewModel @Inject constructor(
    private val repository: OverviewRepository,
    private val dashboard: DashboardRepository,
    session: SessionRepository,
    private val config: PortalConfig,
) : ViewModel() {
    private val refreshing = MutableStateFlow(false)
    val ui: StateFlow<OverviewUi> = combine(session.identity, repository.state, dashboard.state, refreshing) { id, o, d, busy ->
        OverviewUi(id, o, d.road, d.roadDay, busy)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), OverviewUi())

    init { viewModelScope.launch { repository.refreshAll(); dashboard.refreshRoad() } }

    fun refresh() = viewModelScope.launch { refreshing.value = true; repository.refreshAll(); dashboard.refreshRoad(force = true); refreshing.value = false }
    fun setRoadDay(day: String) = dashboard.setRoadDay(day)
    fun absolute(url: String?): String? = url?.let { if (it.startsWith("http")) it else config.url(it) }
}

/**
 * Overview (public/js/overview.js): the tab row, your profile cards, the
 * workspace metrics, the road, the latest files and the recent sign-ins. The
 * other tabs are their own modules' screens.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OverviewScreen(go: (Route) -> Unit, openFile: (String, String?) -> Unit, viewModel: OverviewViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val me = ui.identity ?: return
    val day = ui.roadDay.ifEmpty { LocalDate.now().toString() }
    PullToRefreshBox(isRefreshing = ui.refreshing, onRefresh = { viewModel.refresh() }, modifier = Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val twoUp = maxWidth >= 840.dp
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tma.space.s20), verticalArrangement = Arrangement.spacedBy(Tma.space.s20)) {
                OverviewTabs(me, go)
                val left: @Composable () -> Unit = {
                    ProfileHeader(me, viewModel::absolute)
                    ProfileDetails(me, go)
                    MetricsHero(ui.overview.metrics)
                }
                val right: @Composable () -> Unit = {
                    RoadTile(ui.road, day, onDay = viewModel::setRoadDay, onOpen = { go(CalendarRoute) })
                    LatestFiles(ui.overview.files, viewModel::absolute, openFile) { go(FilesRoute("recent")) }
                    if (!me.isProviderContact) SignIns(ui.overview.signIns, viewModel::absolute, onSeeAll = { go(ActivityRoute) }, onRetry = { viewModel.refresh() })
                }
                if (twoUp) {
                    Row(horizontalArrangement = Arrangement.spacedBy(Tma.space.s20)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tma.space.s20)) { left() }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tma.space.s20)) { right() }
                    }
                } else {
                    left(); right()
                }
            }
        }
    }
}

/** BASE_TABS / ADMIN_TABS (overview.js:27-28); every tab but Overview is another module's screen. */
@Composable
private fun OverviewTabs(me: Identity, go: (Route) -> Unit) {
    val tabs: List<Pair<String, Route?>> = if (me.isAdmin) listOf(
        "Overview" to null, "Employees" to PeopleRoute("employees"), "Users" to UsersRoute(), "Files" to FilesRoute("recent"),
        "Notifications" to NotificationsRoute, "Activity" to ActivityRoute, "Recycle Bin" to FilesRoute("recycle"),
    ) else listOf("Overview" to null, "Files" to FilesRoute("recent"), "Notifications" to NotificationsRoute, "Activity" to ActivityRoute)
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Tma.space.s16)) {
        tabs.forEach { (label, route) ->
            val active = route == null
            Column(Modifier.clickable(enabled = route != null) { route?.let(go) }) {
                Text(label, style = Tma.type.text14, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal, color = if (active) Tma.colors.ink else Tma.colors.inkSecondary, modifier = Modifier.padding(vertical = 6.dp))
                Box(Modifier.height(2.dp).fillMaxWidth().background(if (active) Tma.colors.primary else Color.Transparent))
            }
        }
    }
}

@Composable
private fun ProfileHeader(me: Identity, resolve: (String?) -> String?) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.panel).padding(Tma.space.s16), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(me.name, style = Tma.type.text18sb, color = Tma.colors.ink)
            me.jobTitle?.takeIf { it.isNotBlank() }?.let { Meta(R.drawable.ic_user_list, it) }
            Meta(R.drawable.ic_envelope_simple, me.email)
        }
        PortalAvatar(url = resolve(me.avatar), name = me.name, size = 40.dp)
    }
}

@Composable
private fun Meta(icon: Int, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(painterResource(icon), contentDescription = null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(16.dp))
        Text(text, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Profile Details (account.js profileDetailsFor): Company, Contact Phone, Email, Job title, LinkedIn. */
@Composable
private fun ProfileDetails(me: Identity, go: (Route) -> Unit) {
    TilePanel(title = "Profile Details") {
        Row(Modifier.fillMaxWidth()) { Spacer(Modifier.weight(1f)); Text("Edit Profile", style = Tma.type.text14sb, color = Tma.colors.link, modifier = Modifier.clickable { go(SettingsRoute("profile")) }) }
        val linkedin = me.linkedin?.removePrefix("https://")?.removePrefix("http://")?.removePrefix("www.")?.trimEnd('/')
        listOf(
            "Company" to (me.company ?: "-"), "Contact Phone" to (me.phone ?: "-"), "Email" to me.email,
            "Job title" to (me.jobTitle ?: "-"), "LinkedIn" to (linkedin ?: "-"),
        ).forEach { (label, value) ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Text(label, style = Tma.type.text14, color = Tma.colors.inkSecondary, modifier = Modifier.width(120.dp))
                Text(value, style = Tma.type.text14, color = if (label == "LinkedIn" && value != "-") Tma.colors.link else Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Workspace metrics (overview.js renderHero): the staff or provider row without a period; "No data yet" otherwise. */
@Composable
private fun MetricsHero(tile: Tile<MetricsDto>) {
    val m = tile.data
    TilePanel(title = "Workspace metrics") {
        if (!tile.loaded) { repeat(2) { SkeletonFileRow() }; return@TilePanel }
        if (m == null || (!m.staff && !m.provider)) {
            Text("No data yet", style = Tma.type.text18sb, color = Tma.colors.ink)
            Text("Metrics appear for staff accounts once activity is recorded.", style = Tma.type.text12, color = Tma.colors.inkSecondary)
            return@TilePanel
        }
        val pairs = if (m.provider) listOf("cipActive" to "Active CIP applications", "cipUpdatesRequired" to "CIP updates required", "unreadMessages" to "Unread messages", "openComments" to "Open comments")
        else listOf("clientResponse" to "Client response", "cipNew" to "New CIP applications", "cipUpdatesRequired" to "CIP updates required", "awaitingSignature" to "Awaiting signature")
        pairs.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Tma.space.s16)) {
                row.forEach { (key, label) ->
                    val c = m.cards[key]
                    Column(Modifier.weight(1f)) {
                        Text(label, style = Tma.type.text12, color = Tma.colors.inkSecondary)
                        Text(c?.value ?: "-", style = Tma.type.text24sb, color = Tma.colors.ink)
                        c?.delta?.takeIf { it.isNotBlank() }?.let { Text(it, style = Tma.type.text12, color = Tma.colors.inkSecondary) }
                    }
                }
            }
        }
    }
}

/** Latest Files (overview.js renderFiles): six recent files with "size · when · uploader". */
@Composable
private fun LatestFiles(tile: Tile<List<FileRowDto>>, resolve: (String?) -> String?, openFile: (String, String?) -> Unit, viewAll: () -> Unit) {
    TilePanel(title = "Latest Files") {
        Row(Modifier.fillMaxWidth()) { Spacer(Modifier.weight(1f)); Text("View all files", style = Tma.type.text14sb, color = Tma.colors.link, modifier = Modifier.clickable(onClick = viewAll)) }
        val files = tile.data
        when {
            files == null && !tile.loaded -> repeat(3) { SkeletonFileRow() }
            files.isNullOrEmpty() -> PanelNote("No files yet.")
            else -> files.forEach { f ->
                val uploader = f.uploadedBy?.name ?: f.owner?.name
                val when_ = TimeLabels.clockOrDate(f.modifiedAt ?: f.uploadedAt ?: f.updatedAt ?: f.createdAt)
                val meta = listOfNotNull(f.sizeLabel, when_.ifEmpty { null }, uploader).joinToString(" · ").ifEmpty { "Recent file" }
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r8)).clickable { openFile(f.id, f.folder?.id) }.padding(vertical = 6.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
                    FileGlyph(f, 28.dp)
                    Column(Modifier.weight(1f)) {
                        Text(f.name, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(meta, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (uploader != null) PortalAvatar(url = resolve(f.uploadedBy?.avatar ?: f.owner?.avatar), name = uploader, size = 24.dp)
                }
            }
        }
    }
}

/** Recent sign-ins (overview.js renderSignIns), the shared activity row. */
@Composable
private fun SignIns(tile: Tile<List<SignInDto>>, resolve: (String?) -> String?, onSeeAll: () -> Unit, onRetry: () -> Unit) {
    TilePanel(title = "Recent sign-ins") {
        Row(Modifier.fillMaxWidth()) { Spacer(Modifier.weight(1f)); Text("See all activity", style = Tma.type.text14sb, color = Tma.colors.link, modifier = Modifier.clickable(onClick = onSeeAll)) }
        val items = tile.data
        when {
            items == null && !tile.loaded -> repeat(4) { SkeletonFileRow(avatar = true) }
            items == null && !tile.real -> SectionError(onRetry = onRetry, message = "Could not load sign-ins.")
            items.isNullOrEmpty() -> PanelNote("No sign-ins recorded yet.")
            else -> items.forEach { item ->
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
                    PortalAvatar(url = resolve(item.actor?.avatar), name = item.actor?.name ?: "?", size = 32.dp)
                    Column(Modifier.weight(1f)) {
                        Text(item.description, style = Tma.type.text14, color = if (item.status == "failure") Tma.colors.danger else Tma.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(TimeLabels.relative(item.createdAt), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                    }
                }
            }
        }
    }
}
