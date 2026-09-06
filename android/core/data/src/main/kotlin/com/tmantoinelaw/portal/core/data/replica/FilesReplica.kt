package com.tmantoinelaw.portal.core.data.replica

import com.tmantoinelaw.portal.core.data.files.FileItemDto
import com.tmantoinelaw.portal.core.data.files.ListingDto
import com.tmantoinelaw.portal.core.data.files.ListingQuery
import com.tmantoinelaw.portal.core.data.dashboard.FileRefDto
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import com.tmantoinelaw.portal.core.database.ReplicaDao
import com.tmantoinelaw.portal.core.database.ReplicaFileEntity
import com.tmantoinelaw.portal.core.database.ReplicaFolderEntity
import com.tmantoinelaw.portal.core.database.SyncCursorEntity
import com.tmantoinelaw.portal.core.network.Connectivity
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import com.tmantoinelaw.portal.core.network.api.PortalJson
import com.tmantoinelaw.portal.core.network.session.SessionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import javax.inject.Inject
import javax.inject.Singleton

/** `GET /portal/files/sync` (app/Http/Controllers/Files/SyncController.php:19-150). Rows are records or tombstones. */
@Serializable
data class FilesSyncPage(val folders: List<JsonObject> = emptyList(), val files: List<JsonObject> = emptyList(), val cursor: JsonElement? = null, val more: Boolean = false)

/** What the sync pill shows: "Syncing for offline, N records" while running. */
data class ReplicaProgress(val source: String, val taken: Int, val running: Boolean)

/**
 * The File Library's replica walker (public/js/portal-replica.js + files-sync.js,
 * prompt §9.1): follow the folders/files cursor page by page into Room,
 * save the cursor after every page, stop at 30 pages per wake. Wakes:
 * a connection returning, a queued write landing, and `/me` answering.
 */
@Singleton
class FilesReplica @Inject constructor(
    private val http: PortalHttp,
    private val dao: ReplicaDao,
    private val session: SessionRepository,
    private val state: SessionState,
    private val connectivity: Connectivity,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = Mutex()
    private val _progress = MutableStateFlow(ReplicaProgress("files", 0, false))
    val progress: StateFlow<ReplicaProgress> = _progress.asStateFlow()

    init {
        session.identity.filter { it != null }.distinctUntilChanged { a, b -> a?.id == b?.id }.onEach { run() }.launchIn(scope)
        connectivity.online.filter { it }.onEach { run() }.launchIn(scope)
        session.signedOut.onEach { clearAll() }.launchIn(scope)
    }

    /** One walk, one at a time; a second wake while running is ignored (the running one saves as it goes). */
    fun run() { scope.launch { walk() } }

    suspend fun walk(maxPages: Int = 30): Int {
        if (!running.tryLock()) return 0
        try {
            val account = state.accountId.value ?: return 0
            var cursor: JsonElement? = dao.cursor(account, WALKER)?.let { runCatching { PortalJson.parseToJsonElement(it.json) }.getOrNull() }
            var taken = 0
            repeat(maxPages) {
                val page = try { http.get("/portal/files/sync" + query(cursor), FilesSyncPage.serializer()) } catch (e: Exception) { return taken }
                keep(account, page)
                taken += page.folders.size + page.files.size
                _progress.value = ReplicaProgress(WALKER, taken, true)
                page.cursor?.let { dao.putCursor(SyncCursorEntity(account, WALKER, it.toString(), System.currentTimeMillis())) }
                cursor = page.cursor
                if (!page.more) { _progress.value = ReplicaProgress(WALKER, taken, false); return taken }
            }
            _progress.value = ReplicaProgress(WALKER, taken, false)
            return taken
        } finally {
            running.unlock()
        }
    }

    private fun query(cursor: JsonElement?): String {
        val c = cursor as? JsonObject ?: return ""
        fun part(name: String, key: String) = (c[name] as? JsonObject)?.get(key)?.let { (it as? JsonPrimitive)?.content }
        val parts = listOfNotNull(
            part("folders", "since")?.let { "foldersSince=$it" }, part("folders", "after")?.let { "foldersAfter=$it" },
            part("files", "since")?.let { "filesSince=$it" }, part("files", "after")?.let { "filesAfter=$it" },
        )
        return if (parts.isEmpty()) "" else "?" + parts.joinToString("&")
    }

    private suspend fun keep(account: Long, page: FilesSyncPage) {
        val deletedFolders = page.folders.filter { it["deleted"]?.jsonPrimitive?.content == "true" }.map { it.getValue("id").jsonPrimitive.content }
        val deletedFiles = page.files.filter { it["deleted"]?.jsonPrimitive?.content == "true" }.map { it.getValue("id").jsonPrimitive.content }
        if (deletedFolders.isNotEmpty()) dao.deleteFolders(account, deletedFolders)
        if (deletedFiles.isNotEmpty()) dao.deleteFiles(account, deletedFiles)
        val folders = page.folders.filter { it["deleted"]?.jsonPrimitive?.content != "true" }.mapNotNull { obj ->
            val dto = runCatching { PortalJson.decodeFromJsonElement(FileItemDto.serializer(), obj) }.getOrNull() ?: return@mapNotNull null
            ReplicaFolderEntity(account, dto.id, dto.parent?.id, dto.name, obj.toString(), dto.updatedAt ?: dto.modifiedAt ?: "")
        }
        val files = page.files.filter { it["deleted"]?.jsonPrimitive?.content != "true" }.mapNotNull { obj ->
            val dto = runCatching { PortalJson.decodeFromJsonElement(FileItemDto.serializer(), obj) }.getOrNull() ?: return@mapNotNull null
            ReplicaFileEntity(account, dto.id, dto.folder?.id, dto.owner?.userId, dto.name, obj.toString(), dto.updatedAt ?: dto.modifiedAt ?: "")
        }
        if (folders.isNotEmpty()) dao.putFolders(folders)
        if (files.isNotEmpty()) dao.putFiles(files)
    }

    /** A weekly full walk: the two honest limits (purged bins, revoked shares) leave no tombstone. */
    suspend fun resetAndWalk() {
        val account = state.accountId.value ?: return
        dao.clearCursor(account, WALKER); dao.clearFolders(account); dao.clearFiles(account)
        walk()
    }

    private suspend fun clearAll() {
        _progress.value = ReplicaProgress(WALKER, 0, false)
    }

    /**
     * The offline listing (portal-files.js assembleFromReplica): only All Files
     * and My Files at the root, and any folder's children; no search or filters;
     * folders first, sorted by name or modified; My Files needs the account id.
     * Anything else refuses, because a wrong listing offline is worse than none.
     */
    suspend fun assemble(q: ListingQuery): ListingDto? {
        val account = state.accountId.value ?: return null
        if (!q.isPlain) return null
        if (q.folder == null && q.section != "all" && q.section != "my") return null
        var folders = dao.childFolders(account, q.folder).mapNotNull { decode(it.json) }
        var files = dao.childFiles(account, q.folder).mapNotNull { decode(it.json) }
        if (folders.isEmpty() && files.isEmpty() && dao.fileCount(account) == 0 && dao.folderCount(account) == 0) return null
        if (q.folder == null && q.section == "my") {
            folders = folders.filter { it.owner?.userId == account }
            files = files.filter { it.owner?.userId == account }
        }
        val dir = if (q.dir == "desc") -1 else 1
        val cmp: Comparator<FileItemDto> = if (q.sort == "modified") compareBy { it.modifiedAt ?: "" } else compareBy(String.CASE_INSENSITIVE_ORDER) { it.name }
        folders = folders.sortedWith(cmp).let { if (dir < 0) it.reversed() else it }
        files = files.sortedWith(cmp).let { if (dir < 0) it.reversed() else it }
        val crumb = ArrayList<FileRefDto>()
        var hop = q.folder?.let { dao.folder(account, it) }?.let { decode(it.json) }
        while (hop != null) { crumb.add(0, FileRefDto(hop.id, hop.name)); hop = hop.parent?.id?.let { dao.folder(account, it) }?.let { decode(it.json) } }
        val total = folders.size + files.size
        val offset = (q.page - 1) * q.perPage
        val pageFolders = folders.drop(offset).take(q.perPage)
        val fileOffset = maxOf(0, offset - folders.size)
        val pageFiles = files.drop(fileOffset).take(q.perPage - pageFolders.size)
        return ListingDto(section = q.section, folder = q.folder?.let { id -> com.tmantoinelaw.portal.core.data.files.FolderMetaDto(id, crumb.lastOrNull()?.name ?: "") }, breadcrumb = crumb, folders = pageFolders, files = pageFiles, page = q.page, perPage = q.perPage, total = total, hasMore = offset + q.perPage < total)
    }

    suspend fun file(id: String): FileItemDto? = state.accountId.value?.let { a -> dao.file(a, id)?.let { decode(it.json) } }

    private fun decode(json: String) = runCatching { PortalJson.decodeFromString(FileItemDto.serializer(), json) }.getOrNull()

    private companion object { const val WALKER = "files" }
}
