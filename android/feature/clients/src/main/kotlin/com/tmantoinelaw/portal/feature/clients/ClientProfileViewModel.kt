package com.tmantoinelaw.portal.feature.clients

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tmantoinelaw.portal.core.data.cip.AccessDto
import com.tmantoinelaw.portal.core.data.cip.ApplicationDto
import com.tmantoinelaw.portal.core.data.cip.ApplicationEnvelope
import com.tmantoinelaw.portal.core.data.cip.AssignmentsDto
import com.tmantoinelaw.portal.core.data.cip.CipRepository
import com.tmantoinelaw.portal.core.data.cip.ClientRecordDto
import com.tmantoinelaw.portal.core.data.cip.ConversationsDto
import com.tmantoinelaw.portal.core.data.cip.EventDto
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.data.identity.IdentityStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import javax.inject.Inject

/** clients.js PROFILE_TABS. */
val PROFILE_TABS = listOf("info" to "Client info", "folders" to "Documents", "assigned" to "Assigned", "messages" to "Messages", "access" to "Portal access")

data class ProfileUi(
    val uid: String = "",
    val client: ClientRecordDto? = null,
    val app: ApplicationDto? = null,
    val loading: Boolean = true,
    val error: Boolean = false,
    val stale: Boolean = false,
    val tab: String = "",
    val events: List<EventDto>? = null,
    val eventsFailed: Boolean = false,
    val assignments: AssignmentsDto? = null,
    val assignmentsFailed: Boolean = false,
    val access: AccessDto? = null,
    val accessFailed: Boolean = false,
    val conversations: ConversationsDto? = null,
    val conversationsFailed: Boolean = false,
    val busy: Boolean = false,
    val toast: String? = null,
    val me: Identity? = null,
) {
    val isCip get() = app != null
    val name get() = app?.applicantName ?: client?.name ?: ""
    val photo get() = app?.photo ?: client?.photo
    val folderUuid get() = client?.folderUuid
    val isAdmin get() = me?.isAdmin == true
    val canInvite get() = me?.can("clients.invite") == true

    /** clients.js profileTabsFor. */
    fun tabs(): List<Pair<String, String>> {
        val a = app ?: return PROFILE_TABS
        val head = mutableListOf("overview" to "Overview", "applicant" to "Main applicant")
        if (a.sponsor != null) head += "sponsor" to "Sponsor"
        if (a.dependents.isNotEmpty()) head += "dependents" to "Dependents"
        return head + PROFILE_TABS.filter { it.first != "info" } + ("activity" to "Activity")
    }

    fun settleTab(asked: String? = null): ProfileUi {
        val ids = tabs().map { it.first }
        val want = asked ?: tab
        return copy(tab = if (want in ids) want else ids.first())
    }
}

/**
 * One client or application profile (clients.js detail screen). The record
 * paints from its snapshot first, then from `GET /portal/cip/clients/{uid}/application`
 * (falling back to `GET /portal/clients/{uid}` for viewers without CIP reach);
 * the tab panels load when opened and stay for the visit.
 */
@HiltViewModel
class ClientProfileViewModel @Inject constructor(
    private val repo: CipRepository,
    identityStore: IdentityStore,
) : ViewModel() {
    private val _ui = MutableStateFlow(ProfileUi())
    val ui: StateFlow<ProfileUi> = _ui.asStateFlow()
    private val _openConversation = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val openConversation: SharedFlow<String> = _openConversation.asSharedFlow()
    private var loadedUid: String? = null

    init {
        viewModelScope.launch { identityStore.identity.collect { me -> _ui.update { it.copy(me = me) } } }
        viewModelScope.launch {
            repo.changed.collect { r -> if (r.contains("cip") || r.contains("client")) loadedUid?.let { load(it, null, quiet = true) } }
        }
    }

    fun load(uid: String, askedTab: String?, quiet: Boolean = false) {
        if (!quiet && loadedUid == uid) { askedTab?.let(::setTab); return }
        if (!quiet) { loadedUid = uid; _ui.update { ProfileUi(uid = uid, me = it.me, tab = askedTab ?: "") } }
        viewModelScope.launch {
            if (!quiet) {
                val cachedClient = repo.cachedClient(uid)
                val cachedApp = repo.cachedApplicationForClient(uid)
                if (cachedClient != null || cachedApp != null) _ui.update { it.copy(client = cachedClient, app = cachedApp, loading = false, stale = true).settleTab(askedTab) }
            }
            val fetched = runCatching { repo.forClient(uid) }.recoverCatching { e ->
                if (e is CancellationException) throw e
                ApplicationEnvelope(null, repo.client(uid))
            }
            fetched.onSuccess { env ->
                val client = env.client ?: runCatching { repo.client(uid) }.getOrNull() ?: _ui.value.client
                _ui.update { it.copy(client = client, app = env.application, loading = false, error = false, stale = false).settleTab(askedTab) }
                ensureTabData()
            }.onFailure { e ->
                if (e is CancellationException) throw e
                _ui.update { if (it.client != null || it.app != null) it.copy(loading = false, stale = true) else it.copy(loading = false, error = true) }
            }
        }
    }

    fun setTab(id: String) {
        _ui.update { it.settleTab(id) }
        ensureTabData()
    }

    fun dismissToast() = _ui.update { it.copy(toast = null) }

    private fun ensureTabData() {
        val s = _ui.value
        when (s.tab) {
            "activity" -> if (s.events == null && !s.eventsFailed) loadEvents()
            "assigned" -> if (s.assignments == null && !s.assignmentsFailed) loadAssignments()
            "access" -> if (s.access == null && !s.accessFailed) loadAccess()
            "messages" -> if (s.conversations == null && !s.conversationsFailed) loadConversations()
        }
        if (s.conversations == null && !s.conversationsFailed && s.tab != "messages") loadConversations()
    }

    private fun loadEvents() {
        val app = _ui.value.app ?: return
        viewModelScope.launch {
            runCatching { repo.events(app.id) }
                .onSuccess { e -> _ui.update { it.copy(events = e, eventsFailed = false) } }
                .onFailure { _ui.update { it.copy(eventsFailed = true) } }
        }
    }

    fun loadAssignments() {
        val uid = _ui.value.uid
        viewModelScope.launch {
            runCatching { repo.assignments(uid) }
                .onSuccess { a -> _ui.update { it.copy(assignments = a, assignmentsFailed = false) } }
                .onFailure { _ui.update { it.copy(assignmentsFailed = true) } }
        }
    }

    fun loadAccess() {
        val uid = _ui.value.uid
        viewModelScope.launch {
            runCatching { repo.access(uid) }
                .onSuccess { a -> _ui.update { it.copy(access = a, accessFailed = false) } }
                .onFailure { _ui.update { it.copy(accessFailed = true) } }
        }
    }

    private fun loadConversations() {
        val uid = _ui.value.uid
        viewModelScope.launch {
            runCatching { repo.conversations(uid) }
                .onSuccess { c -> _ui.update { it.copy(conversations = c, conversationsFailed = false) } }
                .onFailure { _ui.update { it.copy(conversationsFailed = true) } }
        }
    }

    /** `POST …/status`; the answer is reduced, so the full record is re-read (catalogue A4 §3). */
    fun transition(status: String, note: String?) {
        val app = _ui.value.app ?: return
        viewModelScope.launch {
            _ui.update { it.copy(busy = true) }
            runCatching { repo.transition(app.id, status, note?.takeIf { it.isNotBlank() }); repo.application(app.id) }
                .onSuccess { fresh -> _ui.update { it.copy(app = fresh, events = null, busy = false).settleTab() }; if (_ui.value.tab == "activity") loadEvents() }
                .onFailure { _ui.update { it.copy(busy = false, toast = "Could not change the status.") } }
        }
    }

    fun assign(userId: Long, role: String?) {
        val uid = _ui.value.uid
        viewModelScope.launch {
            _ui.update { it.copy(busy = true) }
            runCatching { repo.assign(uid, userId, role) }
                .onSuccess { _ui.update { it.copy(busy = false) }; loadAssignments() }
                .onFailure { _ui.update { it.copy(busy = false, toast = "Could not assign that person.") } }
        }
    }

    fun unassign(userId: Long) {
        val uid = _ui.value.uid
        viewModelScope.launch {
            _ui.update { it.copy(busy = true) }
            runCatching { repo.unassign(uid, userId) }
                .onSuccess { _ui.update { it.copy(busy = false) }; loadAssignments() }
                .onFailure { _ui.update { it.copy(busy = false, toast = "Could not end that assignment.") } }
        }
    }

    fun invite() {
        val uid = _ui.value.uid
        viewModelScope.launch {
            _ui.update { it.copy(busy = true) }
            runCatching { repo.invite(uid) }
                .onSuccess { _ui.update { it.copy(busy = false, toast = "Invitation sent.") }; loadAccess() }
                .onFailure { _ui.update { it.copy(busy = false, toast = "Could not send the invitation.") } }
        }
    }

    /** The Message chooser: `with` is "provider" or "person"; the answer names the conversation to open. */
    fun openConversation(with: String) {
        val uid = _ui.value.uid
        viewModelScope.launch {
            _ui.update { it.copy(busy = true) }
            runCatching { repo.openConversation(uid, with) }
                .onSuccess { json ->
                    _ui.update { it.copy(busy = false) }
                    val obj = json as? JsonObject
                    val id = obj?.get("conversation")?.let { (it as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull }
                        ?: obj?.get("id")?.jsonPrimitive?.contentOrNull
                    if (id != null) _openConversation.tryEmit(id) else _ui.update { it.copy(toast = "Could not open the conversation.") }
                }
                .onFailure { _ui.update { it.copy(busy = false, toast = "Could not open the conversation.") } }
        }
    }

    fun absolute(url: String?) = repo.absolute(url)
}
