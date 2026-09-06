package com.tmantoinelaw.portal.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tmantoinelaw.portal.core.data.dashboard.KpiCardDto
import com.tmantoinelaw.portal.core.data.dashboard.MetricsDto
import com.tmantoinelaw.portal.core.data.dashboard.Tile
import com.tmantoinelaw.portal.core.navigation.CalendarRoute
import com.tmantoinelaw.portal.core.navigation.ClientsRoute
import com.tmantoinelaw.portal.core.navigation.EmailRoute
import com.tmantoinelaw.portal.core.navigation.FeedRoute
import com.tmantoinelaw.portal.core.navigation.FilesRoute
import com.tmantoinelaw.portal.core.navigation.MessagesRoute
import com.tmantoinelaw.portal.core.navigation.Route
import com.tmantoinelaw.portal.core.navigation.SettingsRoute
import com.tmantoinelaw.portal.core.navigation.SignaturesRoute
import com.tmantoinelaw.portal.core.navigation.UsersRoute
import com.tmantoinelaw.portal.core.navigation.WorkflowsRoute
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.BootSkeleton
import com.tmantoinelaw.portal.core.ui.components.SkeletonBlock
import com.tmantoinelaw.portal.core.ui.components.SkeletonLineFraction
import com.tmantoinelaw.portal.core.ui.icons.PhosphorIcons
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.feature.shell.PortalAvatar

/** Where a tap on the board leads. The Home screen never navigates itself; the app does. */
class HomeActions(
    val go: (Route) -> Unit,
    val openFile: (fileId: String, folderId: String?) -> Unit,
    val openFolder: (folderId: String) -> Unit,
)

/**
 * The Dashboard (public/js/portal-home.js, prompt §11.1): greeting, the KPI
 * row with its period, and the tile board in the person's order. Paints from
 * the snapshots at once and refreshes behind the paint; a warm board never
 * shows a skeleton.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(actions: HomeActions, viewModel: HomeViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val identity = ui.identity
    var editing by remember { mutableStateOf(false) }

    PullToRefreshBox(isRefreshing = ui.refreshing, onRefresh = { viewModel.refresh() }, modifier = Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val columns = when {
                maxWidth < 700.dp -> 1
                maxWidth < 1100.dp -> 2
                else -> 3
            }
            if (identity == null) {
                BootSkeleton(columns = columns)
                return@BoxWithConstraints
            }
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tma.space.s20),
                verticalArrangement = Arrangement.spacedBy(Tma.space.s20),
            ) {
                Greeting(ui, viewModel, onEdit = { editing = true }, onPicture = { actions.go(SettingsRoute("profile")) })
                KpiRow(ui.board.metrics, ui.board.period, columns, onPeriod = { viewModel.setPeriod(it) }, onOpen = actions.go)
                TileBoard(ui, columns, actions, viewModel)
            }
        }
    }
    if (editing && identity != null) {
        EditDashboardSheet(
            identity = identity,
            show = ui.show,
            order = ui.order,
            cipCard = ui.board.cip.data?.let { cipCardVisible(it) } ?: identity.isStaff,
            onDismiss = { editing = false },
            onSave = { show, order -> viewModel.saveLayout(show, order) },
        )
    }
}

@Composable
private fun Greeting(ui: HomeUi, viewModel: HomeViewModel, onEdit: () -> Unit, onPicture: () -> Unit) {
    val me = ui.identity ?: return
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tma.space.s16)) {
        Box(Modifier.clip(androidx.compose.foundation.shape.CircleShape).clickable(onClick = onPicture)) {
            PortalAvatar(url = viewModel.absolute(me.avatar), name = me.name, size = 56.dp)
        }
        Column(Modifier.weight(1f)) {
            Text("Hello ${me.firstName}", style = Tma.type.text24sb, color = Tma.colors.ink)
            Text(
                if (me.avatar != null) "Change profile picture" else "Add profile picture",
                style = Tma.type.text14,
                color = Tma.colors.link,
                modifier = Modifier.clickable(onClick = onPicture),
            )
        }
        TextButton(onClick = onEdit) {
            Icon(painterResource(R.drawable.ic_squares_four), contentDescription = null, tint = Tma.colors.ink, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text("Edit Dashboard", style = Tma.type.text14sb, color = Tma.colors.ink)
        }
    }
}

/** The four cards (portal-home.js renderKpis): staff, or the provider-contact row; other clients get no row. */
@Composable
private fun KpiRow(metrics: Tile<MetricsDto>, period: String, columns: Int, onPeriod: (String) -> Unit, onOpen: (Route) -> Unit) {
    val m = metrics.data
    if (metrics.loaded && (m == null || (!m.staff && !m.provider))) return
    val cards: List<Kpi> = when {
        m?.provider == true -> listOf(
            Kpi("blue", "Active CIP Applications", "FilePlus", m.cards["cipActive"], ClientsRoute()),
            Kpi("purple", "CIP Updates Required", "WarningCircle", m.cards["cipUpdatesRequired"], ClientsRoute()),
            Kpi("blue", "Unread Messages", "ChatsCircle", m.cards["unreadMessages"], MessagesRoute()),
            Kpi("purple", "Open Comments", "ChatText", m.cards["openComments"], ClientsRoute()),
        )
        else -> listOf(
            Kpi("blue", "Avg. Response to Clients", "ClockCountdown", m?.cards?.get("clientResponse"), MessagesRoute()),
            Kpi("purple", "New CIP Applications", "FilePlus", m?.cards?.get("cipNew"), ClientsRoute()),
            Kpi("blue", "CIP Updates Required", "WarningCircle", m?.cards?.get("cipUpdatesRequired"), ClientsRoute()),
            Kpi("purple", "Awaiting Signature", "Signature", m?.cards?.get("awaitingSignature"), SignaturesRoute),
        )
    }
    Column(verticalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
        PeriodPicker(period, onPeriod)
        val perRow = if (columns >= 3) 4 else 2
        cards.chunked(perRow).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Tma.space.s16)) {
                row.forEach { kpi -> KpiCard(kpi, loaded = metrics.loaded, Modifier.weight(1f)) { onOpen(kpi.route) } }
            }
        }
    }
}

private data class Kpi(val tone: String, val label: String, val icon: String, val card: KpiCardDto?, val route: Route)

@Composable
private fun PeriodPicker(period: String, onPeriod: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val label = Board.periods.firstOrNull { it.second == period }?.first ?: "Today"
    Box {
        Row(
            Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.surface).clickable { open = true }.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(label, style = Tma.type.text14sb, color = Tma.colors.ink)
            Icon(painterResource(R.drawable.ic_arrow_line_down_16), contentDescription = null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(14.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Board.periods.forEach { (name, key) ->
                DropdownMenuItem(text = { Text(name, style = Tma.type.text14) }, onClick = { open = false; onPeriod(key) })
            }
        }
    }
}

@Composable
private fun KpiCard(kpi: Kpi, loaded: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val bg = if (kpi.tone == "purple") Tma.colors.dashCard2 else Tma.colors.dashCard1
    Column(
        modifier
            .clip(RoundedCornerShape(Tma.radius.r16))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(Tma.space.s16),
        verticalArrangement = Arrangement.spacedBy(Tma.space.s12),
    ) {
        if (!loaded) {
            SkeletonLineFraction(0.55f)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                SkeletonBlock(Modifier.width(72.dp).size(28.dp)); SkeletonBlock(Modifier.width(40.dp).size(14.dp))
            }
            return@Column
        }
        // Cards the server couldn't measure: an em dash is honest about the gap (portal-home.js KPI_UNAVAILABLE).
        val card = kpi.card ?: KpiCardDto(value = "-", delta = "Unavailable", deltaUp = false, hint = "Could not load this metric.")
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(kpi.label, style = Tma.type.text14, color = Tma.colors.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(painterResource(PhosphorIcons.resolveOr(kpi.icon, R.drawable.ic_chart_bar)), contentDescription = null, tint = Tma.colors.ink, modifier = Modifier.size(18.dp))
            Icon(painterResource(R.drawable.ic_arrow_up_right), contentDescription = "Open", tint = Tma.colors.inkSecondary, modifier = Modifier.size(14.dp))
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(card.value, style = Tma.type.text24sb, color = Tma.colors.ink, maxLines = 1)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 3.dp)) {
                Text(card.delta, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(
                    painterResource(if (card.deltaUp) R.drawable.ic_arrow_rise else R.drawable.ic_arrow_fall),
                    contentDescription = if (card.deltaUp) "up" else "down",
                    tint = Tma.colors.inkSecondary,
                    modifier = Modifier.size(12.dp),
                )
            }
        }
    }
}

/**
 * The board (portal-home.js packHomeTiles): every tile is one column wide,
 * placed in order into the shortest column, so the three columns stay level.
 */
@Composable
private fun TileBoard(ui: HomeUi, columns: Int, actions: HomeActions, viewModel: HomeViewModel) {
    val identity = ui.identity ?: return
    val visible = ui.order.filter { id -> ui.shown(id) && tileAllowed(id, identity) }
    val cols = List(columns) { mutableListOf<String>() }
    val heights = IntArray(columns)
    visible.forEach { id ->
        val i = heights.indices.minByOrNull { heights[it] } ?: 0
        cols[i].add(id); heights[i] += tileWeight(id)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Tma.space.s20)) {
        cols.forEach { column ->
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tma.space.s20)) {
                column.forEach { id -> HomeTile(id, ui, actions, viewModel) }
            }
        }
    }
}

private fun tileAllowed(id: String, identity: com.tmantoinelaw.portal.core.data.identity.Identity): Boolean = when (id) {
    "email" -> identity.can("mail.use")
    "requests", "comments" -> identity.can("workflows.view")
    else -> true
}

private fun tileWeight(id: String) = when (id) { "employees", "cipStatus", "road" -> 4; "shortcuts" -> 2; else -> 3 }

@Composable
private fun HomeTile(id: String, ui: HomeUi, actions: HomeActions, viewModel: HomeViewModel) {
    val b = ui.board
    when (id) {
        "recentFiles" -> FileRowsTile("Recent Files", b.recent, "No recent files yet.", actions)
        "favorites" -> FileRowsTile("Favorites", b.favorites, "No favorites yet.", actions)
        "email" -> EmailTileView(b.email, resolve = viewModel::absolute, onOpenEmail = { actions.go(EmailRoute()) }, onOpen = { actions.go(EmailRoute(message = it)) })
        "messages" -> ChatsTile(b.chats, resolve = viewModel::absolute, onOpenMessages = { actions.go(MessagesRoute()) }, onOpen = { actions.go(MessagesRoute(conversation = it)) })
        "shortcuts" -> ShortcutsTile(ui.identity!!, actions.go)
        "employees" -> EmployeesTile(b.staff, resolve = viewModel::absolute, onMessage = { actions.go(MessagesRoute()) })
        "road" -> RoadTile(b.road, b.roadDay, onDay = { viewModel.setRoadDay(it) }, onOpen = { actions.go(CalendarRoute) })
        "cipStatus" -> CipTile(b.cip, staff = ui.identity?.isStaff, onBucket = { actions.go(ClientsRoute()) })
        "requests" -> RequestsTile(b.work, resolve = viewModel::absolute, onOpen = { f ->
            val id = f.id
            if (id != null) actions.openFile(id, f.folderId) else actions.go(WorkflowsRoute())
        })
        "comments" -> CommentsTile(b.work, resolve = viewModel::absolute, onOpen = { c ->
            viewModel.markCommentRead(c.id)
            val file = c.file
            val id = file?.id
            if (id != null) actions.openFile(id, file.folderId) else actions.go(WorkflowsRoute("feedback"))
        })
    }
}

/** The web's shortcut vocabulary (portal-home.js SHORTCUTS); the three action shortcuts land on their pages until their dialogs ship. */
@Composable
private fun ShortcutsTile(identity: com.tmantoinelaw.portal.core.data.identity.Identity, go: (Route) -> Unit) {
    data class Shortcut(val id: String, val label: String, val icon: Int, val cap: String? = null, val route: Route)
    val all = listOf(
        Shortcut("email", "Email", R.drawable.ic_envelope_simple, "mail.use", EmailRoute()),
        Shortcut("messages", "Messages", R.drawable.ic_chats_circle, null, MessagesRoute()),
        Shortcut("feed", "Feed", R.drawable.ic_newspaper, "feed.view", FeedRoute),
        Shortcut("calendar", "Calendar", R.drawable.ic_calendar_blank, null, CalendarRoute),
        Shortcut("users", "Users", R.drawable.ic_user_list, "users.view", UsersRoute()),
        Shortcut("share-files", "Share Files", R.drawable.ic_share_network, "files.viewOrg", FilesRoute("all")),
        Shortcut("request-files", "Request Files", R.drawable.ic_upload_simple, "files.viewOrg", FilesRoute("all")),
        Shortcut("new-user-folders", "Create New User", R.drawable.ic_user_plus, "users.manage", UsersRoute(new = true)),
        Shortcut("shared-folders", "Shared Folders", R.drawable.ic_folder_notch, "files.viewOrg", FilesRoute("shared")),
        Shortcut("favorites", "Favorites", R.drawable.ic_star, null, FilesRoute("favorites")),
        Shortcut("feedback-approval", "Feedback and Comments", R.drawable.ic_chat_circle, "workflows.view", WorkflowsRoute("feedback")),
        Shortcut("updates-required", "Updates required", R.drawable.ic_warning, "workflows.view", WorkflowsRoute("updates")),
        Shortcut("send-signature", "Send for Signature", R.drawable.ic_pen_nib, "signatures.create", SignaturesRoute),
    )
    val shown = all.filter { it.cap == null || identity.can(it.cap) }
    if (shown.isEmpty()) return
    TilePanel(title = "Shortcuts") {
        val perRow = 3
        shown.chunked(perRow).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Tma.space.s8)) {
                row.forEach { sc ->
                    Column(
                        Modifier.weight(1f).clip(RoundedCornerShape(Tma.radius.r12)).clickable { go(sc.route) }.padding(vertical = Tma.space.s8),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(Modifier.size(44.dp).clip(RoundedCornerShape(Tma.radius.r12)).background(Tma.colors.tint1), contentAlignment = Alignment.Center) {
                            Icon(painterResource(sc.icon), contentDescription = null, tint = Tma.colors.primaryDark, modifier = Modifier.size(22.dp))
                        }
                        Text(sc.label, style = Tma.type.text12, color = Tma.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    }
                }
                repeat(perRow - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/** A tile's frame: the card, its head (title + meta), and its body (portal-home.js tileShell/panelHead). */
@Composable
fun TilePanel(title: String, meta: String? = null, busy: Boolean = false, content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.panel).padding(Tma.space.s16),
        verticalArrangement = Arrangement.spacedBy(Tma.space.s12),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = Tma.type.text14sb, color = Tma.colors.ink, modifier = Modifier.weight(1f))
            if (!meta.isNullOrBlank()) Text(meta, style = Tma.type.text12, color = Tma.colors.inkSecondary, fontWeight = FontWeight.SemiBold)
        }
        content()
    }
}

@Composable
fun PanelNote(text: String) = Text(text, style = Tma.type.text14, color = Tma.colors.inkSecondary)
