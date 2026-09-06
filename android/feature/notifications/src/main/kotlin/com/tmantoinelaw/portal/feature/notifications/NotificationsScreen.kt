package com.tmantoinelaw.portal.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.tmantoinelaw.portal.core.common.time.TimeLabels
import com.tmantoinelaw.portal.core.data.notifications.NotificationDto
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.SectionError
import com.tmantoinelaw.portal.core.ui.components.SkeletonFileRow
import com.tmantoinelaw.portal.core.ui.icons.PhosphorIcons
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.feature.shell.PortalAvatar

/**
 * The notifications list (public/js/notify-render.js, activity-popups.js):
 * icon or actor, title, message, the portal's relative time, an unread dot,
 * filters, "Mark all as read", "Load more". Tapping opens the item's
 * `actionUrl` and marks it read.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NotificationsScreen(
    onOpen: (NotificationDto) -> Unit,
    resolveUrl: (String) -> String,
    viewModel: NotificationsViewModel = hiltViewModel(),
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize().background(Tma.colors.page)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Tma.space.s16, vertical = Tma.space.s8),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tma.space.s8),
        ) {
            FilterChip("All", ui.filter == NotificationFilter.All) { viewModel.setFilter(NotificationFilter.All) }
            FilterChip("Unread", ui.filter == NotificationFilter.Unread) { viewModel.setFilter(NotificationFilter.Unread) }
            FilterChip("Action required", ui.filter == NotificationFilter.ActionRequired) { viewModel.setFilter(NotificationFilter.ActionRequired) }
            Spacer(Modifier.weight(1f))
            if (ui.unread > 0) {
                TextButton(onClick = { viewModel.readAll() }) {
                    Text("Mark all as read", style = Tma.type.text14sb, color = Tma.colors.ink)
                }
            }
        }
        when {
            !ui.loaded && ui.loading && ui.items.isEmpty() -> Column(Modifier.padding(Tma.space.s16)) { repeat(4) { SkeletonFileRow(avatar = true) } }
            ui.error != null && ui.items.isEmpty() -> SectionError(onRetry = { viewModel.refresh() }, message = ui.error!!, modifier = Modifier.padding(Tma.space.s16))
            ui.items.isEmpty() -> EmptyState(if (ui.filter == NotificationFilter.Unread) "No unread notifications." else "You are all caught up.")
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Tma.space.s12, vertical = Tma.space.s8)) {
                items(ui.items, key = { it.id }) { item ->
                    NotificationRow(
                        item = item,
                        resolveUrl = resolveUrl,
                        onOpen = { viewModel.open(item); onOpen(item) },
                        onMarkRead = { viewModel.markRead(item.id) },
                        onMarkUnread = { viewModel.markUnread(item.id) },
                        onComplete = { viewModel.complete(item.id) },
                        onDelete = { viewModel.delete(item.id) },
                    )
                }
                if (ui.hasMore && ui.filter == NotificationFilter.All) {
                    item("more") {
                        TextButton(onClick = { viewModel.loadMore() }, modifier = Modifier.fillMaxWidth()) {
                            Text("Load more", style = Tma.type.text14sb, color = Tma.colors.ink)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(Tma.radius.pill))
            .background(if (selected) Tma.colors.ink else Tma.colors.hover)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(label, style = Tma.type.text12, color = if (selected) Tma.colors.surface else Tma.colors.ink, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun EmptyState(message: String) {
    Column(
        Modifier.fillMaxWidth().padding(Tma.space.s32),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Tma.space.s12),
    ) {
        Icon(painterResource(R.drawable.ic_bell), contentDescription = null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(28.dp))
        Text(message, style = Tma.type.text14, color = Tma.colors.inkSecondary)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NotificationRow(
    item: NotificationDto,
    resolveUrl: (String) -> String,
    onOpen: () -> Unit,
    onMarkRead: () -> Unit,
    onMarkUnread: () -> Unit,
    onComplete: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Tma.radius.r12))
                .background(if (item.read) androidx.compose.ui.graphics.Color.Transparent else Tma.colors.accentBg)
                .combinedClickable(onClick = onOpen, onLongClick = { menu = true })
                .padding(horizontal = Tma.space.s12, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
            verticalAlignment = Alignment.Top,
        ) {
            val actor = item.actor
            if (actor?.name != null || item.image != null) {
                PortalAvatar(url = (item.image ?: actor?.avatar)?.let(resolveUrl), name = actor?.name ?: item.title, size = 36.dp)
            } else {
                Box(Modifier.size(36.dp).clip(CircleShape).background(Tma.colors.hover), contentAlignment = Alignment.Center) {
                    Icon(
                        painterResource(PhosphorIcons.resolveOr(item.icon, R.drawable.ic_bell)),
                        contentDescription = null,
                        tint = tone(item.level),
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    item.title,
                    style = Tma.type.text14,
                    fontWeight = if (item.read) FontWeight.Normal else FontWeight.SemiBold,
                    color = Tma.colors.ink,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                item.message?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Tma.space.s8), verticalAlignment = Alignment.CenterVertically) {
                    Text(TimeLabels.relative(item.createdAt), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                    if (item.requiresAction && !item.completed) {
                        Text(item.actionLabel ?: "Action required", style = Tma.type.text12, color = Tma.colors.primaryDark, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            if (!item.read) {
                Spacer(Modifier.width(2.dp))
                Box(Modifier.padding(top = 6.dp).size(8.dp).clip(CircleShape).background(Tma.colors.primary))
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            if (item.read) DropdownMenuItem(text = { Text("Mark as unread", style = Tma.type.text14) }, onClick = { menu = false; onMarkUnread() })
            else DropdownMenuItem(text = { Text("Mark as read", style = Tma.type.text14) }, onClick = { menu = false; onMarkRead() })
            if (item.requiresAction && !item.completed) DropdownMenuItem(text = { Text("Mark as done", style = Tma.type.text14) }, onClick = { menu = false; onComplete() })
            DropdownMenuItem(text = { Text("Delete", style = Tma.type.text14) }, onClick = { menu = false; onDelete() })
        }
    }
}

@Composable
private fun tone(level: String) = when (level) {
    "success" -> Tma.colors.success
    "warning", "reminder" -> Tma.colors.warning
    "error", "security" -> Tma.colors.danger
    "action_required", "approval_required" -> Tma.colors.primaryDark
    else -> Tma.colors.primary
}
