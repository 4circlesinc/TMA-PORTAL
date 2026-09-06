package com.tmantoinelaw.portal.feature.clients

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tmantoinelaw.portal.core.data.cip.ApplicationDto
import com.tmantoinelaw.portal.core.data.cip.ApplicationsPageDto
import com.tmantoinelaw.portal.core.data.cip.ApplicationsQuery
import com.tmantoinelaw.portal.core.data.cip.BucketDto
import com.tmantoinelaw.portal.core.data.cip.CipRepository
import com.tmantoinelaw.portal.core.data.cip.CompanyDto
import com.tmantoinelaw.portal.core.data.cip.CompanyPersonDto
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.data.identity.IdentityStore
import com.tmantoinelaw.portal.core.network.NetworkState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The hub's list tabs (clients.js LIST_TABS). */
data class ListTab(val id: String, val label: String, val shortLabel: String?)

val LIST_TABS = listOf(
    ListTab("all_applications", "All Applications", "All"),
    ListTab("pre_approval", "Pre-Approval Applications", "Pre-Approval"),
    ListTab("post_approval", "Post-Approval Applications", "Post-Approval"),
    ListTab("closed", "Closed", null),
    ListTab("providers", "Service providers", "Providers"),
    ListTab("people", "Provider contacts", "Contacts"),
)

/** Sortable columns, in table order (clients.js CIP_SORTS). */
val CIP_SORTS = listOf(
    "number" to "Application", "applicant" to "Applicant", "provider" to "Service provider", "contact" to "Contact person",
    "email" to "Contact email", "investment" to "Investment", "family" to "Family", "status" to "Status", "assigned" to "Assigned to",
)

fun Identity.isProviderCipUser() = isProviderContact
fun Identity.isExternalCipUser() = isProviderContact || (cipReach && !can("clients.view"))
fun Identity.listTabs(): List<ListTab> = when {
    isProviderCipUser() -> LIST_TABS.filter { it.id in setOf("all_applications", "pre_approval", "post_approval", "closed") }
    isExternalCipUser() -> emptyList()
    else -> LIST_TABS
}

data class ProviderPersonRow(val person: CompanyPersonDto, val company: CompanyDto)

data class ClientsUi(
    val tabs: List<ListTab> = emptyList(),
    val tab: String = "all_applications",
    val query: String = "",
    val page: ApplicationsPageDto? = null,
    val loading: Boolean = true,
    val error: Boolean = false,
    val stale: Boolean = false,
    val bucket: Set<String> = emptySet(),
    val assignee: Set<String> = emptySet(),
    val provider: Set<String> = emptySet(),
    val buckets: List<BucketDto> = emptyList(),
    val sort: String? = null,
    val dir: String = "asc",
    val pageNumber: Int = 1,
    val companies: List<CompanyDto>? = null,
    val companiesError: Boolean = false,
    val external: Boolean = false,
    val canCreateBeyond: Boolean = false,
    val canAssign: Boolean = false,
    val busyId: String? = null,
    val toast: String? = null,
) {
    val onProviders get() = tab == "providers"
    val onPeople get() = tab == "people"
    val anyFilter get() = bucket.isNotEmpty() || assignee.isNotEmpty() || provider.isNotEmpty()
    val postApproval get() = tab == "post_approval"
    fun providerRows(): List<CompanyDto> = (companies ?: emptyList()).filter { matches(it.name) }
    fun peopleRows(): List<ProviderPersonRow> = (companies ?: emptyList()).flatMap { c -> c.people.map { ProviderPersonRow(it, c) } }
        .filter { matches(it.person.name) || matches(it.person.email) || matches(it.company.name) }
    private fun matches(s: String?) = query.isBlank() || (s ?: "").contains(query.trim(), ignoreCase = true)
    fun countFor(tab: ListTab): Int? = when (tab.id) {
        "providers" -> companies?.size
        "people" -> companies?.sumOf { it.people.size }
        else -> page?.phaseCounts?.get(phaseKey(tab.id))
    }
}

fun phaseKey(tab: String) = when (tab) { "pre_approval", "post_approval", "closed" -> tab; else -> "all" }
fun phaseParam(tab: String): String? = when (tab) { "pre_approval", "post_approval", "closed" -> tab; else -> null }

/**
 * The CIP Applications hub (clients.js list screen): the applications table
 * behind `GET /portal/cip/applications`, the providers and contacts tabs
 * behind `GET /portal/companies`, and the status/assignee/provider filters.
 * The plain first page of each tab is a snapshot, so the hub opens offline.
 */
@HiltViewModel
class ClientsViewModel @Inject constructor(
    private val repo: CipRepository,
    identityStore: IdentityStore,
    private val network: NetworkState,
) : ViewModel() {
    private val _ui = MutableStateFlow(ClientsUi())
    val ui: StateFlow<ClientsUi> = _ui.asStateFlow()
    private var loadJob: Job? = null
    private var searchJob: Job? = null
    private var loadedKey: String? = null

    init {
        viewModelScope.launch {
            identityStore.identity.collect { me ->
                if (me == null) return@collect
                _ui.update {
                    it.copy(
                        tabs = me.listTabs(), external = me.isExternalCipUser(),
                        canCreateBeyond = !me.isExternalCipUser() && me.can("clients.manage"),
                        canAssign = me.isAdmin || me.can("cip.assign"),
                    )
                }
            }
        }
        load()
        viewModelScope.launch { runCatching { repo.buckets() }.onSuccess { b -> _ui.update { it.copy(buckets = b) } } }
        viewModelScope.launch {
            repo.changed.collect { resource ->
                if (resource.contains("cip") || resource.contains("client") || resource.contains("compan")) load(quiet = true)
            }
        }
        viewModelScope.launch {
            var was = network.online.value
            network.online.collect { now -> if (now && !was && _ui.value.stale) load(quiet = true); was = now }
        }
    }

    fun setTab(id: String) {
        if (id == _ui.value.tab) return
        _ui.update { it.copy(tab = id, pageNumber = 1, bucket = emptySet()) }
        load()
    }

    fun setQuery(q: String) {
        _ui.update { it.copy(query = q, pageNumber = 1) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch { delay(250); load() }
    }

    fun toggleFilter(field: String, value: String) {
        _ui.update {
            fun flip(set: Set<String>) = if (value in set) set - value else set + value
            when (field) {
                "bucket" -> it.copy(bucket = flip(it.bucket), pageNumber = 1)
                "assignee" -> it.copy(assignee = flip(it.assignee), pageNumber = 1)
                else -> it.copy(provider = flip(it.provider), pageNumber = 1)
            }
        }
        load()
    }

    fun clearFilter(field: String) {
        _ui.update { when (field) { "bucket" -> it.copy(bucket = emptySet()); "assignee" -> it.copy(assignee = emptySet()); else -> it.copy(provider = emptySet()) }.copy(pageNumber = 1) }
        load()
    }

    fun setSort(col: String) {
        if (CIP_SORTS.none { it.first == col }) return
        _ui.update { if (it.sort == col) it.copy(dir = if (it.dir == "asc") "desc" else "asc", pageNumber = 1) else it.copy(sort = col, dir = "asc", pageNumber = 1) }
        load()
    }

    fun setPage(p: Int) {
        val last = _ui.value.page?.lastPage ?: 1
        val next = p.coerceIn(1, maxOf(1, last))
        if (next == _ui.value.pageNumber) return
        _ui.update { it.copy(pageNumber = next) }
        load()
    }

    fun reload() { loadedKey = null; load() }
    fun dismissToast() = _ui.update { it.copy(toast = null) }

    private fun query(): ApplicationsQuery = _ui.value.let {
        ApplicationsQuery(phase = phaseParam(it.tab), q = it.query.trim(), bucket = it.bucket, assignee = it.assignee, provider = it.provider, sort = it.sort, dir = it.dir, page = it.pageNumber)
    }

    private fun load(quiet: Boolean = false) {
        val s = _ui.value
        if (s.onProviders || s.onPeople) { loadCompanies(quiet); return }
        val q = query()
        val key = q.toQueryString()
        if (quiet && loadedKey != key) return
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            if (!quiet) {
                _ui.update { it.copy(loading = it.page == null || loadedKey != key, error = false) }
                repo.cachedApplications(q)?.let { c -> _ui.update { it.copy(page = c, loading = false, stale = true) } }
            }
            runCatching { repo.applications(q) }
                .onSuccess { p -> loadedKey = key; _ui.update { it.copy(page = p, loading = false, error = false, stale = false) } }
                .onFailure { e ->
                    if (e is CancellationException) throw e
                    _ui.update { if (it.page != null) it.copy(loading = false, stale = true) else it.copy(loading = false, error = true) }
                }
        }
    }

    private fun loadCompanies(quiet: Boolean) {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            if (!quiet) {
                _ui.update { it.copy(loading = it.companies == null, companiesError = false) }
                if (_ui.value.companies == null) repo.cachedCompanies()?.let { c -> _ui.update { it.copy(companies = c, loading = false, stale = true) } }
            }
            runCatching { repo.companies() }
                .onSuccess { c -> _ui.update { it.copy(companies = c, loading = false, companiesError = false, stale = false) } }
                .onFailure { e ->
                    if (e is CancellationException) throw e
                    _ui.update { if (it.companies != null) it.copy(loading = false, stale = true) else it.copy(loading = false, companiesError = true) }
                }
        }
    }

    /** A status change from the row chip; the answer is reduced, so the page is re-read. */
    fun transition(app: ApplicationDto, status: String) {
        viewModelScope.launch {
            _ui.update { it.copy(busyId = app.id) }
            runCatching { repo.transition(app.id, status, null) }
                .onSuccess { loadedKey = null; load() }
                .onFailure { _ui.update { it.copy(toast = "Could not change the status.") } }
            _ui.update { it.copy(busyId = null) }
        }
    }

    fun absolute(url: String?) = repo.absolute(url)
}
