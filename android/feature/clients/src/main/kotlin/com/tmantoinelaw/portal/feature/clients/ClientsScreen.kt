package com.tmantoinelaw.portal.feature.clients

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Snackbar
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tmantoinelaw.portal.core.data.cip.ApplicationDto
import com.tmantoinelaw.portal.core.data.cip.AssigneeDto
import com.tmantoinelaw.portal.core.data.cip.CompanyDto
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.CountChip
import com.tmantoinelaw.portal.core.ui.components.InitialsAvatar
import com.tmantoinelaw.portal.core.ui.components.SkeletonFileRow
import com.tmantoinelaw.portal.core.ui.components.TmaIconButton
import com.tmantoinelaw.portal.core.ui.components.ToneChip
import com.tmantoinelaw.portal.core.ui.components.toneColour
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.core.ui.theme.Tokens
import com.tmantoinelaw.portal.feature.shell.Layout
import com.tmantoinelaw.portal.feature.shell.PortalAvatar
import com.tmantoinelaw.portal.feature.shell.currentLayout

/**
 * The CIP Applications hub list (public/js/clients.js list screen): the tab
 * row, search and filters, the applications table (cards on a phone), the
 * providers and contacts tabs, and the pagination footer.
 */
@Composable
fun ClientsScreen(
    onOpenClient: (String) -> Unit,
    onOpenApplication: (ApplicationDto) -> Unit,
    onOpenCompany: (String) -> Unit,
    onCreate: (String) -> Unit,
    viewModel: ClientsViewModel = hiltViewModel(),
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val layout = currentLayout()
    val phone = layout == Layout.Compact

    Column(Modifier.fillMaxSize().background(Tma.colors.page)) {
        if (ui.tabs.isNotEmpty()) UnderlineTabs(
            tabs = ui.tabs.map { it.id to (if (phone && it.shortLabel != null) it.shortLabel else it.label) },
            active = ui.tab,
            counts = ui.tabs.associate { it.id to (if (ui.loading) null else ui.countFor(it)) },
            onPick = viewModel::setTab,
        )
        HubToolbar(ui, viewModel, phone, onCreate)
        Box(Modifier.weight(1f)) {
            when {
                ui.onProviders -> ProvidersBody(ui, viewModel, phone, onOpenCompany)
                ui.onPeople -> PeopleBody(ui, viewModel, phone, onOpenClient, onOpenCompany)
                else -> ApplicationsBody(ui, viewModel, layout, onOpenApplication)
            }
            ui.toast?.let { msg ->
                Snackbar(Modifier.align(Alignment.BottomCenter).padding(16.dp), action = { TextButton(onClick = viewModel::dismissToast) { Text("Dismiss") } }) { Text(msg) }
            }
        }
    }
}

/** `.tma-tab-group--underline`: label, optional count pill, 2 dp indicator under the active tab. */
@Composable
fun UnderlineTabs(tabs: List<Pair<String, String>>, active: String, onPick: (String) -> Unit, counts: Map<String, Int?> = emptyMap()) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp)) {
            tabs.forEach { (id, label) ->
                val on = id == active
                Column(
                    Modifier.clickable { onPick(id) }.padding(horizontal = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Row(Modifier.padding(top = 12.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(label, style = if (on) Tma.type.text14sb else Tma.type.text14, color = if (on) Tma.colors.ink else Tma.colors.inkSecondary, maxLines = 1)
                        counts[id]?.let { CountChip(it.toString()) }
                    }
                    Box(Modifier.fillMaxWidth().height(2.dp).background(if (on) Tma.colors.primary else Color.Transparent))
                }
            }
        }
        HorizontalDivider(color = Tma.colors.borderSoft)
    }
}

@Composable
private fun HubToolbar(ui: ClientsUi, vm: ClientsViewModel, phone: Boolean, onCreate: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        HubSearch(ui.query, vm::setQuery, Modifier.weight(1f))
        if (!ui.onProviders && !ui.onPeople) {
            if (ui.buckets.isNotEmpty()) FilterMenu("Status", ui.bucket, ui.buckets.map { Triple(it.key, it.label, it.count) }, { vm.toggleFilter("bucket", it) }, { vm.clearFilter("bucket") })
            ui.page?.let { p ->
                if (p.assignees.isNotEmpty() && !phone) FilterMenu("Assignee", ui.assignee, p.assignees.map { Triple((it.id ?: it.userId)?.toString() ?: "none", it.name, null) }, { vm.toggleFilter("assignee", it) }, { vm.clearFilter("assignee") })
                if (p.providers.isNotEmpty() && !phone) FilterMenu("Provider", ui.provider, p.providers.map { Triple(it.value, it.label, null) }, { vm.toggleFilter("provider", it) }, { vm.clearFilter("provider") })
            }
            if (phone) SortMenu(ui, vm)
        }
        CreateMenu(ui, phone, onCreate)
    }
}

@Composable
private fun HubSearch(value: String, onChange: (String) -> Unit, modifier: Modifier) {
    Row(modifier.height(36.dp).clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.input).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(painterResource(R.drawable.ic_search_16), contentDescription = null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(16.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text("Search", style = Tma.type.text14, color = Tma.colors.placeholder)
            BasicTextField(value, onChange, singleLine = true, textStyle = Tma.type.text14.copy(color = Tma.colors.ink), modifier = Modifier.fillMaxWidth())
        }
        if (value.isNotEmpty()) Icon(painterResource(R.drawable.ic_x), contentDescription = "Clear", tint = Tma.colors.inkSecondary, modifier = Modifier.size(14.dp).clickable { onChange("") })
    }
}

/** A filter popover (`.tma-filter-popover`): ticks, a count per row, Clear at the foot. */
@Composable
private fun FilterMenu(label: String, picked: Set<String>, items: List<Triple<String, String, Int?>>, onToggle: (String) -> Unit, onClear: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        ToolbarButton(if (picked.isEmpty()) label else "$label · ${picked.size}", R.drawable.ic_caret_down, active = picked.isNotEmpty()) { open = true }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            items.forEach { (id, name, count) ->
                DropdownMenuItem(
                    text = { Text(name, style = Tma.type.text14) },
                    leadingIcon = { Checkbox(checked = id in picked, onCheckedChange = null) },
                    trailingIcon = count?.let { { Text(it.toString(), style = Tma.type.text12, color = Tma.colors.inkSecondary) } },
                    onClick = { onToggle(id) },
                )
            }
            if (picked.isNotEmpty()) {
                HorizontalDivider(color = Tma.colors.borderSoft)
                DropdownMenuItem(text = { Text("Clear", style = Tma.type.text14) }, onClick = { onClear(); open = false })
            }
        }
    }
}

@Composable
private fun SortMenu(ui: ClientsUi, vm: ClientsViewModel) {
    var open by remember { mutableStateOf(false) }
    Box {
        TmaIconButton(if (ui.dir == "desc") R.drawable.ic_sort_descending else R.drawable.ic_sort_ascending, "Sort", onClick = { open = true })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            CIP_SORTS.forEach { (key, label) ->
                DropdownMenuItem(
                    text = { Text(label, style = if (ui.sort == key) Tma.type.text14sb else Tma.type.text14) },
                    trailingIcon = if (ui.sort == key) ({ Icon(painterResource(if (ui.dir == "desc") R.drawable.ic_arrow_fall else R.drawable.ic_arrow_rise), null, tint = Tma.colors.ink, modifier = Modifier.size(14.dp)) }) else null,
                    onClick = { vm.setSort(key); open = false },
                )
            }
        }
    }
}

/** "Create New Application" (clients.js head actions): a menu for staff, a single door for external users. */
@Composable
private fun CreateMenu(ui: ClientsUi, phone: Boolean, onCreate: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Button(
            onClick = { if (ui.external) onCreate("pre_approval") else open = true },
            colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.primary, contentColor = Tma.colors.onPrimary),
            shape = RoundedCornerShape(Tma.radius.pill),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = if (phone) 12.dp else 16.dp, vertical = 8.dp),
        ) {
            if (phone) Icon(painterResource(R.drawable.ic_plus), contentDescription = "Create New Application", modifier = Modifier.size(18.dp))
            else {
                Text("Create New Application", style = Tma.type.text14sb)
                if (!ui.external) { Spacer(Modifier.width(6.dp)); Icon(painterResource(R.drawable.ic_caret_down), null, modifier = Modifier.size(12.dp)) }
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("Create New Pre-Approval Application", style = Tma.type.text14) }, onClick = { open = false; onCreate("pre_approval") })
            DropdownMenuItem(text = { Text("Create New Post-Approval Application", style = Tma.type.text14) }, onClick = { open = false; onCreate("post_approval") })
            if (ui.canCreateBeyond) {
                DropdownMenuItem(text = { Text("New service provider", style = Tma.type.text14) }, onClick = { open = false; onCreate("company") })
                DropdownMenuItem(text = { Text("Import", style = Tma.type.text14) }, onClick = { open = false; onCreate("import") })
            }
        }
    }
}

@Composable
fun ToolbarButton(label: String, icon: Int?, active: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.height(36.dp).clip(RoundedCornerShape(Tma.radius.pill)).background(if (active) Tma.colors.tint1 else Tma.colors.input).clickable(onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(label, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1)
        icon?.let { Icon(painterResource(it), null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(12.dp)) }
    }
}

/* ---------- applications ---------- */

@Composable
private fun ApplicationsBody(ui: ClientsUi, vm: ClientsViewModel, layout: Layout, onOpen: (ApplicationDto) -> Unit) {
    val page = ui.page
    when {
        ui.error -> ClientsEmpty("Could not load applications", retry = vm::reload)
        ui.loading && (page == null || page.applications.isEmpty()) -> Column(Modifier.padding(horizontal = 16.dp)) { repeat(8) { SkeletonFileRow(avatar = true) } }
        page == null || page.applications.isEmpty() -> ClientsEmpty(
            when {
                ui.query.isNotBlank() -> "No results for “${ui.query.trim()}”"
                ui.anyFilter -> "No matches"
                ui.tab == "post_approval" -> "No post-approval applications"
                ui.tab == "pre_approval" -> "No pre-approval applications"
                else -> "No applications"
            },
        )
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
            if (layout != Layout.Compact) item { TableHead(ui, vm, layout) }
            items(page.applications, key = { it.id }) { a ->
                if (layout == Layout.Compact) ApplicationCard(a, ui, vm, onOpen) else ApplicationRow(a, ui, vm, layout, onOpen)
                HorizontalDivider(color = Tma.colors.borderSoft, modifier = Modifier.padding(horizontal = 16.dp))
            }
            if (page.lastPage > 1) item { Pagination(page.page, page.lastPage, page.total, vm::setPage) }
        }
    }
}

private data class Col(val key: String, val weight: Float, val medium: Boolean = true)
private val COLS = listOf(
    Col("number", 1.1f), Col("applicant", 1.7f), Col("provider", 1.2f), Col("contact", 1.1f, medium = false),
    Col("email", 1.4f, medium = false), Col("investment", 1f, medium = false), Col("family", 0.7f), Col("status", 1.1f), Col("assigned", 1f),
)

@Composable
private fun visibleCols(layout: Layout) = if (layout == Layout.Expanded) COLS else COLS.filter { it.medium }

@Composable
private fun TableHead(ui: ClientsUi, vm: ClientsViewModel, layout: Layout) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        visibleCols(layout).forEach { col ->
            val label = CIP_SORTS.first { it.first == col.key }.second
            Row(Modifier.weight(col.weight).clickable { vm.setSort(col.key) }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(label, style = Tma.type.text12, color = if (ui.sort == col.key) Tma.colors.ink else Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (ui.sort == col.key) Icon(painterResource(if (ui.dir == "desc") R.drawable.ic_arrow_fall else R.drawable.ic_arrow_rise), null, tint = Tma.colors.ink, modifier = Modifier.size(12.dp))
            }
        }
        Spacer(Modifier.width(40.dp))
    }
    HorizontalDivider(color = Tma.colors.borderMedium, modifier = Modifier.padding(horizontal = 16.dp))
}

@Composable
private fun ApplicationRow(a: ApplicationDto, ui: ClientsUi, vm: ClientsViewModel, layout: Layout, onOpen: (ApplicationDto) -> Unit) {
    val muted = Tma.colors.inkSecondary
    Row(Modifier.fillMaxWidth().clickable { onOpen(a) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        visibleCols(layout).forEach { col ->
            val m = Modifier.weight(col.weight).padding(end = 8.dp)
            when (col.key) {
                "number" -> Column(m) {
                    Text(a.number ?: "-", style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val internal = a.internalNumber
                    if (a.cipNumber != null && internal != null) Text(internal, style = Tma.type.text12, color = muted, maxLines = 1)
                }
                "applicant" -> ApplicantCell(a, vm, m)
                "provider" -> Text(a.provider ?: "-", style = Tma.type.text14, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = m)
                "contact" -> Text(a.contactPerson ?: "-", style = Tma.type.text14, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = m)
                "email" -> Text(a.contactEmail ?: "-", style = Tma.type.text14, color = if (a.contactEmail != null) Tma.colors.link else muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = m)
                "investment" -> Text(a.investmentType ?: "-", style = Tma.type.text14, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = m)
                "family" -> Text(a.familyLabel ?: "-", style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, modifier = m)
                "status" -> Box(m) { StatusCell(a, ui, vm) }
                "assigned" -> AssignedFaces(a.assignedTo, vm, m)
            }
        }
        RowMenu(a, ui, vm, onOpen)
    }
}

@Composable
private fun ApplicationCard(a: ApplicationDto, ui: ClientsUi, vm: ClientsViewModel, onOpen: (ApplicationDto) -> Unit) {
    Column(Modifier.fillMaxWidth().clickable { onOpen(a) }.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ApplicantCell(a, vm, Modifier.weight(1f))
            StatusCell(a, ui, vm)
            RowMenu(a, ui, vm, onOpen)
        }
        Text(listOfNotNull(a.number, a.provider, a.investmentType).joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            a.familyLabel?.let { Text(it, style = Tma.type.text12, color = Tma.colors.inkSecondary) }
            AssignedFaces(a.assignedTo, vm, Modifier)
        }
    }
}

/** clients.js applicantCell: face, unread dot, name, comment/message flags. */
@Composable
private fun ApplicantCell(a: ApplicationDto, vm: ClientsViewModel, modifier: Modifier) {
    val at = a.attention
    val waiting = at != null && (at.comments > 0 || at.messages > 0)
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box {
            PortalAvatar(url = vm.absolute(a.photo), name = a.applicantName, size = 26.dp)
            if (waiting) Box(Modifier.align(Alignment.TopEnd).size(8.dp).background(Tokens.Accent.red, CircleShape))
        }
        Text(a.applicantName ?: "-", style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        if (at != null && at.comments > 0) Icon(painterResource(R.drawable.ic_chat_circle), contentDescription = "Unread comments", tint = Tokens.Accent.red, modifier = Modifier.size(14.dp))
        if (at != null && at.messages > 0) Icon(painterResource(R.drawable.ic_chat_text), contentDescription = "Unread messages", tint = Tokens.Accent.red, modifier = Modifier.size(14.dp))
    }
}

/** The status chip; tappable into the transition menu when the server offered any. */
@Composable
private fun StatusCell(a: ApplicationDto, ui: ClientsUi, vm: ClientsViewModel) {
    if (a.statusLabel.isBlank()) return
    var open by remember { mutableStateOf(false) }
    val can = a.availableTransitions.isNotEmpty() && ui.busyId != a.id
    Box {
        ToneChip(a.statusLabel, a.statusTone, onClick = if (can) ({ open = true }) else null)
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            a.availableTransitions.forEach { t ->
                DropdownMenuItem(
                    text = { Text(t.label, style = Tma.type.text14) },
                    leadingIcon = { Box(Modifier.size(8.dp).background(toneColour(t.tone), CircleShape)) },
                    onClick = { open = false; vm.transition(a, t.value) },
                )
            }
        }
    }
}

/** person-card.js faces: up to three overlapping faces, else "Unassigned". */
@Composable
fun AssignedFaces(people: List<AssigneeDto>, vm: ClientsViewModel, modifier: Modifier) {
    if (people.isEmpty()) { Text("Unassigned", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = modifier); return }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy((-6).dp), verticalAlignment = Alignment.CenterVertically) {
        people.take(3).forEach { PortalAvatar(url = vm.absolute(it.avatar), name = it.name, size = 24.dp) }
        if (people.size > 3) Text(" +${people.size - 3}", style = Tma.type.text12, color = Tma.colors.inkSecondary)
    }
}

@Composable
private fun RowMenu(a: ApplicationDto, ui: ClientsUi, vm: ClientsViewModel, onOpen: (ApplicationDto) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TmaIconButton(R.drawable.ic_dots_three, "More actions", onClick = { open = true }, modifier = Modifier.size(32.dp))
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("Open", style = Tma.type.text14) }, onClick = { open = false; onOpen(a) })
            a.availableTransitions.forEach { t ->
                DropdownMenuItem(text = { Text(t.label, style = Tma.type.text14) }, leadingIcon = { Box(Modifier.size(8.dp).background(toneColour(t.tone), CircleShape)) }, onClick = { open = false; vm.transition(a, t.value) })
            }
        }
    }
}

/** `.tma-pagination-bar--footer`: "N applications", a five-page window, previous and next. */
@Composable
fun Pagination(page: Int, lastPage: Int, total: Int, onPage: (Int) -> Unit, noun: String = "application") {
    val start = maxOf(1, minOf(page - 2, lastPage - 4))
    val end = minOf(lastPage, start + 4)
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(plural(total, noun), style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.weight(1f))
        (start..end).forEach { p ->
            val on = p == page
            Box(Modifier.size(32.dp).clip(CircleShape).background(if (on) Tma.colors.primary else Color.Transparent).clickable { onPage(p) }, contentAlignment = Alignment.Center) {
                Text(p.toString(), style = Tma.type.text12, color = if (on) Tma.colors.onPrimary else Tma.colors.ink)
            }
        }
        TmaIconButton(R.drawable.ic_caret_left, "Previous page", onClick = { if (page > 1) onPage(page - 1) }, modifier = Modifier.size(32.dp), tint = if (page > 1) Tma.colors.ink else Tma.colors.inactive)
        TmaIconButton(R.drawable.ic_caret_right, "Next page", onClick = { if (page < lastPage) onPage(page + 1) }, modifier = Modifier.size(32.dp), tint = if (page < lastPage) Tma.colors.ink else Tma.colors.inactive)
    }
}

/* ---------- providers and contacts ---------- */

@Composable
private fun ProvidersBody(ui: ClientsUi, vm: ClientsViewModel, phone: Boolean, onOpenCompany: (String) -> Unit) {
    val rows = ui.providerRows()
    when {
        ui.companiesError -> ClientsEmpty("Couldn’t load your clients", retry = vm::reload)
        ui.loading && ui.companies == null -> Column(Modifier.padding(horizontal = 16.dp)) { repeat(8) { SkeletonFileRow(avatar = true) } }
        rows.isEmpty() -> ClientsEmpty(if (ui.query.isNotBlank()) "No results for “${ui.query.trim()}”" else "No service providers")
        else -> LazyColumn(Modifier.fillMaxSize()) {
            items(rows, key = { it.id }) { c ->
                Row(Modifier.fillMaxWidth().clickable { onOpenCompany(c.id) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CompanyAvatar(c, vm, 32.dp)
                    Column(Modifier.weight(1.6f)) {
                        Text(c.name.ifBlank { "Service provider" }, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (phone) Text(listOf(peopleSummary(c), c.email ?: c.phone ?: "-").joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (!phone) {
                        Text("Company", style = Tma.type.text14, color = Tma.colors.inkSecondary, modifier = Modifier.weight(0.8f))
                        Text(peopleSummary(c), style = Tma.type.text14, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text(c.email ?: c.phone ?: "-", style = Tma.type.text14, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1.2f))
                    }
                }
                HorizontalDivider(color = Tma.colors.borderSoft, modifier = Modifier.padding(horizontal = 16.dp))
            }
        }
    }
}

private fun peopleSummary(c: CompanyDto): String = plural(if (c.people.isNotEmpty()) c.people.size else c.peopleCount, "contact")

@Composable
fun CompanyAvatar(c: CompanyDto, vm: ClientsViewModel, size: androidx.compose.ui.unit.Dp) {
    if (c.logoUrl != null) PortalAvatar(url = vm.absolute(c.logoUrl), name = c.name, size = size)
    else Box(Modifier.size(size).clip(RoundedCornerShape(8.dp)).background(Tma.colors.hover), contentAlignment = Alignment.Center) {
        Icon(painterResource(R.drawable.ic_buildings), null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(size * 0.55f))
    }
}

@Composable
private fun PeopleBody(ui: ClientsUi, vm: ClientsViewModel, phone: Boolean, onOpenClient: (String) -> Unit, onOpenCompany: (String) -> Unit) {
    val rows = ui.peopleRows()
    when {
        ui.companiesError -> ClientsEmpty("Couldn’t load your clients", retry = vm::reload)
        ui.loading && ui.companies == null -> Column(Modifier.padding(horizontal = 16.dp)) { repeat(8) { SkeletonFileRow(avatar = true) } }
        rows.isEmpty() -> ClientsEmpty(if (ui.query.isNotBlank()) "No results for “${ui.query.trim()}”" else "No provider contacts")
        else -> LazyColumn(Modifier.fillMaxSize()) {
            items(rows, key = { it.company.id + "/" + it.person.id }) { r ->
                Row(Modifier.fillMaxWidth().clickable { onOpenClient(r.person.id) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    InitialsAvatar(name = r.person.name, size = 32.dp, seed = r.person.email ?: r.person.name)
                    Column(Modifier.weight(1.6f)) {
                        Text(r.person.name, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (phone) Text(listOfNotNull(r.company.name, r.person.email).joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (!phone) {
                        Text(r.company.name.ifBlank { "Service provider" }, style = Tma.type.text14, color = Tma.colors.link, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1.2f).clickable { onOpenCompany(r.company.id) })
                        Text(r.person.email ?: "-", style = Tma.type.text14, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1.2f))
                    }
                }
                HorizontalDivider(color = Tma.colors.borderSoft, modifier = Modifier.padding(horizontal = 16.dp))
            }
        }
    }
}

/** clientsEmpty(title): the hub's centred empty state. */
@Composable
fun ClientsEmpty(title: String, retry: (() -> Unit)? = null) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(painterResource(R.drawable.ic_users_three), null, tint = Tma.colors.inkMuted, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(12.dp))
        Text(title, style = Tma.type.text14, color = Tma.colors.inkSecondary)
        if (retry != null) TextButton(onClick = retry) { Text("Try again", style = Tma.type.text14sb, color = Tma.colors.primary) }
    }
}
