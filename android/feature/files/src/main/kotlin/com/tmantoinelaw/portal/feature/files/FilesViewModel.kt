package com.tmantoinelaw.portal.feature.files

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import com.tmantoinelaw.portal.core.data.files.FileItemDto
import com.tmantoinelaw.portal.core.data.files.FilesRepository
import com.tmantoinelaw.portal.core.data.files.ListingDto
import com.tmantoinelaw.portal.core.data.files.ListingQuery
import com.tmantoinelaw.portal.core.data.files.ListingResult
import com.tmantoinelaw.portal.core.data.files.UploadJob
import com.tmantoinelaw.portal.core.data.files.UploadManager
import com.tmantoinelaw.portal.core.data.replica.FilesReplica
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.data.prefs.DevicePrefs
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import com.tmantoinelaw.portal.core.navigation.FilesRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The sidebar's section slugs → the listing API's sections (portal-files.js NAV_SECTION). */
fun apiSection(slug: String) = when (slug) {
    "personal" -> "my"; "shared-with-me" -> "shared"; "shared" -> "shared-folders"; else -> slug
}

data class SectionCopy(val title: String, val desc: String, val empty: String, val emptyHint: String? = null)

/** portal-files.js SECTIONS, verbatim. */
val SECTIONS = mapOf(
    "all" to SectionCopy("All Files", "All files and folders you can access.", "No files yet"),
    "clients" to SectionCopy("Client Folders", "Citizenship by investment application folders you can open.", "No application folders yet", "Folders for the applications you work with will appear here."),
    "my" to SectionCopy("My Files", "Files and folders you own.", "You haven’t created any files yet"),
    "shared" to SectionCopy("Shared with me", "Items other people have shared with you.", "Nothing has been shared with you yet"),
    "shared-folders" to SectionCopy("Shared Folders", "Folders with active sharing or assigned people.", "No shared folders yet"),
    "favorites" to SectionCopy("Favourites", "Files and folders you starred for quick access.", "No favourites yet"),
    "filebox" to SectionCopy("File Box", "Loose files not yet organised into a folder.", "Your File Box is empty"),
    "recent" to SectionCopy("Recent", "Files you recently uploaded or changed.", "Nothing recent yet"),
    "recycle" to SectionCopy("Recycle Bin", "Deleted files and folders.", "The recycle bin is empty"),
)

data class Clipboard(val cut: Boolean, val items: List<FileItemDto>)

data class FilesUi(
    val identity: Identity? = null,
    val query: ListingQuery = ListingQuery(),
    val listing: ListingDto? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val stale: Boolean = false,
    val grid: Boolean = false,
    val selected: Set<String> = emptySet(),
    val busy: Set<String> = emptySet(),
    val clipboard: Clipboard? = null,
    val loadingMore: Boolean = false,
    val openFileId: String? = null,
) {
    val section get() = query.section
    val copy get() = SECTIONS[section] ?: SECTIONS.getValue("all")
    val isRecycle get() = section == "recycle"
    val items: List<FileItemDto> get() = listing?.let { it.folders + it.files }.orEmpty()
    val selectedItems get() = items.filter { it.id in selected }
    /** Uploads only in all, my, filebox at root, or inside a folder that allows it (portal-files.js canCreateHere). */
    val canCreateHere: Boolean get() = when {
        isRecycle -> false
        query.folder != null -> listing?.folder?.permissions?.allows("upload") ?: false
        else -> section in setOf("all", "my", "filebox")
    }
    val packageLocked get() = listing?.folder?.packageLocked == true
}

sealed interface FilesEvent {
    data class Toast(val message: String) : FilesEvent
    data class Download(val url: String, val name: String) : FilesEvent
}

@HiltViewModel
class FilesViewModel @Inject constructor(
    savedState: SavedStateHandle,
    private val repository: FilesRepository,
    private val session: SessionRepository,
    private val prefs: DevicePrefs,
    private val uploads: UploadManager,
    private val replica: FilesReplica,
) : ViewModel() {
    val uploadJobs: StateFlow<List<UploadJob>> = uploads.jobs

    private val route = savedState.toRoute<FilesRoute>()
    private val _ui = MutableStateFlow(FilesUi(query = ListingQuery(section = apiSection(route.section), folder = route.folder), openFileId = route.file))
    val ui: StateFlow<FilesUi> = _ui.asStateFlow()

    private val _events = MutableSharedFlow<FilesEvent>(extraBufferCapacity = 8)
    val events: SharedFlow<FilesEvent> = _events.asSharedFlow()

    private var loadJob: Job? = null
    private var searchJob: Job? = null

    init {
        viewModelScope.launch { session.identity.collect { id -> _ui.update { it.copy(identity = id) } } }
        viewModelScope.launch { prefs.filesGrid.collect { g -> _ui.update { it.copy(grid = g) } } }
        viewModelScope.launch { repository.changed.collect { if (it == "files") load(silent = true) } }
        viewModelScope.launch { uploads.completed.collect { job -> job.result?.let { file -> if (job.folderId == _ui.value.query.folder) insert(file) } } }
        load()
    }

    fun upload(uris: List<android.net.Uri>) = uploads.enqueue(uris, _ui.value.query.folder)
    fun cancelUpload(id: String) = uploads.cancel(id)
    fun retryUpload(id: String) = uploads.retry(id)
    fun dismissUpload(id: String) = uploads.dismiss(id)
    fun clearUploads() = uploads.clearFinished()
    fun resolveUploadConflict(id: String, choice: String, newName: String?) = uploads.resolveConflict(id, choice, newName)

    /** Paint the snapshot, then the server (portal-store.js swr). Failures keep what is on screen. */
    fun load(silent: Boolean = false) {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            val q = _ui.value.query.copy(page = 1)
            _ui.update { it.copy(query = q) }
            if (!silent) {
                val snap = repository.cached(q)
                if (snap != null) _ui.update { it.copy(listing = snap, loading = false, error = null, stale = true) }
                else _ui.update { it.copy(loading = true, error = null) }
            }
            when (val result = repository.list(q)) {
                is ListingResult.Fresh -> _ui.update { s ->
                    if (s.query.copy(page = 1) != q) s
                    else s.copy(listing = result.listing, loading = false, error = null, stale = false, query = q.copy(perPage = result.listing.perPage), selected = s.selected.filter { id -> (result.listing.folders + result.listing.files).any { it.id == id } }.toSet())
                }
                is ListingResult.Failed -> {
                    val fromReplica = if (_ui.value.listing == null) replica.assemble(q) else null
                    _ui.update { s ->
                        when {
                            s.listing != null -> s.copy(loading = false, stale = true)
                            fromReplica != null -> s.copy(listing = fromReplica, loading = false, error = null, stale = true)
                            result.offline && !q.isPlain -> s.copy(loading = false, error = "You’re offline")
                            else -> s.copy(loading = false, error = result.message)
                        }
                    }
                }
            }
        }
    }

    fun loadMore() {
        val s = _ui.value
        val listing = s.listing ?: return
        if (!listing.hasMore || s.loadingMore) return
        viewModelScope.launch {
            _ui.update { it.copy(loadingMore = true) }
            val q = s.query.copy(page = listing.page + 1)
            when (val r = repository.list(q)) {
                is ListingResult.Fresh -> _ui.update { it.copy(listing = listing.copy(folders = listing.folders + r.listing.folders, files = listing.files + r.listing.files, page = r.listing.page, hasMore = r.listing.hasMore, total = r.listing.total), loadingMore = false) }
                is ListingResult.Failed -> { _ui.update { it.copy(loadingMore = false) }; _events.tryEmit(FilesEvent.Toast(r.message)) }
            }
        }
    }

    fun openFolder(id: String?) { _ui.update { it.copy(query = it.query.copy(folder = id, search = "", page = 1), selected = emptySet()) }; load() }
    fun setSort(field: String) { _ui.update { it.copy(query = it.query.copy(sort = field)) }; load() }
    fun toggleDir() { _ui.update { it.copy(query = it.query.copy(dir = if (it.query.dir == "asc") "desc" else "asc")) }; load() }
    fun setType(type: String?) { _ui.update { it.copy(query = it.query.copy(type = if (it.query.type == type) null else type)) }; load() }
    fun setOwner(owner: Long?) { _ui.update { it.copy(query = it.query.copy(owner = owner)) }; load() }
    fun setGrid(grid: Boolean) = viewModelScope.launch { prefs.setFilesGrid(grid) }
    fun search(text: String) {
        _ui.update { it.copy(query = it.query.copy(search = text)) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch { delay(250); load() }
    }

    fun toggleSelect(id: String) = _ui.update { it.copy(selected = if (id in it.selected) it.selected - id else it.selected + id) }
    fun selectAll() = _ui.update { s -> s.copy(selected = s.items.map { it.id }.toSet()) }
    fun clearSelection() = _ui.update { it.copy(selected = emptySet()) }
    fun openFile(id: String?) = _ui.update { it.copy(openFileId = id) }

    private fun busy(id: String, on: Boolean) = _ui.update { it.copy(busy = if (on) it.busy + id else it.busy - id) }
    private fun toast(m: String) { _events.tryEmit(FilesEvent.Toast(m)) }
    private fun remove(id: String) = _ui.update { s -> s.copy(listing = s.listing?.let { l -> l.copy(folders = l.folders.filter { it.id != id }, files = l.files.filter { it.id != id }) }, selected = s.selected - id) }
    private fun replace(item: FileItemDto) = _ui.update { s -> s.copy(listing = s.listing?.let { l -> l.copy(folders = l.folders.map { if (it.id == item.id) item else it }, files = l.files.map { if (it.id == item.id) item else it }) }) }
    private fun insert(item: FileItemDto) = _ui.update { s -> s.copy(listing = s.listing?.let { l -> if (item.isFolder) l.copy(folders = (l.folders.filter { it.id != item.id } + item).sortedBy { it.name.lowercase() }) else l.copy(files = (l.files.filter { it.id != item.id } + item).sortedBy { it.name.lowercase() }) }) }

    fun createFolder(name: String) = viewModelScope.launch {
        runCatching { repository.createFolder(name, _ui.value.query.folder) }
            .onSuccess { insert(it); toast("Folder created") }
            .onFailure { toast(it.message ?: "Could not create folder") }
    }

    fun rename(item: FileItemDto, name: String) = viewModelScope.launch {
        busy(item.id, true)
        runCatching { repository.rename(item, name) }
            .onSuccess { replace(it); toast("Renamed") }
            .onFailure { toast(it.message ?: "Could not rename") }
        busy(item.id, false)
    }

    fun toggleStar(item: FileItemDto) = viewModelScope.launch {
        if (item.id in _ui.value.busy) return@launch
        busy(item.id, true)
        replace(item.copy(favorite = !item.favorite))
        runCatching { repository.toggleFavorite(item) }
            .onSuccess { fav -> if (_ui.value.section == "favorites" && !fav) remove(item.id) else replace(item.copy(favorite = fav)) }
            .onFailure { replace(item); toast(it.message ?: "Could not update favourite") }
        busy(item.id, false)
    }

    fun delete(item: FileItemDto) = viewModelScope.launch {
        busy(item.id, true)
        runCatching { repository.delete(item) }
            .onSuccess { remove(item.id); toast("Moved to recycle bin") }
            .onFailure { toast(it.message ?: "Could not delete") }
        busy(item.id, false)
    }

    fun restore(item: FileItemDto) = viewModelScope.launch {
        busy(item.id, true)
        runCatching { repository.restore(item) }.onSuccess { remove(item.id); toast("Restored") }.onFailure { toast(it.message ?: "Could not restore") }
        busy(item.id, false)
    }

    fun forceDelete(item: FileItemDto) = viewModelScope.launch {
        busy(item.id, true)
        runCatching { repository.forceDelete(item) }.onSuccess { remove(item.id); toast("Permanently deleted") }.onFailure { toast(it.message ?: "Could not delete") }
        busy(item.id, false)
    }

    fun emptyBin() = viewModelScope.launch {
        runCatching { repository.emptyBin() }
            .onSuccess { _ui.update { s -> s.copy(listing = s.listing?.copy(folders = emptyList(), files = emptyList(), total = 0), selected = emptySet()) }; toast("Recycle bin emptied") }
            .onFailure { toast(it.message ?: "Could not empty bin") }
    }

    fun download(item: FileItemDto) { _events.tryEmit(FilesEvent.Download(repository.downloadUrl(item), item.name + if (item.isFolder) ".zip" else "")) }

    fun cut(items: List<FileItemDto>) { _ui.update { it.copy(clipboard = Clipboard(true, items)) }; toast("Cut ${items.size} item${if (items.size == 1) "" else "s"}") }
    fun copy(items: List<FileItemDto>) { _ui.update { it.copy(clipboard = Clipboard(false, items)) }; toast("Copied ${items.size} item${if (items.size == 1) "" else "s"}") }
    fun paste() {
        val clip = _ui.value.clipboard ?: return
        bulk(if (clip.cut) "move" else "copy", clip.items, _ui.value.query.folder) { if (clip.cut) _ui.update { it.copy(clipboard = null) } }
    }

    /** `POST /portal/files/bulk`, reconciled the web's way (portal-files.js reconcileBulk). */
    fun bulk(action: String, items: List<FileItemDto>, target: String? = null, status: String? = null, note: String? = null, done: () -> Unit = {}) = viewModelScope.launch {
        val payload = items.filter { it.id !in _ui.value.busy }
        if (payload.isEmpty()) return@launch
        payload.forEach { busy(it.id, true) }
        runCatching { repository.bulk(action, payload, target, status, note) }
            .onSuccess { res ->
                if (res.errors.isNotEmpty()) toast(res.errors.first().message) else toast("Done")
                val failed = res.errors.map { it.id }.toSet()
                val byId = res.results.associate { it.id to it.item }
                payload.filter { it.id !in failed }.forEach { ref ->
                    when (action) {
                        "delete", "forceDelete", "restore" -> remove(ref.id)
                        "favorite" -> replace(ref.copy(favorite = true))
                        "unfavorite" -> if (_ui.value.section == "favorites") remove(ref.id) else replace(ref.copy(favorite = false))
                        "move" -> { remove(ref.id); byId[ref.id]?.let { if (it.folder?.id == _ui.value.query.folder) insert(it) } }
                        "copy" -> byId[ref.id]?.let { if (it.folder?.id == _ui.value.query.folder || it.parent?.id == _ui.value.query.folder) insert(it) }
                        "review" -> byId[ref.id]?.let { replace(it) }
                    }
                }
                clearSelection(); done()
            }
            .onFailure { toast(it.message ?: "Action failed") }
        payload.forEach { busy(it.id, false) }
    }

    suspend fun pickerListing(folder: String?): ListingDto? = runCatching { repository.pickerListing(folder) }.getOrNull()

    fun absolute(url: String?) = repository.absolute(url)
    suspend fun fetchFile(id: String): FileItemDto = repository.file(id)
}
