package com.tmantoinelaw.portal.feature.files

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.tmantoinelaw.portal.core.common.time.TimeLabels
import com.tmantoinelaw.portal.core.data.files.FileItemDto
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.SectionError
import com.tmantoinelaw.portal.core.ui.components.SkeletonFileRow
import com.tmantoinelaw.portal.core.ui.components.TmaIconButton
import com.tmantoinelaw.portal.core.ui.icons.PhosphorIcons
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.core.ui.theme.Tokens
import com.tmantoinelaw.portal.feature.shell.PortalAvatar

/** The type pills (portal-files.js TYPE_PILLS). */
private val TYPE_PILLS = listOf("pdf" to "PDF", "word" to "Word", "excel" to "Excel", "powerpoint" to "PowerPoint", "image" to "Images", "video" to "Video", "audio" to "Audio", "archive" to "Archives", "text" to "Text")
private val SORT_FIELDS = listOf("name" to "Name", "modified" to "Modified", "created" to "Created", "size" to "Size", "type" to "Type")

/**
 * The File Library listing (public/js/portal-files.js, prompt §11.6): breadcrumb,
 * toolbar, type pills, search, then the table or grid. Tap opens, long-press
 * selects; the row's menu and the selection toolbar carry every action.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FilesScreen(
    onOpenFolder: (String?) -> Unit,
    onOpenFile: (fileId: String, folderId: String?) -> Unit,
    onDownload: (url: String, name: String) -> Unit,
    viewModel: FilesViewModel = hiltViewModel(),
) {
    val openFile: (FileItemDto) -> Unit = { onOpenFile(it.id, it.folder?.id) }
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var menuFor by remember { mutableStateOf<FileItemDto?>(null) }
    var bulkMenu by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<FilesDialog?>(null) }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { e ->
            when (e) {
                is FilesEvent.Toast -> snackbar.showSnackbar(e.message)
                is FilesEvent.Download -> onDownload(e.url, e.name)
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Tma.colors.page)) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val phone = maxWidth < 600.dp
            Column(Modifier.fillMaxSize()) {
                Breadcrumb(ui, onRoot = { viewModel.openFolder(null); onOpenFolder(null) }, onCrumb = { viewModel.openFolder(it); onOpenFolder(it) })
                if (ui.packageLocked) Banner("The original submission is locked. New files go in Additional Documents.")
                Toolbar(ui, viewModel, phone, onNewFolder = { dialog = FilesDialog.NewFolder }, onBulk = { bulkMenu = true }, onEmptyBin = { dialog = FilesDialog.EmptyBin })
                if (!ui.isRecycle) TypePills(ui, viewModel)
                SearchField(ui.query.search) { viewModel.search(it) }
                val items = ui.items
                when {
                    ui.loading && ui.listing == null -> Column(Modifier.padding(Tma.space.s16)) { repeat(8) { SkeletonFileRow() } }
                    ui.error != null && ui.listing == null -> SectionError(onRetry = { viewModel.load() }, message = ui.error!!, modifier = Modifier.padding(Tma.space.s16))
                    items.isEmpty() -> EmptyListing(ui, onUpload = { /* phase 5c */ })
                    ui.grid && !phone -> GridBody(ui, viewModel, onOpenFolder, openFile) { menuFor = it }
                    else -> ListBody(ui, viewModel, phone, onOpenFolder, openFile) { menuFor = it }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }

    menuFor?.let { item ->
        ItemActionsSheet(item = item, ui = ui, viewModel = viewModel, onDismiss = { menuFor = null }, onOpen = { if (item.isFolder) { viewModel.openFolder(item.id); onOpenFolder(item.id) } else openFile(item) }, onDialog = { dialog = it })
    }
    if (bulkMenu) BulkActionsSheet(ui = ui, viewModel = viewModel, onDismiss = { bulkMenu = false }, onDialog = { dialog = it })
    dialog?.let { FilesDialogHost(it, ui, viewModel) { dialog = null } }
    // A deep link carried `file=`: open the viewer once (memory: read `file` before the URL is cleared).
    LaunchedEffect(ui.openFileId) {
        ui.openFileId?.let { id -> viewModel.openFile(null); onOpenFile(id, ui.query.folder) }
    }
}

@Composable
private fun Banner(text: String) {
    Box(Modifier.fillMaxWidth().padding(horizontal = Tma.space.s16, vertical = Tma.space.s8).clip(RoundedCornerShape(Tma.radius.r12)).background(Tma.colors.tint1).padding(Tma.space.s12)) {
        Text(text, style = Tma.type.text14, color = Tma.colors.ink)
    }
}

/** Root title, the hidden middle as "…", and the last two crumbs (portal-files.js renderBreadcrumb, CRUMB_TAIL = 2). */
@Composable
private fun Breadcrumb(ui: FilesUi, onRoot: () -> Unit, onCrumb: (String) -> Unit) {
    val trail = ui.listing?.breadcrumb.orEmpty()
    if (ui.query.folder == null && trail.isEmpty()) {
        Text(ui.copy.title, style = Tma.type.text18sb, color = Tma.colors.ink, modifier = Modifier.padding(horizontal = Tma.space.s16, vertical = Tma.space.s8))
        return
    }
    val hidden = if (trail.size > 2) trail.dropLast(2) else emptyList()
    val shown = if (hidden.isNotEmpty()) trail.takeLast(2) else trail
    var more by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Tma.space.s16, vertical = Tma.space.s8), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(ui.copy.title, style = Tma.type.text14, color = Tma.colors.inkSecondary, modifier = Modifier.clickable(onClick = onRoot))
        if (hidden.isNotEmpty()) {
            Text("/", style = Tma.type.text14, color = Tma.colors.inkSecondary)
            Box {
                Text("…", style = Tma.type.text14, color = Tma.colors.inkSecondary, modifier = Modifier.clickable { more = true })
                DropdownMenu(expanded = more, onDismissRequest = { more = false }) {
                    hidden.forEach { c -> DropdownMenuItem(text = { Text(c.name, style = Tma.type.text14) }, onClick = { more = false; onCrumb(c.id) }) }
                }
            }
        }
        shown.forEachIndexed { i, c ->
            Text("/", style = Tma.type.text14, color = Tma.colors.inkSecondary)
            val last = i == shown.lastIndex
            Text(c.name, style = if (last) Tma.type.text14sb else Tma.type.text14, color = if (last) Tma.colors.ink else Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = if (last) Modifier else Modifier.clickable { onCrumb(c.id) })
        }
    }
}

@Composable
private fun Toolbar(ui: FilesUi, vm: FilesViewModel, phone: Boolean, onNewFolder: () -> Unit, onBulk: () -> Unit, onEmptyBin: () -> Unit) {
    val n = ui.selected.size
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Tma.space.s12), verticalAlignment = Alignment.CenterVertically) {
        if (n > 0) {
            Text("$n Selected", style = Tma.type.text14sb, color = Tma.colors.ink, modifier = Modifier.padding(horizontal = 8.dp))
            TmaIconButton(R.drawable.ic_dots_three, "Actions", onBulk)
            TmaIconButton(R.drawable.ic_x, "Clear selection", { vm.clearSelection() })
        } else {
            if (ui.canCreateHere) {
                TmaIconButton(R.drawable.ic_folder_plus, "New folder", onNewFolder)
                TmaIconButton(R.drawable.ic_cloud_arrow_up, "Upload files", {})
            }
            if (ui.clipboard != null && ui.canCreateHere) TextButton(onClick = { vm.paste() }) { Text("Paste (${ui.clipboard.items.size})", style = Tma.type.text14sb, color = Tma.colors.ink) }
            if (ui.isRecycle) TmaIconButton(R.drawable.ic_trash, "Empty recycle bin", onEmptyBin)
            if (!phone) TmaIconButton(if (ui.grid) R.drawable.ic_rows else R.drawable.ic_grid_four, if (ui.grid) "List view" else "Grid view", { vm.setGrid(!ui.grid) })
            TmaIconButton(if (ui.query.dir == "asc") R.drawable.ic_sort_ascending else R.drawable.ic_sort_descending, "Sort ${if (ui.query.dir == "asc") "descending" else "ascending"}", { vm.toggleDir() })
            TmaIconButton(R.drawable.ic_arrow_clockwise, "Refresh", { vm.load() })
            MenuControl(SORT_FIELDS, ui.query.sort, "Sort by") { vm.setSort(it) }
            val owners = ui.listing?.owners.orEmpty()
            if (owners.size >= 2) {
                val opts = listOf("" to "All owners") + owners.map { it.id.toString() to "${it.name} (${it.n})" }
                MenuControl(opts, ui.query.owner?.toString() ?: "", "Filter by owner") { vm.setOwner(it.toLongOrNull()) }
            }
        }
    }
}

@Composable
private fun MenuControl(options: List<Pair<String, String>>, current: String, label: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.hover).clickable { open = true }.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(options.firstOrNull { it.first == current }?.second ?: label, style = Tma.type.text12, color = Tma.colors.ink, fontWeight = FontWeight.SemiBold)
            Icon(painterResource(R.drawable.ic_arrow_line_down_16), contentDescription = label, tint = Tma.colors.inkSecondary, modifier = Modifier.size(12.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (v, l) -> DropdownMenuItem(text = { Text(l, style = Tma.type.text14) }, onClick = { open = false; onPick(v) }) }
        }
    }
}

@Composable
private fun TypePills(ui: FilesUi, vm: FilesViewModel) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Tma.space.s16, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        TYPE_PILLS.forEach { (key, label) ->
            val on = ui.query.type == key
            Box(Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(if (on) Tma.colors.ink else Tma.colors.hover).clickable { vm.setType(key) }.padding(horizontal = 10.dp, vertical = 5.dp)) {
                Text(label, style = Tma.type.text12, color = if (on) Tma.colors.surface else Tma.colors.ink)
            }
        }
    }
}

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = Tma.space.s16, vertical = 6.dp).clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.input).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(painterResource(R.drawable.ic_search_16), contentDescription = null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(16.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text("Search files", style = Tma.type.text14, color = Tma.colors.placeholder)
            BasicTextField(value = value, onValueChange = onChange, singleLine = true, textStyle = Tma.type.text14.copy(color = Tma.colors.ink), cursorBrush = SolidColor(Tma.colors.primary))
        }
        if (value.isNotEmpty()) Icon(painterResource(R.drawable.ic_x), contentDescription = "Clear", tint = Tma.colors.inkSecondary, modifier = Modifier.size(16.dp).clickable { onChange("") })
    }
}

/** portal-files.js renderEmpty: a search, the recycle bin, a locked package, or the section's own copy. */
@Composable
private fun EmptyListing(ui: FilesUi, onUpload: () -> Unit) {
    val (title, subtitle) = when {
        ui.query.search.isNotBlank() -> "No results for “${ui.query.search}”" to "Try a different search."
        ui.packageLocked -> "Original submission is locked" to "The original submission is locked. Open Additional Documents to upload new files."
        ui.canCreateHere -> ui.copy.empty to "Create a folder or upload files to get started."
        else -> ui.copy.empty to (ui.copy.emptyHint ?: "")
    }
    Column(Modifier.fillMaxWidth().padding(Tma.space.s32), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Tma.space.s8)) {
        Icon(painterResource(R.drawable.ic_folder_notch), contentDescription = null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(32.dp))
        Text(title, style = Tma.type.text14sb, color = Tma.colors.ink, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (subtitle.isNotBlank()) Text(subtitle, style = Tma.type.text14, color = Tma.colors.inkSecondary, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ListBody(ui: FilesUi, vm: FilesViewModel, phone: Boolean, onOpenFolder: (String?) -> Unit, onOpenFile: (FileItemDto) -> Unit, onMenu: (FileItemDto) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = Tma.space.s12, vertical = Tma.space.s8)) {
        if (!phone) item("head") { ListHeader(ui, vm) }
        items(ui.items, key = { it.type + ":" + it.id }) { it ->
            FileListRow(it, ui, phone, vm,
                onOpen = { if (ui.selected.isNotEmpty()) vm.toggleSelect(it.id) else if (it.isFolder) { vm.openFolder(it.id); onOpenFolder(it.id) } else onOpenFile(it) },
                onLongPress = { vm.toggleSelect(it.id) }, onMenu = { onMenu(it) })
        }
        if (ui.listing?.hasMore == true) item("more") {
            LaunchedEffect(Unit) { vm.loadMore() }
            Text("Loading more…", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.fillMaxWidth().padding(Tma.space.s12), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

@Composable
private fun ListHeader(ui: FilesUi, vm: FilesViewModel) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Spacer(Modifier.width(if (ui.isRecycle) 0.dp else 28.dp)); Spacer(Modifier.width(36.dp))
        SortHead("Name", "name", ui, vm, Modifier.weight(1f))
        SortHead("Type", "type", ui, vm, Modifier.width(90.dp))
        SortHead("Size", "size", ui, vm, Modifier.width(80.dp))
        Text("Shared with", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.width(110.dp))
        if (ui.isRecycle) Text("Deleted", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.width(110.dp)) else SortHead("Modified", "modified", ui, vm, Modifier.width(110.dp))
        Spacer(Modifier.width(40.dp))
    }
}

@Composable
private fun SortHead(label: String, key: String, ui: FilesUi, vm: FilesViewModel, modifier: Modifier) {
    val active = ui.query.sort == key
    Row(modifier.clickable { if (active) vm.toggleDir() else vm.setSort(key) }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = Tma.type.text12, color = if (active) Tma.colors.ink else Tma.colors.inkSecondary, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal)
        if (active) Text(if (ui.query.dir == "desc") "↓" else "↑", style = Tma.type.text12, color = Tma.colors.ink)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileListRow(it: FileItemDto, ui: FilesUi, phone: Boolean, vm: FilesViewModel, onOpen: () -> Unit, onLongPress: () -> Unit, onMenu: () -> Unit) {
    val selected = it.id in ui.selected
    val busy = it.id in ui.busy
    val typeLabel = if (it.isFolder) "Folder" else (it.category?.replaceFirstChar { c -> c.uppercase() } ?: "File")
    val size = if (it.isFolder) (it.sizeLabel ?: "-") else (it.sizeLabel ?: "-")
    val whenLabel = if (ui.isRecycle) fmtDate(it.deletedAt) else fmtDate(it.modifiedAt ?: it.createdAt)
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r12)).background(if (selected) Tma.colors.accentBg else Color.Transparent)
            .combinedClickable(onClick = onOpen, onLongClick = onLongPress).padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (!ui.isRecycle) StarButton(it.favorite) { vm.toggleStar(it) }
        FileGlyph(it, 28.dp)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(it.name, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                CommentChip(it); StatusChip(it)
                if (busy) Text("…", style = Tma.type.text12, color = Tma.colors.inkSecondary)
            }
            if (phone) Text(listOf(typeLabel + if (it.isFolder && it.packageLocked) " · View only" else "", size.takeIf { s -> s != "-" }, whenLabel.takeIf { w -> w != "-" }).filterNotNull().joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (!phone) {
            Text(typeLabel + if (it.isFolder && it.packageLocked) " · View only" else "", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.width(90.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(size, style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.width(80.dp))
            SharedWith(it, vm, Modifier.width(110.dp))
            Text(whenLabel, style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.width(110.dp))
        }
        TmaIconButton(R.drawable.ic_dots_three_vertical, "More actions", onMenu)
    }
}

@Composable
private fun GridBody(ui: FilesUi, vm: FilesViewModel, onOpenFolder: (String?) -> Unit, onOpenFile: (FileItemDto) -> Unit, onMenu: (FileItemDto) -> Unit) {
    LazyVerticalGrid(columns = GridCells.Adaptive(150.dp), contentPadding = PaddingValues(Tma.space.s12), horizontalArrangement = Arrangement.spacedBy(Tma.space.s12), verticalArrangement = Arrangement.spacedBy(Tma.space.s12), modifier = Modifier.fillMaxSize()) {
        items(ui.items, key = { it.type + ":" + it.id }) { it ->
            val selected = it.id in ui.selected
            val sub = if (it.isFolder) "${(it.fileCount ?: 0) + (it.folderCount ?: 0)} items" + (if (it.packageLocked) " · View only" else "") else (it.sizeLabel ?: "")
            Column(
                Modifier.clip(RoundedCornerShape(Tma.radius.r12)).background(if (selected) Tma.colors.accentBg else Tma.colors.card)
                    .combinedClickable(onClick = { if (ui.selected.isNotEmpty()) vm.toggleSelect(it.id) else if (it.isFolder) { vm.openFolder(it.id); onOpenFolder(it.id) } else onOpenFile(it) }, onLongClick = { vm.toggleSelect(it.id) })
                    .padding(Tma.space.s12),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    if (!ui.isRecycle) StarButton(it.favorite) { vm.toggleStar(it) } else Spacer(Modifier.width(1.dp))
                    TmaIconButton(R.drawable.ic_dots_three_vertical, "More actions", { onMenu(it) })
                }
                Box(Modifier.height(72.dp), contentAlignment = Alignment.Center) { FileGlyph(it, 40.dp, thumbSize = 72.dp) }
                Text(it.name, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Text(sub, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { CommentChip(it); StatusChip(it) }
            }
        }
        if (ui.listing?.hasMore == true) item(key = "more") { LaunchedEffect(Unit) { vm.loadMore() }; Text("Loading more…", style = Tma.type.text12, color = Tma.colors.inkSecondary) }
    }
}

@Composable
private fun StarButton(on: Boolean, onClick: () -> Unit) {
    Icon(painterResource(R.drawable.ic_star), contentDescription = if (on) "Remove from favourites" else "Add to favourites", tint = if (on) Tokens.Accent.yellow else Tma.colors.inkSecondary, modifier = Modifier.size(20.dp).clickable(onClick = onClick))
}

/** `comments:{open,unread,mentionsMe}` (portal-files.js commentChip). */
@Composable
fun CommentChip(it: FileItemDto) {
    val c = it.comments ?: return
    val count = if (c.unread > 0) c.unread else c.open
    if (count == 0) return
    Row(Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(if (c.unread > 0) Tma.colors.tint1 else Tma.colors.hover).padding(horizontal = 6.dp, vertical = 1.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        Icon(painterResource(R.drawable.ic_chat_circle), contentDescription = null, tint = Tma.colors.ink, modifier = Modifier.size(12.dp))
        Text(count.toString(), style = Tma.type.text12, color = Tma.colors.ink)
    }
}

/** `status:{label,tone}` (portal-files.js statusChip). */
@Composable
fun StatusChip(it: FileItemDto) {
    val s = it.status ?: return
    val label = s.label ?: return
    val tone = when (s.tone) { "success" -> Tokens.Accent.green; "danger" -> Tokens.Accent.red; "warning", "action" -> Tokens.Accent.orange; "pending" -> Tokens.Accent.yellow; else -> Tma.colors.inactive }
    Box(Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(tone.copy(alpha = 0.18f)).padding(horizontal = 8.dp, vertical = 1.dp)) {
        Text(label, style = Tma.type.text12, color = Tma.colors.ink, maxLines = 1)
    }
}

/** The "Shared with" cell: up to four faces and a count (person-card.js faces). */
@Composable
private fun SharedWith(it: FileItemDto, vm: FilesViewModel, modifier: Modifier) {
    val people = it.people
    if (people.isEmpty()) { Text("-", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = modifier); return }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy((-6).dp), verticalAlignment = Alignment.CenterVertically) {
        people.take(4).forEach { p -> PortalAvatar(url = vm.absolute(p.avatar), name = p.name ?: p.email, size = 22.dp) }
        val extra = (it.peopleTotal ?: people.size) - minOf(4, people.size)
        if (extra > 0) Text(" +$extra", style = Tma.type.text12, color = Tma.colors.inkSecondary)
    }
}

/** Folder glyph, the server thumbnail for images, else the type icon (portal-files.js thumbOrIcon). */
@Composable
fun FileGlyph(it: FileItemDto, size: androidx.compose.ui.unit.Dp, thumbSize: androidx.compose.ui.unit.Dp = size) {
    if (it.isFolder) {
        Icon(painterResource(if (it.looksEmpty) R.drawable.ic_folder else R.drawable.ic_folder_open), contentDescription = null, tint = folderColour(it.colour), modifier = Modifier.size(size))
        return
    }
    if (it.thumbUrl != null) {
        AsyncImage(model = it.thumbUrl, contentDescription = null, contentScale = androidx.compose.ui.layout.ContentScale.Crop, modifier = Modifier.size(thumbSize).clip(RoundedCornerShape(6.dp)))
        return
    }
    Icon(painterResource(PhosphorIcons.resolveOr(it.icon, R.drawable.ic_file)), contentDescription = null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(size))
}

@Composable
fun folderColour(key: String?): Color = when (key) {
    "blue" -> Tokens.Accent.blue; "green" -> Tokens.Accent.green; "pink" -> Tokens.Accent.pink
    "red" -> Tokens.Accent.red; "teal" -> Tokens.Accent.mint; else -> Tma.colors.primary
}

/** Today's time, otherwise the date (portal-files.js fmtDate). */
fun fmtDate(iso: String?): String = if (iso == null) "-" else TimeLabels.clockOrDate(iso, fallback = "-").let { if (it.matches(Regex("^[A-Z][a-z]{2} \\d+$"))) TimeLabels.clockOrDate(iso, "-") else it }
