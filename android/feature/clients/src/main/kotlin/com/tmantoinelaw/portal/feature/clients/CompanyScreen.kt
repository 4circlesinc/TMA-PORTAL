package com.tmantoinelaw.portal.feature.clients

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.tmantoinelaw.portal.core.data.cip.CipRepository
import com.tmantoinelaw.portal.core.data.cip.CompanyDto
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.CountChip
import com.tmantoinelaw.portal.core.ui.components.InitialsAvatar
import com.tmantoinelaw.portal.core.ui.components.SectionError
import com.tmantoinelaw.portal.core.ui.components.SkeletonFileRow
import com.tmantoinelaw.portal.core.ui.components.TmaIconButton
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.feature.shell.Layout
import com.tmantoinelaw.portal.feature.shell.PortalAvatar
import com.tmantoinelaw.portal.feature.shell.currentLayout
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CompanyUi(val company: CompanyDto? = null, val loading: Boolean = true, val error: Boolean = false)

@HiltViewModel
class CompanyViewModel @Inject constructor(private val repo: CipRepository) : ViewModel() {
    private val _ui = MutableStateFlow(CompanyUi())
    val ui = _ui.asStateFlow()
    private var loaded: String? = null

    fun load(uid: String) {
        if (loaded == uid) return
        loaded = uid
        viewModelScope.launch {
            _ui.value = CompanyUi()
            repo.cachedCompany(uid)?.let { c -> _ui.update { it.copy(company = c, loading = false) } }
            runCatching { repo.company(uid) }
                .onSuccess { c -> _ui.update { it.copy(company = c, loading = false, error = false) } }
                .onFailure { _ui.update { if (it.company != null) it.copy(loading = false) else it.copy(loading = false, error = true) } }
        }
    }

    fun retry() { loaded = null }
    fun absolute(url: String?) = repo.absolute(url)
}

/** A service provider (clients.js company screen): identity, contact details, its people. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CompanyScreen(uid: String, onBack: () -> Unit, onOpenClient: (String) -> Unit, viewModel: CompanyViewModel = hiltViewModel(key = "company:$uid")) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    LaunchedEffect(uid) { viewModel.load(uid) }
    val phone = currentLayout() == Layout.Compact
    Column(Modifier.fillMaxSize().background(Tma.colors.page)) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TmaIconButton(R.drawable.ic_arrow_left, "Back", onClick = onBack)
            val c = ui.company
            if (c != null) {
                if (c.logoUrl != null) PortalAvatar(url = viewModel.absolute(c.logoUrl), name = c.name, size = 40.dp) else InitialsAvatar(name = c.name, size = 40.dp)
                Column {
                    Text(c.name.ifBlank { "Service provider" }, style = Tma.type.text18sb, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(c.companyTypeLabel ?: "Company", c.cipCode?.let { "CIP code $it" }).joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                }
            }
        }
        HorizontalDivider(color = Tma.colors.borderSoft)
        val c = ui.company
        when {
            ui.error -> SectionError(onRetry = { viewModel.retry(); viewModel.load(uid) }, modifier = Modifier.padding(16.dp))
            c == null -> Column(Modifier.padding(horizontal = 16.dp)) { repeat(4) { SkeletonFileRow(avatar = true) } }
            else -> Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                val details = listOfNotNull(
                    c.website?.let { Triple(R.drawable.ic_link_simple, "Website", it) },
                    c.email?.let { Triple(R.drawable.ic_envelope_simple, "Email", it) },
                    c.phone?.let { Triple(R.drawable.ic_phone, "Phone", it) },
                    Triple(R.drawable.ic_users_three, "Referred clients", c.referredCount.toString()),
                )
                ProfileCard("Details") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), maxItemsInEachRow = if (phone) 1 else 3) {
                        details.forEach { (icon, label, value) -> ListItemRow(icon, label, value, Modifier.weight(1f)) }
                    }
                    c.notes?.takeIf { it.isNotBlank() }?.let { Text(it, style = Tma.type.text14, color = Tma.colors.inkSecondary, modifier = Modifier.padding(top = 12.dp)) }
                }
                ProfileCard("Contacts", count = c.people.size.toString()) {
                    if (c.people.isEmpty()) Text("No contacts yet", style = Tma.type.text14, color = Tma.colors.inkSecondary)
                    c.people.forEach { p ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { onOpenClient(p.id) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            InitialsAvatar(name = p.name, size = 32.dp, seed = p.email ?: p.name)
                            Column(Modifier.weight(1f)) {
                                Text(p.name, style = Tma.type.text14, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                p.email?.let { Text(it, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            }
                            if (p.hasLogin) CountChip("Portal")
                        }
                    }
                }
            }
        }
    }
}
