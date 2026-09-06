package com.tmantoinelaw.portal.feature.files.viewer

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import com.tmantoinelaw.portal.core.data.bytes.ByteCache
import com.tmantoinelaw.portal.core.data.files.AccessDto
import com.tmantoinelaw.portal.core.data.files.ActivityFeedDto
import com.tmantoinelaw.portal.core.data.files.CommentDto
import com.tmantoinelaw.portal.core.data.files.CommentsDto
import com.tmantoinelaw.portal.core.data.files.DetailsDto
import com.tmantoinelaw.portal.core.data.files.FileItemDto
import com.tmantoinelaw.portal.core.data.files.FilesRepository
import com.tmantoinelaw.portal.core.data.files.VersionsDto
import com.tmantoinelaw.portal.core.data.files.access
import com.tmantoinelaw.portal.core.data.files.activity
import com.tmantoinelaw.portal.core.data.files.comments
import com.tmantoinelaw.portal.core.data.files.deleteComment
import com.tmantoinelaw.portal.core.data.files.details
import com.tmantoinelaw.portal.core.data.files.editComment
import com.tmantoinelaw.portal.core.data.files.postComment
import com.tmantoinelaw.portal.core.data.files.presence
import com.tmantoinelaw.portal.core.data.files.resolveComment
import com.tmantoinelaw.portal.core.data.files.restoreVersion
import com.tmantoinelaw.portal.core.data.files.versions
import com.tmantoinelaw.portal.core.data.files.versionDownloadUrl
import com.tmantoinelaw.portal.core.data.files.versionPreviewUrl
import com.tmantoinelaw.portal.core.data.realtime.RealtimeCoordinator
import com.tmantoinelaw.portal.core.navigation.FileViewerRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID
import javax.inject.Inject

enum class ViewerTab { Details, Versions, Activity, Access }

sealed interface Stage {
    data object Loading : Stage
    data class Image(val url: String) : Stage
    data class Pdf(val file: File, val fromCache: Boolean) : Stage
    data class Media(val url: String, val video: Boolean) : Stage
    data class Text(val text: String) : Stage
    data object NoPreview : Stage
    data class Failed(val message: String) : Stage
}

data class ViewerUi(
    val file: FileItemDto? = null,
    val stage: Stage = Stage.Loading,
    val panel: Boolean = false,
    val tab: ViewerTab = ViewerTab.Details,
    val commentsOpen: Boolean = false,
    val details: DetailsDto? = null,
    val versions: VersionsDto? = null,
    val activity: ActivityFeedDto? = null,
    val activityFilter: String = "all",
    val access: AccessDto? = null,
    val comments: CommentsDto? = null,
    val panelError: String? = null,
    val error: String? = null,
)

/**
 * The one file viewer (portal-files.js openLightbox, prompt §11.6): the stage
 * by category, the Details / Versions / Activity / Access panel, the comments
 * pane, presence while open, and the file's own channel for live changes.
 */
@HiltViewModel
class ViewerViewModel @Inject constructor(
    savedState: SavedStateHandle,
    private val repository: FilesRepository,
    private val bytes: ByteCache,
    private val realtime: RealtimeCoordinator,
) : ViewModel() {
    private val route = savedState.toRoute<FileViewerRoute>()
    val fileId: String = route.fileId
    private val _ui = MutableStateFlow(ViewerUi())
    val ui: StateFlow<ViewerUi> = _ui.asStateFlow()
    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val toasts: SharedFlow<String> = _events.asSharedFlow()
    private val presenceSession = UUID.randomUUID().toString().take(32)
    private var presenceJob: Job? = null
    private val channel = RealtimeCoordinator.file(fileId)

    init {
        viewModelScope.launch { load() }
        realtime.subscribe(channel)
        realtime.events.filter { it.channel == channel }.onEach { e ->
            when (e.event) {
                "file.comment.changed" -> loadComments(peek = true)
                "file.detail.changed" -> when (e.string("section")) {
                    "details" -> _ui.update { it.copy(details = null) }.also { if (_ui.value.tab == ViewerTab.Details) loadDetails() }
                    "versions" -> _ui.update { it.copy(versions = null) }.also { if (_ui.value.tab == ViewerTab.Versions) loadVersions() }
                    "activity" -> _ui.update { it.copy(activity = null) }.also { if (_ui.value.tab == ViewerTab.Activity) loadActivity() }
                }
            }
        }.launchIn(viewModelScope)
    }

    private suspend fun load() {
        val file = runCatching { repository.file(fileId) }.getOrElse { e ->
            _ui.update { it.copy(error = e.message ?: "This file could not be loaded.") }; return
        }
        _ui.update { it.copy(file = file) }
        startPresence()
        loadStage(file)
        loadComments(peek = true)
        loadDetails()
    }

    private suspend fun loadStage(f: FileItemDto) {
        val preview = f.previewUrl?.let { repository.absolute(it) }
        if (preview == null || !f.can("preview")) { _ui.update { it.copy(stage = Stage.NoPreview) }; return }
        when (f.category) {
            "image" -> _ui.update { it.copy(stage = Stage.Image(preview)) }
            "video" -> _ui.update { it.copy(stage = Stage.Media(preview, video = true)) }
            "audio" -> _ui.update { it.copy(stage = Stage.Media(preview, video = false)) }
            "pdf" -> when (val a = bytes.fetch(preview)) {
                is ByteCache.Answer.Ok -> _ui.update { it.copy(stage = Stage.Pdf(a.file, a.fromCache)) }
                is ByteCache.Answer.Refused -> _ui.update { it.copy(stage = Stage.Failed("Could not load this PDF.")) }
                ByteCache.Answer.Unreachable -> _ui.update { it.copy(stage = Stage.Failed("Could not load this PDF.")) }
            }
            "text" -> when (val a = bytes.fetch(preview)) {
                is ByteCache.Answer.Ok -> _ui.update { it.copy(stage = Stage.Text(runCatching { a.file.readText() }.getOrDefault(""))) }
                else -> _ui.update { it.copy(stage = Stage.Failed("Could not load this file.")) }
            }
            else -> _ui.update { it.copy(stage = Stage.NoPreview) }
        }
    }

    private fun startPresence() {
        presenceJob?.cancel()
        presenceJob = viewModelScope.launch {
            while (isActive) { repository.presence(fileId, presenceSession, leaving = false); delay(4 * 60_000L) }
        }
    }

    fun togglePanel() = _ui.update { it.copy(panel = !it.panel) }
    fun toggleComments() = _ui.update { it.copy(commentsOpen = !it.commentsOpen) }.also { if (_ui.value.commentsOpen) loadComments(peek = false) }
    fun openTab(tab: ViewerTab) {
        _ui.update { it.copy(panel = true, tab = tab, panelError = null) }
        when (tab) {
            ViewerTab.Details -> loadDetails()
            ViewerTab.Versions -> loadVersions()
            ViewerTab.Activity -> loadActivity()
            ViewerTab.Access -> loadAccess()
        }
    }

    fun loadDetails() { if (_ui.value.details != null) return; viewModelScope.launch { runCatching { repository.details(fileId) }.onSuccess { d -> _ui.update { it.copy(details = d) } }.onFailure { panelFailed("details") } } }
    fun loadVersions() = viewModelScope.launch { runCatching { repository.versions(fileId) }.onSuccess { v -> _ui.update { it.copy(versions = v) } }.onFailure { panelFailed("version history") } }
    fun loadAccess() { if (_ui.value.access != null) return; viewModelScope.launch { runCatching { repository.access(fileId) }.onSuccess { a -> _ui.update { it.copy(access = a) } }.onFailure { panelFailed("access") } } }
    fun loadActivity(append: Boolean = false) = viewModelScope.launch {
        val before = if (append) _ui.value.activity?.nextCursor else null
        runCatching { repository.activity(fileId, _ui.value.activityFilter, before) }
            .onSuccess { data -> _ui.update { s -> s.copy(activity = if (append && s.activity != null) data.copy(entries = s.activity.entries + data.entries) else data) } }
            .onFailure { panelFailed("activity") }
    }
    fun setActivityFilter(f: String) { _ui.update { it.copy(activityFilter = f, activity = null) }; loadActivity() }

    fun loadComments(peek: Boolean) = viewModelScope.launch { runCatching { repository.comments(fileId, peek) }.onSuccess { c -> _ui.update { it.copy(comments = c) } } }

    fun postComment(body: String, parent: String?) = viewModelScope.launch {
        runCatching { repository.postComment(fileId, body, parent) }
            .onSuccess { loadComments(peek = false) }
            .onFailure { _events.tryEmit(it.message ?: if (parent == null) "Could not post that comment" else "Could not post that reply") }
    }
    fun editComment(id: String, body: String) = viewModelScope.launch { runCatching { repository.editComment(fileId, id, body) }.onSuccess { loadComments(peek = true) }.onFailure { _events.tryEmit(it.message ?: "Could not save that edit") } }
    fun deleteComment(id: String) = viewModelScope.launch { runCatching { repository.deleteComment(fileId, id) }.onSuccess { loadComments(peek = true) }.onFailure { _events.tryEmit(it.message ?: "Could not delete that comment") } }
    fun resolve(comment: CommentDto) = viewModelScope.launch { runCatching { repository.resolveComment(fileId, comment.id, !comment.resolved) }.onSuccess { loadComments(peek = true) }.onFailure { _events.tryEmit(it.message ?: "Could not update that thread") } }

    fun restoreVersion(versionId: String) = viewModelScope.launch {
        runCatching { repository.restoreVersion(fileId, versionId) }
            .onSuccess { _events.tryEmit("Version restored"); loadVersions(); _ui.value.file?.let { runCatching { repository.file(fileId) }.getOrNull()?.let { f -> _ui.update { it.copy(file = f) }; loadStage(f) } } }
            .onFailure { _events.tryEmit(it.message ?: "Could not restore that version") }
    }

    fun toggleFavorite() = viewModelScope.launch {
        val f = _ui.value.file ?: return@launch
        _ui.update { it.copy(file = f.copy(favorite = !f.favorite)) }
        runCatching { repository.toggleFavorite(f) }.onSuccess { fav -> _ui.update { it.copy(file = f.copy(favorite = fav)) } }.onFailure { _ui.update { it.copy(file = f) }; _events.tryEmit("Could not update favourite") }
    }

    fun downloadUrl(): Pair<String, String>? = _ui.value.file?.let { repository.downloadUrl(it) to it.name }
    fun versionUrl(versionId: String, download: Boolean) = if (download) repository.versionDownloadUrl(fileId, versionId) else repository.versionPreviewUrl(fileId, versionId)
    fun cookieHeader(url: String) = repository.cookieHeader(url)
    val userAgent get() = repository.userAgent
    fun absolute(url: String?) = repository.absolute(url)

    private fun panelFailed(what: String) = _ui.update { it.copy(panelError = "Could not load $what.") }

    override fun onCleared() {
        presenceJob?.cancel()
        realtime.unsubscribe(channel)
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch { repository.presence(fileId, presenceSession, leaving = true) }
        super.onCleared()
    }
}
