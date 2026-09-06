package com.tmantoinelaw.portal.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.tmantoinelaw.portal.core.common.time.TimeLabels
import com.tmantoinelaw.portal.core.data.dashboard.CalendarEventRowDto
import com.tmantoinelaw.portal.core.data.dashboard.CipDashboardDto
import com.tmantoinelaw.portal.core.data.dashboard.ConversationRowDto
import com.tmantoinelaw.portal.core.data.dashboard.EmailTile
import com.tmantoinelaw.portal.core.data.dashboard.EmployeeDto
import com.tmantoinelaw.portal.core.data.dashboard.FileRowDto
import com.tmantoinelaw.portal.core.data.dashboard.StaffDto
import com.tmantoinelaw.portal.core.data.dashboard.Tile
import com.tmantoinelaw.portal.core.data.dashboard.WorkCommentDto
import com.tmantoinelaw.portal.core.data.dashboard.WorkDto
import com.tmantoinelaw.portal.core.data.dashboard.WorkFileDto
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.SkeletonFileRow
import com.tmantoinelaw.portal.core.ui.icons.PhosphorIcons
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.core.ui.theme.Tokens
import com.tmantoinelaw.portal.feature.shell.PortalAvatar
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/* ── Recent Files / Favorites ─────────────────────────────────────────── */

@Composable
fun FileRowsTile(title: String, tile: Tile<List<FileRowDto>>, empty: String, actions: HomeActions) {
    TilePanel(title = title, busy = !tile.loaded) {
        val rows = tile.data
        when {
            rows == null && !tile.loaded -> repeat(3) { SkeletonFileRow() }
            rows.isNullOrEmpty() -> PanelNote(empty)
            else -> rows.forEach { f -> FileRow(f) { if (f.type == "folder") actions.openFolder(f.id) else actions.openFile(f.id, f.folder?.id) } }
        }
    }
}

@Composable
fun FileRow(f: FileRowDto, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r8)).clickable(onClick = onClick).padding(vertical = 6.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
    ) {
        FileGlyph(f, 24.dp)
        Column(Modifier.weight(1f)) {
            Text(f.name, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val path = f.path.joinToString(" / ") { it.name }.ifEmpty { if (f.type == "file") "File Box" else "" }
            if (path.isNotEmpty()) Text(path, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Folder glyph for folders, the server thumbnail for images, the type icon otherwise (portal-home.js rowIconHtml). */
@Composable
fun FileGlyph(f: FileRowDto, size: androidx.compose.ui.unit.Dp) {
    if (f.type == "folder") {
        val empty = ((f.fileCount ?: 0) + (f.folderCount ?: 0)) == 0
        Icon(painterResource(if (empty) R.drawable.ic_folder else R.drawable.ic_folder_open), contentDescription = null, tint = folderColour(f.colour), modifier = Modifier.size(size))
        return
    }
    if (f.thumbUrl != null) {
        AsyncImage(model = f.thumbUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(size).clip(RoundedCornerShape(4.dp)))
        return
    }
    Icon(painterResource(PhosphorIcons.resolveOr(f.icon, R.drawable.ic_file)), contentDescription = null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(size))
}

/** app/Support/Files/FolderColours.php keys: default, blue, green, pink, red, teal. */
@Composable
fun folderColour(key: String?): Color = when (key) {
    "blue" -> Tokens.Accent.blue; "green" -> Tokens.Accent.green; "pink" -> Tokens.Accent.pink
    "red" -> Tokens.Accent.red; "teal" -> Tokens.Accent.mint; else -> Tma.colors.primary
}

/* ── Recent Email ─────────────────────────────────────────────────────── */

@Composable
fun EmailTileView(tile: Tile<EmailTile>, resolve: (String?) -> String?, onOpenEmail: () -> Unit, onOpen: (String) -> Unit) {
    TilePanel(title = "Recent Email") {
        val data = tile.data
        when {
            data == null && !tile.loaded -> repeat(4) { SkeletonFileRow(avatar = true) }
            data?.connected == false -> {
                PanelNote("Connect a mailbox to see recent email here.")
                TextButton(onClick = onOpenEmail, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text("Open Email", style = Tma.type.text14sb, color = Tma.colors.link) }
            }
            data == null || data.messages.isEmpty() -> PanelNote("No recent messages.")
            else -> data.messages.forEach { m ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r8)).clickable { onOpen(m.id) }.padding(vertical = 6.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
                ) {
                    PortalAvatar(url = resolve(m.avatarUrl), name = m.sender ?: m.email, size = 32.dp)
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(m.sender ?: m.email ?: "Unknown", style = Tma.type.text14, fontWeight = if (m.unread) FontWeight.SemiBold else FontWeight.Normal, color = Tma.colors.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(TimeLabels.clockOrDate(m.sentAt, m.time.orEmpty()), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                        }
                        Text(m.subject ?: "(no subject)", style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        m.body?.takeIf { it.isNotBlank() }?.let { Text(it, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
        }
    }
}

/* ── Messages ─────────────────────────────────────────────────────────── */

@Composable
fun ChatsTile(tile: Tile<List<ConversationRowDto>>, resolve: (String?) -> String?, onOpenMessages: () -> Unit, onOpen: (String) -> Unit) {
    val chats = tile.data.orEmpty()
    val unreadTotal = chats.sumOf { maxOf(0, it.unread) }
    TilePanel(title = "Messages", meta = if (unreadTotal > 0) "$unreadTotal unread" else null) {
        when {
            tile.data == null && !tile.loaded -> repeat(4) { SkeletonFileRow(avatar = true) }
            chats.isEmpty() -> {
                PanelNote("No conversations yet.")
                TextButton(onClick = onOpenMessages, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text("Open Messages", style = Tma.type.text14sb, color = Tma.colors.link) }
            }
            else -> chats.forEach { c ->
                val name = if (!c.name.isNullOrBlank() && c.name != "Group") c.name!! else c.members.mapNotNull { it.name }.joinToString(", ").ifEmpty { c.name ?: "Chat" }
                val preview = when {
                    !c.draft.isNullOrBlank() -> "Draft: ${c.draft}"
                    !c.reactionNote.isNullOrBlank() -> c.reactionNote!!
                    !c.preview.isNullOrBlank() -> c.preview!!
                    c.type == "group" -> c.presence?.label?.takeIf { !it.equals("group chat", true) } ?: (c.memberCount?.let { if (it == 1) "1 member" else "$it members" } ?: "")
                    else -> ""
                }
                val unread = c.unread > 0 || c.markedUnread
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r8)).clickable { onOpen(c.id) }.padding(vertical = 6.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
                ) {
                    Box {
                        PortalAvatar(url = resolve(c.photo), name = name, size = 32.dp)
                        if (c.presence?.online == true) Box(Modifier.align(Alignment.BottomEnd).size(10.dp).clip(CircleShape).background(Tma.colors.surface).padding(1.5.dp).clip(CircleShape).background(Tokens.Accent.green))
                    }
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(name, style = Tma.type.text14, fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal, color = Tma.colors.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(c.time.orEmpty(), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                        }
                        Text(preview, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (c.unread > 0) Box(Modifier.clip(RoundedCornerShape(9.dp)).background(Tma.colors.primary).padding(horizontal = 6.dp, vertical = 1.dp)) {
                        Text(if (c.unread > 99) "99+" else c.unread.toString(), style = Tma.type.text12, color = Color.White)
                    }
                }
            }
        }
    }
}

/* ── Employees ────────────────────────────────────────────────────────── */

@Composable
fun EmployeesTile(tile: Tile<StaffDto>, resolve: (String?) -> String?, onMessage: (EmployeeDto) -> Unit) {
    val data = tile.data
    if (tile.loaded && (data == null || !data.staff)) return
    val people = data?.employees.orEmpty().sortedWith(compareByDescending<EmployeeDto> { it.online }.thenByDescending { it.lastSeenAt ?: "" }.thenBy { it.name })
    val online = people.count { it.online }
    TilePanel(title = "Employees", meta = if (data != null) "$online of ${people.size} online" else null) {
        when {
            data == null -> repeat(5) { SkeletonFileRow(avatar = true) }
            people.isEmpty() -> PanelNote("No employees to show.")
            else -> Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                people.forEach { p ->
                    val (tone, label) = presenceBadge(p)
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r8)).clickable(enabled = !p.self) { onMessage(p) }.padding(vertical = 6.dp, horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
                    ) {
                        Box {
                            PortalAvatar(url = resolve(p.avatar), name = p.name, size = 36.dp)
                            if (p.online) Box(Modifier.align(Alignment.BottomEnd).size(11.dp).clip(CircleShape).background(Tma.colors.surface).padding(1.5.dp).clip(CircleShape).background(Tokens.Accent.green))
                        }
                        Column(Modifier.weight(1f)) {
                            Text(p.name + if (p.self) " (you)" else "", style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(subtitle(p), style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        val chip = when (tone) { "online" -> Tokens.Accent.green; "busy" -> Tokens.Accent.orange; else -> Tma.colors.inactive }
                        Box(Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(chip.copy(alpha = 0.18f)).padding(horizontal = 8.dp, vertical = 2.dp)) {
                            Text(label, style = Tma.type.text12, color = Tma.colors.ink)
                        }
                    }
                }
            }
        }
    }
}

/** Online / Offline only; on a call or do-not-disturb reads as busy (portal-home.js presenceBadge). */
private fun presenceBadge(p: EmployeeDto): Pair<String, String> {
    if (!p.statusLabel.isNullOrBlank()) {
        val tone = when {
            p.status == "offline" -> "offline"
            p.status == "on_call" || p.status == "do_not_disturb" -> "busy"
            else -> "online"
        }
        return tone to p.statusLabel!!
    }
    return if (p.online) "online" to "Online" else "offline" to "Offline"
}

private fun subtitle(p: EmployeeDto): String = when {
    !p.statusMessage.isNullOrBlank() -> p.statusMessage!!
    p.online -> p.statusLabel ?: "Online"
    !p.lastSeenAt.isNullOrBlank() -> "Last seen " + TimeLabels.relative(p.lastSeenAt).replaceFirstChar { it.lowercase() }
    else -> p.lastSeen ?: "Last seen recently"
}

/* ── Upcoming Events (the road) ───────────────────────────────────────── */

@Composable
fun RoadTile(tile: Tile<List<CalendarEventRowDto>>, day: String, onDay: (String) -> Unit, onOpen: () -> Unit) {
    val selected = LocalDate.parse(day)
    val weekStart = selected.with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY))
    val dayLabel = DateTimeFormatter.ofPattern("EEE", Locale.US)
    TilePanel(title = "Upcoming Events") {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(painterResource(R.drawable.ic_caret_left), contentDescription = "Previous week", tint = Tma.colors.inkSecondary, modifier = Modifier.size(20.dp).clip(CircleShape).clickable { onDay(selected.minusWeeks(1).toString()) })
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.SpaceBetween) {
                (0..6).forEach { i ->
                    val d = weekStart.plusDays(i.toLong())
                    val active = d == selected
                    Column(
                        Modifier.clip(RoundedCornerShape(Tma.radius.r12)).background(if (active) Tma.colors.ink else Color.Transparent).clickable { onDay(d.toString()) }.padding(horizontal = 6.dp, vertical = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(dayLabel.format(d).take(3), style = Tma.type.text12, color = if (active) Tma.colors.surface else Tma.colors.inkSecondary)
                        Text(d.dayOfMonth.toString(), style = Tma.type.text14sb, color = if (active) Tma.colors.surface else Tma.colors.ink)
                    }
                }
            }
            Icon(painterResource(R.drawable.ic_caret_right), contentDescription = "Next week", tint = Tma.colors.inkSecondary, modifier = Modifier.size(20.dp).clip(CircleShape).clickable { onDay(selected.plusWeeks(1).toString()) })
        }
        val events = tile.data
        when {
            events == null && !tile.loaded -> repeat(2) { SkeletonFileRow(avatar = true) }
            events.isNullOrEmpty() -> PanelNote("No upcoming events for this day.")
            else -> events.forEach { ev ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r8)).clickable(onClick = onOpen).padding(vertical = 6.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
                ) {
                    PortalAvatar(url = null, name = ev.organizerName ?: ev.title, size = 32.dp)
                    Column(Modifier.weight(1f)) {
                        Text(ev.title ?: "Untitled event", style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(roadTime(ev), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                    }
                }
            }
        }
    }
}

private fun roadTime(ev: CalendarEventRowDto): String {
    if (ev.allDay) return "All day"
    val fmt = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
    val zone = ZoneId.systemDefault()
    val start = runCatching { ZonedDateTime.parse(ev.startsAt).withZoneSameInstant(zone) }.getOrNull() ?: return ""
    val end = runCatching { ZonedDateTime.parse(ev.endsAt).withZoneSameInstant(zone) }.getOrNull()
    return if (end != null) "${fmt.format(start)} – ${fmt.format(end)}" else fmt.format(start)
}

/* ── CIP Applications ─────────────────────────────────────────────────── */

fun cipCardVisible(p: CipDashboardDto): Boolean = when {
    !p.cip -> false
    p.card == true -> true
    p.card == false -> false
    else -> p.staff == true
}

private val cipTones = mapOf(
    "success" to Tokens.Accent.green, "danger" to Tokens.Accent.red, "pending" to Tokens.Accent.yellow, "action" to Tokens.Accent.orange,
    "neutral" to Color(0xFF9AA3AD), "sky" to Tokens.Accent.blue, "indigo" to Tokens.Accent.indigo, "violet" to Tokens.Accent.violet,
    "amber" to Tokens.Accent.yellow, "teal" to Tokens.Accent.mint, "orange" to Tokens.Accent.orange, "rose" to Tokens.Accent.pink,
    "cyan" to Tokens.Accent.cyan, "copper" to Color(0xFFC77D18),
)

@Composable
fun CipTile(tile: Tile<CipDashboardDto>, staff: Boolean?, onBucket: (String) -> Unit) {
    val data = tile.data
    if (!tile.loaded) { if (staff == false) return; TilePanel(title = "CIP Applications") { repeat(4) { SkeletonFileRow() } }; return }
    if (data == null || !cipCardVisible(data) || data.buckets.isEmpty()) return
    val parts = data.buckets.filter { !it.aggregate }
    val total = data.total ?: parts.sumOf { it.count }
    val busy = parts.filter { it.count > 0 }
    val clear = parts.filter { it.count == 0 }
    TilePanel(title = "CIP Applications", meta = String.format(Locale.US, "%,d", total)) {
        if (busy.isEmpty()) {
            Text("Nothing waiting right now", style = Tma.type.text14, color = Tma.colors.inkSecondary)
        } else {
            Row(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                busy.forEach { b -> Box(Modifier.weight(b.count.toFloat()).fillMaxWidth().height(10.dp).background(cipTones[b.tone] ?: cipTones.getValue("neutral"))) }
            }
            busy.forEach { b ->
                val pct = if (total > 0) String.format(Locale.US, "%.1f%%", b.count * 100.0 / total).replace(".0%", "%") else "0%"
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r8)).clickable { onBucket(b.key) }.padding(vertical = 4.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(cipTones[b.tone] ?: cipTones.getValue("neutral")))
                    Text(b.short ?: b.label, style = Tma.type.text14, color = Tma.colors.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(String.format(Locale.US, "%,d", b.count), style = Tma.type.text14sb, color = Tma.colors.ink)
                    Text(pct, style = Tma.type.text12, color = Tma.colors.inkSecondary)
                }
            }
        }
        if (clear.isNotEmpty()) {
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                clear.forEach { b ->
                    Box(Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.hover).clickable { onBucket(b.key) }.padding(horizontal = 10.dp, vertical = 4.dp)) {
                        Text(b.short ?: b.label, style = Tma.type.text12, color = Tma.colors.inkSecondary)
                    }
                }
            }
        }
    }
}

/* ── Requests / Comments ──────────────────────────────────────────────── */

@Composable
fun RequestsTile(tile: Tile<WorkDto>, resolve: (String?) -> String?, onOpen: (WorkFileDto) -> Unit) {
    val work = tile.data
    if (tile.loaded && work != null && !work.enabled) return
    val waiting = work?.counts?.waiting ?: 0
    TilePanel(title = "Requests", meta = if (waiting > 0) "$waiting waiting" else null) {
        when {
            work == null && !tile.loaded -> repeat(4) { SkeletonFileRow(avatar = true) }
            work == null || work.requests.isEmpty() -> PanelNote("Nothing is waiting on you.")
            else -> work.requests.forEach { r ->
                val tone = r.headline?.tone
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r8)).clickable { onOpen(r.file ?: WorkFileDto()) }.padding(vertical = 6.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
                ) {
                    PortalAvatar(url = resolve(r.sender?.avatar), name = r.sender?.name, size = 32.dp)
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(r.typeLabel ?: "Request", style = Tma.type.text14sb, color = Tma.colors.ink, modifier = Modifier.weight(1f))
                            Text(TimeLabels.ago(r.sentAt), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                        }
                        r.file?.name?.let { Text(it, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        Text(
                            r.headline?.text ?: r.statusLabel.orEmpty(),
                            style = Tma.type.text12,
                            color = when (tone) { "danger" -> Tma.colors.danger; "action" -> Tma.colors.primaryDark; else -> Tma.colors.inkSecondary },
                            maxLines = 2, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun CommentsTile(tile: Tile<WorkDto>, resolve: (String?) -> String?, onOpen: (WorkCommentDto) -> Unit) {
    val work = tile.data
    if (tile.loaded && work != null && !work.enabled) return
    val unread = work?.counts?.unread ?: 0
    TilePanel(title = "Comments", meta = if (unread > 0) "$unread unread" else null) {
        when {
            work == null && !tile.loaded -> repeat(4) { SkeletonFileRow(avatar = true) }
            work == null || work.comments.isEmpty() -> PanelNote("No comments involving you yet.")
            else -> work.comments.forEach { c ->
                val isUnread = c.unread && !c.resolved
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r8)).clickable { onOpen(c) }.padding(vertical = 6.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
                ) {
                    PortalAvatar(url = resolve(c.author?.avatar), name = c.author?.name, size = 32.dp)
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(c.author?.name ?: "Someone", style = Tma.type.text14sb, color = Tma.colors.ink, modifier = Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (isUnread) Box(Modifier.size(6.dp).clip(CircleShape).background(Tma.colors.primary))
                            Spacer(Modifier.weight(1f))
                            Text(TimeLabels.ago(c.createdAt), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                        }
                        Text(if (c.deleted) "This comment was deleted." else c.body.orEmpty(), style = Tma.type.text14, color = Tma.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        c.file?.name?.let { Text(it, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
        }
    }
}
