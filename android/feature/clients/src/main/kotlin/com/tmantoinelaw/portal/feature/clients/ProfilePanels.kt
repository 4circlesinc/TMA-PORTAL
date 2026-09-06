package com.tmantoinelaw.portal.feature.clients

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.data.cip.AssigneeDto
import com.tmantoinelaw.portal.core.data.cip.AssignmentDto
import com.tmantoinelaw.portal.core.data.cip.ConversationRowDto
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.SectionError
import com.tmantoinelaw.portal.core.ui.components.TmaIconButton
import com.tmantoinelaw.portal.core.ui.components.ToneChip
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.core.ui.theme.Tokens
import com.tmantoinelaw.portal.feature.shell.PortalAvatar
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

private fun JsonObject?.str(key: String): String? = this?.get(key)?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }
private fun JsonObject?.bool(key: String): Boolean = this?.get(key)?.let { runCatching { it.jsonPrimitive.booleanOrNull }.getOrNull() } == true
private fun JsonObject?.obj(key: String): JsonObject? = this?.get(key) as? JsonObject
private fun JsonObject?.objects(key: String): List<JsonObject> = (this?.get(key) as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

/* ---------- Documents ---------- */

/** renderFoldersPanel: the client folder lives in the File Library; this panel is its door. */
@Composable
fun FoldersPanel(ui: ProfileUi, onOpenFolder: (String) -> Unit) {
    val uuid = ui.folderUuid
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Client documents", style = Tma.type.text14sb, color = Tma.colors.ink)
        if (uuid == null) Text("This client’s folder isn’t ready yet.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
        else {
            if (ui.app?.locked == true) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(painterResource(R.drawable.ic_info), null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(16.dp))
                Text("The original submission is locked. New files go in Additional Documents.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
            }
            ActionButton("Open in File Library", R.drawable.ic_folder_notch) { onOpenFolder(uuid) }
        }
    }
}

/* ---------- Assigned ---------- */

/** renderAssignedPanel: the count, the admin's assign form, the rows, the ended ones. */
@Composable
fun AssignedPanel(ui: ProfileUi, vm: ClientProfileViewModel) {
    val a = ui.assignments
    if (ui.assignmentsFailed) { SectionError(onRetry = vm::loadAssignments); return }
    if (a == null) { PanelEmpty("Loading assigned staff…"); return }
    val items = a.assignments
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(plural(items.size, "assigned staff member"), style = Tma.type.text14sb, color = Tma.colors.ink)
        if (ui.isAdmin) AssignForm(a.assignable.filter { s -> items.none { it.userId == s.userKey } }, a.roles.map { it.value to it.label }, ui.busy, vm)
        if (items.isEmpty()) Text("No staff assigned to this client yet.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
        items.forEach { AssignedRow(it, ui, vm, live = true) }
        if (a.history.isNotEmpty()) {
            Text("Previously assigned", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.padding(top = 8.dp))
            a.history.forEach { AssignedRow(it, ui, vm, live = false) }
        }
    }
}

@Composable
private fun AssignForm(unassigned: List<AssigneeDto>, roles: List<Pair<String, String>>, busy: Boolean, vm: ClientProfileViewModel) {
    var pick by remember { mutableStateOf<AssigneeDto?>(null) }
    var role by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf(false) }
    var roleOpen by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.weight(1f)) {
            ToolbarButton(pick?.name ?: "Assign staff…", R.drawable.ic_caret_down) { open = true }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                if (unassigned.isEmpty()) DropdownMenuItem(text = { Text("Everyone is already assigned", style = Tma.type.text14, color = Tma.colors.inkSecondary) }, onClick = {}, enabled = false)
                unassigned.forEach { s ->
                    DropdownMenuItem(text = { Text(s.name, style = Tma.type.text14) }, leadingIcon = { PortalAvatar(url = vm.absolute(s.avatar), name = s.name, size = 24.dp) }, onClick = { pick = s; open = false })
                }
            }
        }
        if (roles.isNotEmpty()) Box {
            ToolbarButton(roles.firstOrNull { it.first == role }?.second ?: "Role", R.drawable.ic_caret_down) { roleOpen = true }
            DropdownMenu(expanded = roleOpen, onDismissRequest = { roleOpen = false }) {
                roles.forEach { (v, l) -> DropdownMenuItem(text = { Text(l, style = Tma.type.text14) }, onClick = { role = v; roleOpen = false }) }
            }
        }
        Button(
            onClick = { pick?.let { p -> p.userKey?.let { vm.assign(it, role); pick = null } } },
            enabled = pick != null && !busy,
            colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.primary, contentColor = Tma.colors.onPrimary),
            shape = RoundedCornerShape(Tma.radius.pill),
        ) { Text("Assign", style = Tma.type.text14sb) }
    }
}

/** renderAssignedStaffRow: face, name, "Primary · role · level · email", the admin's trash. */
@Composable
private fun AssignedRow(p: AssignmentDto, ui: ProfileUi, vm: ClientProfileViewModel, live: Boolean) {
    val meta = buildList {
        if (p.primary) add("Primary")
        (p.roleLabel ?: p.level)?.let { add(it) }
        if (p.roleLabel != null) p.level?.let { add(it) }
        if (!live) p.endedAt?.let { add("Ended " + fmtShortDate(it)) } ?: p.endsAt?.let { add("Ended " + fmtShortDate(it)) }
        p.email?.let { add(it) }
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        PortalAvatar(url = vm.absolute(p.avatar), name = p.name, size = 32.dp)
        Column(Modifier.weight(1f)) {
            Text(p.name ?: "Staff", style = Tma.type.text14, color = if (live) Tma.colors.ink else Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(meta.joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        val userId = p.userId
        if (live && ui.isAdmin && userId != null) TmaIconButton(R.drawable.ic_trash, "End assignment", onClick = { vm.unassign(userId) }, modifier = Modifier.size(32.dp), tint = Tma.colors.inkSecondary)
    }
}

/* ---------- Messages ---------- */

@Composable
fun MessagesPanel(ui: ProfileUi, vm: ClientProfileViewModel, onOpen: (String) -> Unit) {
    val c = ui.conversations
    if (ui.conversationsFailed) { PanelEmpty("Could not load messaging options."); return }
    if (c == null) { PanelEmpty("Loading…"); return }
    if (c.conversations.isEmpty()) {
        val provider = c.options.obj("provider").bool("available")
        PanelEmpty(if (provider) "No conversations on this file yet. Use Message to start one with the service provider." else "No conversations on this file yet.")
        return
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(horizontal = 16.dp, vertical = 4.dp)) {
        c.conversations.forEach { row -> ConversationRow(row, vm, onOpen) }
    }
}

private fun kindLabel(row: ConversationRowDto): String = when (row.subject) {
    "provider" -> row.subtitle ?: "Service provider"
    "person" -> "Private"
    else -> row.subtitle ?: "Conversation"
}

@Composable
private fun ConversationRow(row: ConversationRowDto, vm: ClientProfileViewModel, onOpen: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onOpen(row.id) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        PortalAvatar(url = vm.absolute(row.avatar), name = row.title, size = 32.dp)
        Column(Modifier.weight(1f)) {
            Text(row.title ?: "Conversation", style = if (row.unread > 0) Tma.type.text14sb else Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(kindLabel(row), row.preview).joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (row.unread > 0) Box(Modifier.size(20.dp).background(Tokens.Accent.red, CircleShape), contentAlignment = Alignment.Center) {
            Text(row.unread.toString(), style = Tma.type.text12, color = Tokens.Brand.white)
        }
        Icon(painterResource(R.drawable.ic_caret_right), null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(14.dp))
    }
}

/* ---------- Portal access ---------- */

private val LOGIN_EVENT_LABEL = mapOf(
    "login" to "Signed in", "logout" to "Signed out", "login_failed" to "Failed sign-in", "lockout" to "Locked out", "social_failed" to "Microsoft or Google sign-in refused",
)

/** renderAccessPanel: the invite block, or the account summary, sign-in history and activity. */
@Composable
fun AccessPanel(ui: ProfileUi, vm: ClientProfileViewModel) {
    val d = ui.access
    if (ui.accessFailed) { SectionError(onRetry = vm::loadAccess); return }
    if (d == null) { PanelEmpty("Loading…"); return }
    if (!d.hasAccount) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("No portal access yet. Invite them to create an account.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
            d.invitation?.let { inv ->
                val bits = listOfNotNull(inv.str("status")?.replaceFirstChar { it.uppercase() }, inv.str("sentAt")?.let { "Sent " + fmtShortDate(it) }, inv.str("invitedBy")?.let { "by $it" }, inv.str("email"))
                if (bits.isNotEmpty()) Text(bits.joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary)
            }
            if (ui.canInvite || d.canInvite) ActionButton(if (d.invitation != null) "Resend invitation" else "Invite to portal", R.drawable.ic_envelope_simple, enabled = !ui.busy) { vm.invite() }
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        d.account?.let { a ->
            val bits = buildList {
                add(a.accountType ?: "Client")
                a.status?.let { add(if (it == "approved") "Active" else it) }
                if (a.twoFactor) add("Two-factor on")
                if (a.onboardedAt != null) add("Onboarding complete")
                a.email?.let { add(it) }
            }
            AccessBlock("Account") {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PortalAvatar(url = vm.absolute(a.avatar), name = a.name ?: a.email, size = 32.dp)
                    Column {
                        Text(a.name ?: a.email ?: "Account", style = Tma.type.text14, color = Tma.colors.ink)
                        Text(bits.joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                    }
                }
            }
        }
        AccessBlock("Sign-in history") {
            if (d.logins.isEmpty()) Text("No sign-ins recorded yet.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
            d.logins.forEach { r ->
                Column(Modifier.padding(vertical = 4.dp)) {
                    Text(LOGIN_EVENT_LABEL[r.event] ?: r.event, style = Tma.type.text14, color = Tma.colors.ink)
                    Text(listOfNotNull(r.`when`, r.device, r.ip).filter { it.isNotBlank() }.joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                }
            }
        }
        AccessBlock("Activity") {
            if (d.activity.isEmpty()) Text("Nothing recorded yet.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
            d.activity.forEach { r ->
                Column(Modifier.padding(vertical = 4.dp)) {
                    Text(r.description ?: r.type ?: "", style = Tma.type.text14, color = Tma.colors.ink)
                    Text(r.`when` ?: "", style = Tma.type.text12, color = Tma.colors.inkSecondary)
                }
            }
        }
    }
}

@Composable
private fun AccessBlock(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = Tma.type.text14sb, color = Tma.colors.ink)
        content()
    }
}

/* ---------- Client info ---------- */

private fun typeLabel(type: String?, fallback: String) = type?.takeIf { it.isNotBlank() }?.replace('_', ' ')?.replaceFirstChar { it.uppercase() } ?: fallback

private fun formatAddress(addr: JsonObject): String = listOf("line1", "line2", "street", "city", "state", "region", "postalCode", "postcode", "country")
    .mapNotNull { addr.str(it)?.takeIf { v -> v.isNotBlank() } }.distinct().joinToString(", ")

/** buildProfileListItems for a client without an application. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InfoPanel(ui: ProfileUi, phone: Boolean) {
    val c = ui.client ?: return
    val p = c.profileObject
    val work = p.obj("work")
    val items = buildList {
        add(Triple(R.drawable.ic_users, "Client type", c.clientTypeLabel ?: "-"))
        add(Triple(R.drawable.ic_share_network, "Referred by", c.referredByLabel ?: "Not recorded"))
        work.str("jobTitle")?.let { add(Triple(R.drawable.ic_buildings, "Job title", it)) }
        work.str("department")?.let { add(Triple(R.drawable.ic_users, "Department", it)) }
        (work.str("company") ?: c.companyName)?.let { add(Triple(R.drawable.ic_buildings, "Company", it)) }
        p.objects("phones").forEach { ph -> ph.str("value")?.takeIf { it.isNotBlank() }?.let { add(Triple(R.drawable.ic_phone, typeLabel(ph.str("type"), "Phone"), it)) } }
        p.objects("emails").forEach { em -> em.str("value")?.takeIf { it.isNotBlank() }?.let { add(Triple(R.drawable.ic_envelope_simple, typeLabel(em.str("type"), "Email"), it)) } }
        p.objects("addresses").forEach { ad -> formatAddress(ad).takeIf { it.isNotBlank() }?.let { add(Triple(R.drawable.ic_house, typeLabel(ad.str("type"), "Address"), it)) } }
        p.str("website")?.takeIf { it.isNotBlank() }?.let { add(Triple(R.drawable.ic_link_simple, "Website", it)) }
        p.objects("importantDates").forEach { d -> d.str("date")?.takeIf { it.isNotBlank() }?.let { add(Triple(R.drawable.ic_calendar_blank, d.str("label") ?: typeLabel(d.str("type"), "Date"), fmtShortDate(it).ifBlank { it })) } }
        p.str("linkedIn")?.takeIf { it.isNotBlank() }?.let { add(Triple(R.drawable.ic_link_simple, "LinkedIn", it.replace(Regex("^https?://(www\\.)?linkedin\\.com/", RegexOption.IGNORE_CASE), ""))) }
        p.str("notes")?.takeIf { it.isNotBlank() }?.let { add(Triple(R.drawable.ic_file_text, "Notes", it)) }
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.card).padding(16.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), maxItemsInEachRow = if (phone) 1 else 3) {
            items.forEach { (icon, label, value) -> ListItemRow(icon, label, value, Modifier.weight(1f)) }
        }
    }
}
