package com.tmantoinelaw.portal.feature.clients

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.tmantoinelaw.portal.core.data.cip.ApplicationDto
import com.tmantoinelaw.portal.core.data.cip.OptionDto
import com.tmantoinelaw.portal.core.data.cip.PersonDto
import com.tmantoinelaw.portal.core.data.cip.SlotDto
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.CountChip
import com.tmantoinelaw.portal.core.ui.components.SectionError
import com.tmantoinelaw.portal.core.ui.components.SkeletonFileRow
import com.tmantoinelaw.portal.core.ui.components.TmaIconButton
import com.tmantoinelaw.portal.core.ui.components.ToneChip
import com.tmantoinelaw.portal.core.ui.components.toneColour
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.core.ui.theme.Tokens
import com.tmantoinelaw.portal.feature.shell.Layout
import com.tmantoinelaw.portal.feature.shell.PortalAvatar
import com.tmantoinelaw.portal.feature.shell.currentLayout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * A client or CIP application profile (clients.js detail screen): the
 * toolbar, the tab row, the facts strip, and one panel per tab.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ClientProfileScreen(
    uid: String,
    askedTab: String?,
    onBack: () -> Unit,
    onOpenFolder: (String) -> Unit,
    onOpenFile: (String, String?) -> Unit,
    onOpenConversation: (String) -> Unit,
    onEdit: (String, String?) -> Unit,
    viewModel: ClientProfileViewModel = hiltViewModel(key = "client:$uid"),
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    LaunchedEffect(uid, askedTab) { viewModel.load(uid, askedTab) }
    LaunchedEffect(Unit) { viewModel.openConversation.collect { onOpenConversation(it) } }
    val phone = currentLayout() == Layout.Compact
    var pending by remember { mutableStateOf<OptionDto?>(null) }

    Box(Modifier.fillMaxSize().background(Tma.colors.page)) {
        Column(Modifier.fillMaxSize()) {
            when {
                ui.error -> {
                    Row(Modifier.padding(8.dp)) { TmaIconButton(R.drawable.ic_arrow_left, "Back", onClick = onBack) }
                    SectionError(onRetry = { viewModel.load(uid, askedTab, quiet = true) }, modifier = Modifier.padding(16.dp))
                }
                ui.loading && ui.client == null && ui.app == null -> {
                    Row(Modifier.padding(8.dp)) { TmaIconButton(R.drawable.ic_arrow_left, "Back", onClick = onBack) }
                    Column(Modifier.padding(horizontal = 16.dp)) { repeat(6) { SkeletonFileRow(avatar = true) } }
                }
                else -> {
                    ProfileHeader(ui, viewModel, onBack, onOpenFolder, onEdit)
                    UnderlineTabs(ui.tabs(), ui.tab, viewModel::setTab)
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        val app = ui.app
                        if (app != null) FactsStrip(app, viewModel, phone, onTransition = { pending = it })
                        when (ui.tab) {
                            "overview" -> app?.let { OverviewPanel(it, viewModel, phone) }
                            "applicant" -> app?.applicant?.let { PersonCard(it, app, viewModel, phone, onOpenFile) }
                            "sponsor" -> app?.sponsor?.let { PersonCard(it, app, viewModel, phone, onOpenFile) }
                            "dependents" -> app?.dependents?.forEach { PersonCard(it, app, viewModel, phone, onOpenFile) }
                            "activity" -> ActivityPanel(ui, viewModel)
                            "folders" -> FoldersPanel(ui, onOpenFolder)
                            "assigned" -> AssignedPanel(ui, viewModel)
                            "messages" -> MessagesPanel(ui, viewModel, onOpenConversation)
                            "access" -> AccessPanel(ui, viewModel)
                            "info" -> InfoPanel(ui, phone)
                        }
                        Spacer(Modifier.height(24.dp))
                    }
                }
            }
        }
        ui.toast?.let { msg ->
            Snackbar(Modifier.align(Alignment.BottomCenter).padding(16.dp), action = { TextButton(onClick = viewModel::dismissToast) { Text("Dismiss") } }) { Text(msg) }
        }
    }
    pending?.let { option ->
        TransitionSheet(option, onDismiss = { pending = null }, onConfirm = { note -> viewModel.transition(option.value, note); pending = null })
    }
}

/** clients.js renderContactProfileToolbar: back, face, name + status, then Open folder / Edit / Message. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProfileHeader(ui: ProfileUi, vm: ClientProfileViewModel, onBack: () -> Unit, onOpenFolder: (String) -> Unit, onEdit: (String, String?) -> Unit) {
    val app = ui.app
    val client = ui.client
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TmaIconButton(R.drawable.ic_arrow_left, "Back", onClick = onBack)
            PortalAvatar(url = vm.absolute(ui.photo), name = ui.name, size = 40.dp)
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(ui.name, style = Tma.type.text18sb, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (app != null && app.statusLabel.isNotBlank()) ToneChip(app.statusLabel, app.statusTone)
                }
                if (app == null && client != null) {
                    val subtitle = listOfNotNull(client.clientTypeLabel, client.companyName).joinToString(" · ")
                    if (subtitle.isNotBlank()) Text(subtitle, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        FlowRow(Modifier.padding(start = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ui.folderUuid?.let { ActionButton("Open folder", R.drawable.ic_folder_notch) { onOpenFolder(it) } }
            ActionButton("Edit", R.drawable.ic_pencil_simple) { onEdit(ui.uid, app?.id) }
            MessageMenu(ui, vm)
        }
    }
    HorizontalDivider(color = Tma.colors.borderSoft)
}

/** `.tma-dash__clients-message-btn`: a pill with a leading 16 dp icon. */
@Composable
fun ActionButton(label: String, icon: Int, enabled: Boolean = true, trailing: Int? = null, onClick: () -> Unit) {
    Row(
        Modifier.height(36.dp).clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.input).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(painterResource(icon), null, tint = if (enabled) Tma.colors.ink else Tma.colors.inactive, modifier = Modifier.size(16.dp))
        Text(label, style = Tma.type.text14, color = if (enabled) Tma.colors.ink else Tma.colors.inactive, maxLines = 1)
        trailing?.let { Icon(painterResource(it), null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(12.dp)) }
    }
}

private fun JsonObject?.str(key: String): String? = this?.get(key)?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }
private fun JsonObject?.bool(key: String): Boolean = this?.get(key)?.let { runCatching { it.jsonPrimitive.booleanOrNull }.getOrNull() } == true
private fun JsonObject?.obj(key: String): JsonObject? = this?.get(key) as? JsonObject

/** clients.js renderMessageChooser: message the provider about the applicant, or the person directly. */
@Composable
private fun MessageMenu(ui: ProfileUi, vm: ClientProfileViewModel) {
    var open by remember { mutableStateOf(false) }
    val options = ui.conversations?.options
    Box {
        ActionButton("Message", R.drawable.ic_chat_circle_text, enabled = !ui.busy, trailing = R.drawable.ic_caret_down) { open = true }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (options == null) {
                DropdownMenuItem(text = { Text(if (ui.conversationsFailed) "Could not load messaging options." else "Loading…", style = Tma.type.text14, color = Tma.colors.inkSecondary) }, onClick = {}, enabled = false)
            } else {
                val provider = options.obj("provider")
                val person = options.obj("person")
                if (provider.bool("available")) {
                    val company = provider.str("companyName")
                    DropdownMenuItem(text = { Text(if (company != null) "Message $company about ${ui.name.ifBlank { "this applicant" }}" else "Message the service provider", style = Tma.type.text14) }, onClick = { open = false; vm.openConversation("provider") })
                } else provider.str("reason")?.let { DropdownMenuItem(text = { Text(it, style = Tma.type.text14, color = Tma.colors.inkSecondary) }, onClick = {}, enabled = false) }
                if (person.bool("available")) {
                    DropdownMenuItem(text = { Text("Message ${person.str("name") ?: ui.name}", style = Tma.type.text14) }, onClick = { open = false; vm.openConversation("person") })
                } else person.str("reason")?.let { DropdownMenuItem(text = { Text(it, style = Tma.type.text14, color = Tma.colors.inkSecondary) }, onClick = {}, enabled = false) }
            }
        }
    }
}

/* ---------- facts strip ---------- */

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FactsStrip(app: ApplicationDto, vm: ClientProfileViewModel, phone: Boolean, onTransition: (OptionDto) -> Unit) {
    val decision = app.milestones.firstOrNull { it.key == "decision" }
    fun date(key: String) = app.milestones.firstOrNull { it.key == key }?.date?.let(::fmtShortDate).orEmpty()
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), maxItemsInEachRow = if (phone) 2 else 4) {
            val m = Modifier.weight(1f)
            val cip = app.cipNumber
            if (cip != null) Fact("CIP application number", cip, m) else Fact("Application number", app.internalNumber ?: app.number ?: "", m)
            Fact("Submitted", date("submitted").ifBlank { "-" }, m)
            Fact("Accepted", date("accepted").ifBlank { "-" }, m)
            date("decision").takeIf { it.isNotBlank() }?.let { Fact(if (decision?.reached == true) decision.label.ifBlank { "Decision" } else "Decision", it, m) }
            app.investmentType?.let { Fact("Investment", it, m) }
            app.provider?.let { Fact("Referred by", it, m) }
            Column(m) {
                Text("Assigned", style = Tma.type.text12, color = Tma.colors.inkSecondary)
                Faces(app, vm)
            }
        }
        if (app.availableTransitions.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            app.availableTransitions.forEach { t ->
                Row(Modifier.height(32.dp).clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.input).clickable { onTransition(t) }.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(8.dp).background(toneColour(t.tone), CircleShape))
                    Text(t.label, style = Tma.type.text12, color = Tma.colors.ink)
                }
            }
        }
    }
}

@Composable
private fun Fact(label: String, value: String, modifier: Modifier) {
    if (value.isBlank()) return
    Column(modifier) {
        Text(label, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(value, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Faces(app: ApplicationDto, vm: ClientProfileViewModel) {
    val people = app.assignedTo.ifEmpty { listOfNotNull(app.assignedOfficer) }
    if (people.isEmpty()) { Text("Unassigned", style = Tma.type.text14, color = Tma.colors.inkSecondary); return }
    Row(horizontalArrangement = Arrangement.spacedBy((-6).dp), verticalAlignment = Alignment.CenterVertically) {
        people.take(4).forEach { PortalAvatar(url = vm.absolute(it.avatar), name = it.name, size = 24.dp) }
        if (people.size > 4) Text(" +${people.size - 4}", style = Tma.type.text12, color = Tma.colors.inkSecondary)
    }
}

/* ---------- overview ---------- */

private data class DocStats(val total: Int, val filed: Int, val pending: Int, val review: Int, val update: Int, val ready: Int)

private fun docStats(p: PersonDto): DocStats {
    val docs = p.documents
    return DocStats(
        total = docs.size, filed = docs.count { it.uploaded }, pending = docs.count { !it.uploaded },
        review = docs.count { it.uploaded && it.status == "application_review" },
        update = docs.count { it.uploaded && it.status == "update_required" },
        ready = docs.count { it.uploaded && it.status == "ready_for_submission" },
    )
}

private fun family(app: ApplicationDto): List<PersonDto> = listOfNotNull(app.applicant, app.sponsor) + app.dependents

private fun familyComposition(app: ApplicationDto): String {
    val parts = mutableListOf<String>()
    if (app.applicant != null) parts += "1 Main Applicant"
    if (app.sponsor != null) parts += "1 Sponsor"
    val n = app.dependents.size
    if (n > 0) parts += if (n == 1) "1 Dependent" else "$n Dependents"
    if (parts.isEmpty()) return ""
    return parts.joinToString(" + ") + (app.familyLabel?.let { " = $it" } ?: "")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun OverviewPanel(app: ApplicationDto, vm: ClientProfileViewModel, phone: Boolean) {
    val people = family(app)
    val filed = people.sumOf { docStats(it).filed }
    val total = people.sumOf { docStats(it).total }
    val updates = people.flatMap { p -> p.documents.filter { it.status == "update_required" && !it.updateReason.isNullOrBlank() }.map { p to it } }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp), maxItemsInEachRow = if (phone) 1 else 2) {
        val m = Modifier.weight(1f)
        ProfileCard("Application", modifier = m) {
            OverviewRow("Application number", app.internalNumber ?: app.number ?: "")
            OverviewRow("CIP application number", app.cipNumber ?: "")
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Status", style = Tma.type.text14, color = Tma.colors.inkSecondary)
                if (app.statusLabel.isNotBlank()) ToneChip(app.statusLabel, app.statusTone)
            }
            OverviewRow("Investment", app.investmentType ?: "")
            OverviewRow("Referred by", app.provider ?: "")
            OverviewRow("Sponsored", if (app.sponsored) "Yes" else "No")
        }
        if (app.milestones.isNotEmpty()) ProfileCard("Timeline", modifier = m) {
            app.milestones.forEach { OverviewRow(it.label, it.date?.let(::fmtShortDate)?.ifBlank { "-" } ?: "-", muted = !it.reached) }
        }
        val lead = familyComposition(app)
        if (lead.isNotBlank() || people.isNotEmpty()) ProfileCard("Family", count = app.familyLabel ?: people.size.toString(), modifier = m) {
            if (lead.isNotBlank()) Text(lead, style = Tma.type.text14, color = Tma.colors.ink, modifier = Modifier.padding(bottom = 6.dp))
            people.forEach { OverviewRow(it.name.ifBlank { "-" }, it.label) }
        }
        if (people.isNotEmpty()) ProfileCard("Documents", count = if (total > 0) "$filed / $total" else null, modifier = m) {
            people.forEach { p -> val s = docStats(p); OverviewRow(p.name.ifBlank { p.label.ifBlank { "-" } }, "${s.filed} / ${s.total}") }
        }
        ProfileCard("Document status", modifier = m) {
            OverviewRow("Pending upload", people.sumOf { docStats(it).pending }.toString())
            OverviewRow("Application review", people.sumOf { docStats(it).review }.toString())
            OverviewRow("Update required", people.sumOf { docStats(it).update }.toString())
            OverviewRow("Ready for submission", people.sumOf { docStats(it).ready }.toString())
        }
        if (updates.isNotEmpty()) ProfileCard("Updates required", count = updates.size.toString(), modifier = m) {
            updates.forEach { (p, d) -> OverviewRow((if (p.name.isNotBlank()) p.name + " · " else "") + d.label.ifBlank { "Document" }, d.updateReason ?: "") }
        }
        ProfileCard("Assigned", count = app.assignedTo.size.toString(), modifier = m) {
            Box(Modifier.padding(bottom = 8.dp)) { Faces(app, vm) }
            app.assignedTo.forEach { OverviewRow(it.name.ifBlank { "-" }, it.roles.firstOrNull() ?: "") }
        }
    }
}

/** companyCard(title, body, {count}). */
@Composable
fun ProfileCard(title: String, count: String? = null, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
            Text(title, style = Tma.type.text14sb, color = Tma.colors.ink)
            count?.takeIf { it.isNotBlank() }?.let { CountChip(it) }
        }
        content()
    }
}

@Composable
fun OverviewRow(label: String, value: String, muted: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
        Text(label, style = Tma.type.text14, color = Tma.colors.inkSecondary, modifier = Modifier.weight(1f))
        Text(value, style = Tma.type.text14, color = if (muted) Tma.colors.inkMuted else Tma.colors.ink, textAlign = androidx.compose.ui.text.style.TextAlign.End, modifier = Modifier.weight(1f))
    }
}

/* ---------- person card ---------- */

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PersonCard(person: PersonDto, app: ApplicationDto, vm: ClientProfileViewModel, phone: Boolean, onOpenFile: (String, String?) -> Unit) {
    val postApproval = app.phase == "post_approval"
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(person.label.ifBlank { person.applicantTypeLabel ?: "Applicant" }, style = Tma.type.text14sb, color = Tma.colors.ink)
                Text(person.name.ifBlank { "-" }, style = Tma.type.text14, color = Tma.colors.inkSecondary)
            }
            if (postApproval) ToneChip(person.statusLabel ?: "Not started", person.statusTone ?: "neutral")
        }
        val fields = listOfNotNull(
            person.passportNumber?.let { Triple(R.drawable.ic_user_list, "Passport number", it) },
            person.gender?.let { Triple(R.drawable.ic_users, "Gender", it) },
            person.dateOfBirth?.let { Triple(R.drawable.ic_calendar_blank, "Date of birth", it) },
            person.countryOfBirth?.let { Triple(R.drawable.ic_flag, "Country of birth", it) },
            person.countryOfResidence?.let { Triple(R.drawable.ic_house, "Country of residence", it) },
            person.region?.let { Triple(R.drawable.ic_flag, "Region", it) },
            person.occupation?.let { Triple(R.drawable.ic_buildings, "Occupation", it) },
        )
        val photo = person.passportPhotoUrl ?: person.photo
        FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = if (phone) 1 else 3) {
            if (photo != null) AsyncImage(model = vm.absolute(photo), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(96.dp).clip(RoundedCornerShape(8.dp)))
            else PortalAvatar(url = null, name = person.name, size = 72.dp)
            fields.forEach { (icon, label, value) -> ListItemRow(icon, label, value, Modifier.weight(1f)) }
        }
        Checklist(person, app, vm, onOpenFile)
    }
}

/** renderListItem: a 16 dp icon, the label above the value. */
@Composable
fun ListItemRow(icon: Int, label: String, value: String, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        Icon(painterResource(icon), null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(16.dp).padding(top = 2.dp))
        Column {
            Text(label, style = Tma.type.text12, color = Tma.colors.inkSecondary)
            Text(value, style = Tma.type.text14, color = Tma.colors.ink)
        }
    }
}

/** renderCipChecklist + renderChecklistRow. */
@Composable
private fun Checklist(person: PersonDto, app: ApplicationDto, vm: ClientProfileViewModel, onOpenFile: (String, String?) -> Unit) {
    val docs = person.documents
    val postApproval = app.phase == "post_approval"
    if (docs.isEmpty()) {
        if (!postApproval) return
        Text("Documents", style = Tma.type.text14sb, color = Tma.colors.ink)
        Text("No document requirements are assigned to this person for post-approval. Configure them in Settings → Document Requirements.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
        return
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Documents", style = Tma.type.text14sb, color = Tma.colors.ink)
        CountChip(docs.count { it.uploaded }.toString())
    }
    docs.forEach { d -> ChecklistRow(d, vm, onOpenFile) }
}

@Composable
private fun ChecklistRow(d: SlotDto, vm: ClientProfileViewModel, onOpenFile: (String, String?) -> Unit) {
    val filed = d.uploaded
    val status = if (filed) d.statusLabel.ifBlank { "Filed" } else "Pending upload"
    val tone = if (filed) (d.statusTone ?: "success") else "neutral"
    val opens = filed && d.fileId != null
    Column(Modifier.fillMaxWidth().then(if (opens) Modifier.clickable { onOpenFile(d.fileId!!, null) } else Modifier).padding(vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Checkbox(checked = filed, onCheckedChange = null, enabled = false, modifier = Modifier.size(20.dp))
            if (d.thumbUrl != null) AsyncImage(model = vm.absolute(d.thumbUrl), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(28.dp).clip(RoundedCornerShape(4.dp)))
            else Icon(painterResource(if (d.fileExt == "pdf") R.drawable.ic_file_pdf else R.drawable.ic_file), null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(20.dp))
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(d.label, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (opens) Icon(painterResource(R.drawable.ic_arrow_up_right), null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(12.dp))
                if (!d.required) Text("Optional", style = Tma.type.text12, color = Tma.colors.inkSecondary)
            }
            if (d.comments > 0) Row(Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.hover).padding(horizontal = 6.dp, vertical = 1.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                Icon(painterResource(R.drawable.ic_chat_circle), null, tint = Tma.colors.ink, modifier = Modifier.size(12.dp))
                Text(d.comments.toString(), style = Tma.type.text12, color = Tma.colors.ink)
            }
            ToneChip(status, tone)
        }
        val reason = d.updateReason
        if (d.status == "update_required" && !reason.isNullOrBlank()) Text(reason, style = Tma.type.text12, color = Tokens.Accent.red, modifier = Modifier.padding(start = 28.dp, top = 2.dp))
    }
}

/* ---------- activity ---------- */

@Composable
private fun ActivityPanel(ui: ProfileUi, vm: ClientProfileViewModel) {
    val events = ui.events
    when {
        ui.eventsFailed -> PanelEmpty("Could not load the history.")
        events == null -> PanelEmpty("Loading the history…")
        events.isEmpty() -> PanelEmpty("Nothing has happened yet.")
        else -> Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(horizontal = 16.dp, vertical = 4.dp)) {
            events.forEach { e ->
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PortalAvatar(url = vm.absolute(e.who?.avatar), name = e.who?.name ?: "?", size = 24.dp)
                    Text(e.what, style = Tma.type.text14, color = Tma.colors.ink, modifier = Modifier.weight(1f))
                    Text(fmtDateTime(e.`when`), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                }
            }
        }
    }
}

/** `.tma-dash__clients-assigned-empty`. */
@Composable
fun PanelEmpty(text: String) {
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(24.dp), contentAlignment = Alignment.Center) {
        Text(text, style = Tma.type.text14, color = Tma.colors.inkSecondary)
    }
}

/** The status transition sheet: the chosen status and an optional note (`POST …/status {status, note}`). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TransitionSheet(option: OptionDto, onDismiss: () -> Unit, onConfirm: (String?) -> Unit) {
    var note by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tma.colors.popup) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(10.dp).background(toneColour(option.tone), CircleShape))
                Text("Change status to ${option.label}", style = Tma.type.text18sb, color = Tma.colors.ink)
            }
            OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("Note (optional)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Button(onClick = { onConfirm(note) }, colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.primary, contentColor = Tma.colors.onPrimary)) { Text(option.label) }
            }
        }
    }
}
