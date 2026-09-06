package com.tmantoinelaw.portal.feature.files

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.data.files.FileItemDto
import com.tmantoinelaw.portal.core.data.files.ListingDto
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.icons.PhosphorIcons
import com.tmantoinelaw.portal.core.ui.theme.Tma
import kotlinx.coroutines.launch

/** Dialogs the listing can open. Copy is portal-files.js's, verbatim. */
sealed interface FilesDialog {
    data object NewFolder : FilesDialog
    data class Rename(val item: FileItemDto) : FilesDialog
    data class Delete(val item: FileItemDto) : FilesDialog
    data class ForceDelete(val item: FileItemDto) : FilesDialog
    data class BulkDelete(val items: List<FileItemDto>) : FilesDialog
    data class BulkForce(val items: List<FileItemDto>) : FilesDialog
    data object EmptyBin : FilesDialog
    data class Destination(val action: String, val items: List<FileItemDto>) : FilesDialog
}

private data class Entry(val label: String, val icon: String, val danger: Boolean = false, val sep: Boolean = false, val run: () -> Unit = {})

/** The single-item menu (portal-files.js contextItems), gated by the row's permissions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemActionsSheet(item: FileItemDto, ui: FilesUi, viewModel: FilesViewModel, onDismiss: () -> Unit, onOpen: () -> Unit, onDialog: (FilesDialog) -> Unit) {
    val entries = buildList {
        if (ui.isRecycle) {
            add(Entry("Restore", "ArrowCounterClockwise") { viewModel.restore(item) })
            add(Entry("Delete permanently", "Trash", danger = true) { onDialog(FilesDialog.ForceDelete(item)) })
            return@buildList
        }
        add(Entry(if (item.isFolder) "Open" else "Preview", if (item.isFolder) "FolderOpen" else "Eye") { onOpen() })
        if (item.can("download")) add(Entry(if (item.isFolder) "Download as ZIP" else "Download", "ArrowLineDown-16") { viewModel.download(item) })
        add(Entry("", "", sep = true))
        if (item.can("move")) add(Entry("Cut", "Scissors") { viewModel.cut(listOf(item)) })
        if (item.can("copy")) add(Entry("Copy", "Copy") { viewModel.copy(listOf(item)) })
        if (item.can("move")) add(Entry("Move to…", "ArrowsOutCardinal") { onDialog(FilesDialog.Destination("move", listOf(item))) })
        if (item.can("rename")) add(Entry("Rename", "PencilSimple") { onDialog(FilesDialog.Rename(item)) })
        add(Entry(if (item.favorite) "Remove from favourites" else "Add to favourites", "Star") { viewModel.toggleStar(item) })
        add(Entry("", "", sep = true))
        if (item.can("delete")) add(Entry("Delete", "Trash", danger = true) { onDialog(FilesDialog.Delete(item)) })
    }
    ActionSheet(title = item.name, entries = entries, onDismiss = onDismiss)
}

/** The multi-select menu (portal-files.js contextItemsMulti). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BulkActionsSheet(ui: FilesUi, viewModel: FilesViewModel, onDismiss: () -> Unit, onDialog: (FilesDialog) -> Unit) {
    val list = ui.selectedItems
    val n = list.size
    val count = "$n item${if (n == 1) "" else "s"}"
    fun all(ability: String) = list.all { it.can(ability) }
    val entries = buildList {
        if (ui.isRecycle) {
            add(Entry("Restore $count", "ArrowCounterClockwise") { viewModel.bulk("restore", list) })
            add(Entry("Delete permanently", "Trash", danger = true) { onDialog(FilesDialog.BulkForce(list)) })
            return@buildList
        }
        if (all("download")) add(Entry("Download $count", "ArrowLineDown-16") { list.forEach { viewModel.download(it) } })
        add(Entry("", "", sep = true))
        if (all("move")) add(Entry("Cut", "Scissors") { viewModel.cut(list) })
        if (all("copy")) add(Entry("Copy", "Copy") { viewModel.copy(list) })
        if (all("move")) add(Entry("Move to…", "ArrowsOutCardinal") { onDialog(FilesDialog.Destination("move", list)) })
        if (all("copy")) add(Entry("Copy to…", "Copy") { onDialog(FilesDialog.Destination("copy", list)) })
        add(Entry("", "", sep = true))
        add(Entry("Add to favourites", "Star") { viewModel.bulk("favorite", list) })
        if (all("delete")) add(Entry("Delete $count", "Trash", danger = true) { onDialog(FilesDialog.BulkDelete(list)) })
    }
    ActionSheet(title = "$n Selected", entries = entries, onDismiss = onDismiss)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActionSheet(title: String, entries: List<Entry>, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tma.colors.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = Tma.space.s24)) {
            Text(title, style = Tma.type.text14sb, color = Tma.colors.ink, modifier = Modifier.padding(horizontal = Tma.space.s20, vertical = Tma.space.s8), maxLines = 1)
            entries.forEachIndexed { i, e ->
                if (e.sep) { if (i > 0 && i < entries.lastIndex && !entries[i - 1].sep) HorizontalDivider(color = Tma.colors.borderSoft, modifier = Modifier.padding(vertical = 4.dp)); return@forEachIndexed }
                Row(Modifier.fillMaxWidth().clickable { onDismiss(); e.run() }.padding(horizontal = Tma.space.s20, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
                    Icon(painterResource(PhosphorIcons.resolveOr(e.icon, R.drawable.ic_dots_three)), contentDescription = null, tint = if (e.danger) Tma.colors.danger else Tma.colors.ink, modifier = Modifier.size(20.dp))
                    Text(e.label, style = Tma.type.text14, color = if (e.danger) Tma.colors.danger else Tma.colors.ink)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesDialogHost(dialog: FilesDialog, ui: FilesUi, viewModel: FilesViewModel, onDismiss: () -> Unit) {
    when (dialog) {
        FilesDialog.NewFolder -> NameDialog("New folder", "Folder name", "", "Untitled folder", "Create folder", onDismiss) { viewModel.createFolder(it) }
        is FilesDialog.Rename -> NameDialog("Rename ${if (dialog.item.isFolder) "folder" else "file"}", "Name", dialog.item.name, "", "Save", onDismiss) { viewModel.rename(dialog.item, it) }
        is FilesDialog.Delete -> Confirm("Move to recycle bin", "Move “${dialog.item.name}” to the recycle bin?" + if (dialog.item.isFolder) " Its contents go with it and can be restored." else "", "Move to bin", onDismiss) { viewModel.delete(dialog.item) }
        is FilesDialog.ForceDelete -> Confirm("Delete permanently", "Permanently delete “${dialog.item.name}”? This cannot be undone.", "Delete forever", onDismiss) { viewModel.forceDelete(dialog.item) }
        is FilesDialog.BulkDelete -> { val n = dialog.items.size; Confirm("Move to recycle bin", "Move $n item${if (n == 1) "" else "s"} to the recycle bin?", "Move to bin", onDismiss) { viewModel.bulk("delete", dialog.items) } }
        is FilesDialog.BulkForce -> { val n = dialog.items.size; Confirm("Delete permanently", "Permanently delete $n item${if (n == 1) "" else "s"}? This cannot be undone.", "Delete forever", onDismiss) { viewModel.bulk("forceDelete", dialog.items) } }
        FilesDialog.EmptyBin -> Confirm("Empty recycle bin", "Permanently delete everything in the recycle bin? This cannot be undone.", "Empty bin", onDismiss) { viewModel.emptyBin() }
        is FilesDialog.Destination -> DestinationPicker(if (dialog.action == "move") "Move to" else "Copy to", viewModel, onDismiss) { dest -> viewModel.bulk(dialog.action, dialog.items, dest) }
    }
}

@Composable
private fun NameDialog(title: String, label: String, initial: String, placeholder: String, confirm: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var value by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Tma.colors.surface,
        title = { Text(title, style = Tma.type.text18sb, color = Tma.colors.ink) },
        text = {
            OutlinedTextField(value = value, onValueChange = { if (it.length <= 255) value = it }, label = { Text(label) }, placeholder = { Text(placeholder) }, singleLine = true,
                keyboardActions = KeyboardActions(onDone = { if (value.isNotBlank()) { onSave(value.trim()); onDismiss() } }), modifier = Modifier.fillMaxWidth())
        },
        confirmButton = { Button(onClick = { if (value.isNotBlank()) { onSave(value.trim()); onDismiss() } }, colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.ink, contentColor = Tma.colors.surface)) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = Tma.colors.ink) } },
    )
}

@Composable
private fun Confirm(title: String, message: String, confirm: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Tma.colors.surface,
        title = { Text(title, style = Tma.type.text18sb, color = Tma.colors.ink) },
        text = { Text(message, style = Tma.type.text14, color = Tma.colors.inkSecondary) },
        confirmButton = { Button(onClick = { onConfirm(); onDismiss() }, colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.danger, contentColor = androidx.compose.ui.graphics.Color.White)) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = Tma.colors.ink) } },
    )
}

/** Move to / Copy to (portal-files.js openDestinationPicker): browse My Files by name, pick "here". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DestinationPicker(title: String, viewModel: FilesViewModel, onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    var folder by remember { mutableStateOf<String?>(null) }
    var listing by remember { mutableStateOf<ListingDto?>(null) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(folder) { listing = null; failed = false; listing = viewModel.pickerListing(folder).also { if (it == null) failed = true } }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tma.colors.surface) {
        Column(Modifier.padding(horizontal = Tma.space.s20).padding(bottom = Tma.space.s24), verticalArrangement = Arrangement.spacedBy(Tma.space.s8)) {
            Text(title, style = Tma.type.text18sb, color = Tma.colors.ink)
            Row(Modifier.fillMaxWidth().horizontalScrollIfNeeded(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Top level", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable { folder = null })
                listing?.breadcrumb?.forEach { c -> Text("/ ${c.name}", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable { folder = c.id }) }
            }
            Column(Modifier.heightIn(min = 120.dp, max = 360.dp).verticalScroll(rememberScrollState())) {
                when {
                    failed -> Text("Could not load folders.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
                    listing == null -> Text("Loading…", style = Tma.type.text14, color = Tma.colors.inkSecondary)
                    listing!!.folders.isEmpty() -> Text("No subfolders here.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
                    else -> listing!!.folders.forEach { f ->
                        Row(Modifier.fillMaxWidth().clickable { folder = f.id }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
                            FileGlyph(f, 20.dp); Text(f.name, style = Tma.type.text14, color = Tma.colors.ink)
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel", color = Tma.colors.ink) }
                Button(onClick = { scope.launch { onPick(folder); onDismiss() } }, colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.ink, contentColor = Tma.colors.surface)) { Text("${title.substringBefore(' ')} here") }
            }
        }
    }
}

private fun Modifier.horizontalScrollIfNeeded(): Modifier = this

/**
 * Stands in for the file viewer until it ships: the row's facts and its
 * actions, so a deep link to a file lands somewhere true.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilePeekSheet(id: String, item: FileItemDto?, viewModel: FilesViewModel, onDismiss: () -> Unit, onMenu: (FileItemDto) -> Unit) {
    var loaded by remember { mutableStateOf(item) }
    LaunchedEffect(id) { if (loaded == null) loaded = runCatching { viewModel.fetchFile(id) }.getOrNull() }
    val f = loaded
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tma.colors.surface) {
        Column(Modifier.padding(horizontal = Tma.space.s20).padding(bottom = Tma.space.s24), verticalArrangement = Arrangement.spacedBy(Tma.space.s8)) {
            if (f == null) { Text("Loading…", style = Tma.type.text14, color = Tma.colors.inkSecondary); return@Column }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
                FileGlyph(f, 40.dp)
                Column(Modifier.weight(1f)) {
                    Text(f.name, style = Tma.type.text18sb, color = Tma.colors.ink)
                    Text(listOfNotNull(f.category?.replaceFirstChar { it.uppercase() }, f.sizeLabel, fmtDate(f.modifiedAt ?: f.createdAt).takeIf { it != "-" }).joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                }
            }
            f.owner?.name?.let { Text("Owner: $it", style = Tma.type.text14, color = Tma.colors.inkSecondary) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tma.space.s8)) {
                if (f.can("download")) Button(onClick = { viewModel.download(f); onDismiss() }, colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.ink, contentColor = Tma.colors.surface)) { Text("Download") }
                TextButton(onClick = { onDismiss(); onMenu(f) }) { Text("More actions", color = Tma.colors.ink) }
            }
        }
    }
}
