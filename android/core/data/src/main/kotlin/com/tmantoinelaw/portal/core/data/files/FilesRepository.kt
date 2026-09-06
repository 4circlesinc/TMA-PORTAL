package com.tmantoinelaw.portal.core.data.files

import com.tmantoinelaw.portal.core.data.realtime.RealtimeCoordinator
import com.tmantoinelaw.portal.core.data.store.SnapshotStore
import com.tmantoinelaw.portal.core.network.api.PortalException
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import kotlinx.coroutines.flow.SharedFlow
import com.tmantoinelaw.portal.core.data.queue.deliverOrQueue
import okhttp3.HttpUrl.Companion.toHttpUrl
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.SocketTimeoutException
import javax.inject.Inject
import javax.inject.Singleton

/** What a listing load came back with: the rows, and where they came from. */
sealed interface ListingResult {
    data class Fresh(val listing: ListingDto) : ListingResult
    /** The server could not answer; the caller decides between the snapshot, the replica and an error. */
    data class Failed(val message: String, val offline: Boolean) : ListingResult
}

/**
 * The File Library's HTTP layer (public/js/portal-files.js, prompt §11.6).
 * Plain listings are remembered as snapshots so a folder browsed once opens
 * offline; searches and filtered views are deliberately not (docs/offline-plan.md).
 */
@Singleton
class FilesRepository @Inject constructor(
    private val http: PortalHttp,
    private val snapshots: SnapshotStore,
    private val jar: com.tmantoinelaw.portal.core.network.cookies.PersistentCookieJar,
    private val queue: com.tmantoinelaw.portal.core.data.queue.WriteQueue,
    realtime: RealtimeCoordinator,
) {
    private fun intent(kind: String, label: String, method: String, path: String, body: JsonElement?) =
        com.tmantoinelaw.portal.core.data.queue.WriteIntent(kind, label, method, http.config.url(path), body)

    /** Rename, tried on the network first and queued on a delivery failure (prompt §9.4). */
    suspend fun renameOrQueue(item: FileItemDto, name: String) = queue.deliverOrQueue(
        intent("files.rename", "Rename “${item.name}”", "PATCH", if (item.isFolder) "/portal/files/folders/${item.id}" else "/portal/files/files/${item.id}", buildJsonObject { put("name", name) }),
    ) { rename(item, name) }

    suspend fun toggleFavoriteOrQueue(item: FileItemDto) = queue.deliverOrQueue(
        intent("files.favorite", (if (item.favorite) "Remove “" else "Favourite “") + item.name + "”", "POST", "/portal/files/favorites/toggle", buildJsonObject { put("type", item.type); put("id", item.id) }),
    ) { toggleFavorite(item) }

    suspend fun deleteOrQueue(item: FileItemDto) = queue.deliverOrQueue(
        intent("files.delete", "Delete “${item.name}”", "DELETE", if (item.isFolder) "/portal/files/folders/${item.id}" else "/portal/files/files/${item.id}", null),
    ) { delete(item) }

    suspend fun restoreOrQueue(item: FileItemDto) = queue.deliverOrQueue(
        intent("files.restore", "Restore “${item.name}”", "POST", (if (item.isFolder) "/portal/files/folders/" else "/portal/files/files/") + item.id + "/restore", null),
    ) { restore(item) }

    suspend fun createFolderOrQueue(name: String, parent: String?) = queue.deliverOrQueue(
        intent("files.folder", "New folder “$name”", "POST", "/portal/files/folders", buildJsonObject { put("name", name); parent?.let { put("parent", it) } }),
    ) { createFolder(name, parent) }

    /** The `files` signal: refetch the open listing (300 ms coalesced upstream). */
    val changed: SharedFlow<String> = realtime.dataChanged

    fun snapshotKey(q: ListingQuery): String? = if (q.isPlain && q.page == 1) "files:list:${q.section}:${q.folder ?: "root"}:${q.sort}:${q.dir}" else null

    suspend fun cached(q: ListingQuery): ListingDto? = snapshotKey(q)?.let { snapshots.read(it, ListingDto.serializer()) }

    /** 45 s cap, one retry on 502/504 (portal-files.js:452-590). */
    suspend fun list(q: ListingQuery): ListingResult {
        suspend fun once(): ListingDto = withTimeout(45_000) { http.get("/portal/files?${q.toQueryString()}", ListingDto.serializer()) }
        return try {
            val listing = try { once() } catch (e: PortalException) { if (e.status == 502 || e.status == 504) once() else throw e }
            snapshotKey(q)?.let { snapshots.write(it, listing, ListingDto.serializer()) }
            ListingResult.Fresh(listing)
        } catch (e: PortalException) {
            ListingResult.Failed(if (e.status == 502 || e.status == 504) "The File Library is busy. Try again in a moment." else e.message, offline = false)
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            ListingResult.Failed("This folder is taking too long to load.", offline = false)
        } catch (e: SocketTimeoutException) {
            ListingResult.Failed("This folder is taking too long to load.", offline = true)
        } catch (e: IOException) {
            ListingResult.Failed("Could not load this folder.", offline = true)
        }
    }

    suspend fun createFolder(name: String, parent: String?): FileItemDto =
        http.post("/portal/files/folders", buildJsonObject { put("name", name); parent?.let { put("parent", it) } }, FileItemDto.serializer())

    suspend fun rename(item: FileItemDto, name: String): FileItemDto =
        http.patch(if (item.isFolder) "/portal/files/folders/${item.id}" else "/portal/files/files/${item.id}", buildJsonObject { put("name", name) }, FileItemDto.serializer())

    suspend fun delete(item: FileItemDto) { http.delete(if (item.isFolder) "/portal/files/folders/${item.id}" else "/portal/files/files/${item.id}", null, OkDto.serializer()) }

    suspend fun restore(item: FileItemDto): FileItemDto =
        http.post((if (item.isFolder) "/portal/files/folders/" else "/portal/files/files/") + item.id + "/restore", null, FileItemDto.serializer())

    suspend fun forceDelete(item: FileItemDto) { http.delete((if (item.isFolder) "/portal/files/folders/" else "/portal/files/files/") + item.id + "/force", null, OkDto.serializer()) }

    suspend fun toggleFavorite(item: FileItemDto): Boolean =
        http.post("/portal/files/favorites/toggle", buildJsonObject { put("type", item.type); put("id", item.id) }, FavoriteAnswerDto.serializer()).favorite

    suspend fun emptyBin(): OkDto = http.post("/portal/files/recycle-bin/empty", null, OkDto.serializer())

    /** `POST /portal/files/bulk` (app/Http/Controllers/Files/BulkController.php:30-98). */
    suspend fun bulk(action: String, items: List<FileItemDto>, target: String? = null, status: String? = null, note: String? = null): BulkAnswerDto =
        http.post("/portal/files/bulk", buildJsonObject {
            put("action", action)
            put("items", buildJsonArray { items.forEach { add(buildJsonObject { put("type", it.type); put("id", it.id) }) } })
            put("target", target?.let { JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
            status?.let { put("status", it) }
            note?.let { put("note", it) }
        }, BulkAnswerDto.serializer())

    suspend fun setColour(folder: FileItemDto, colour: String?): FileItemDto =
        http.patch("/portal/files/folders/${folder.id}/colour", buildJsonObject { put("colour", colour?.let { JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull) }, FileItemDto.serializer())

    suspend fun setIcon(folder: FileItemDto, icon: String): FileItemDto =
        http.patch("/portal/files/folders/${folder.id}/icon", buildJsonObject { put("icon", icon) }, FileItemDto.serializer())

    /** Subfolders for the Move to / Copy to picker (portal-files.js openDestinationPicker): `section=my`, 200 per page, by name. */
    suspend fun pickerListing(folder: String?): ListingDto =
        http.get("/portal/files?section=my${folder?.let { "&folder=$it" } ?: ""}&perPage=200&sort=name", ListingDto.serializer())

    fun downloadUrl(item: FileItemDto): String =
        if (item.isFolder) http.config.url("/portal/files/folders/${item.id}/download") else (item.downloadUrl ?: http.config.url("/portal/files/files/${item.id}/download"))

    fun absolute(url: String?): String? = url?.let { if (it.startsWith("http")) it else http.config.url(it) }

    suspend fun file(id: String): FileItemDto = http.get("/portal/files/files/$id", FileItemDto.serializer())

    suspend fun rawJson(path: String): JsonElement = http.getJson(path)

    suspend fun <T> get(path: String, serializer: kotlinx.serialization.KSerializer<T>): T = http.get(path, serializer)
    suspend fun <T> post(path: String, body: JsonElement?, serializer: kotlinx.serialization.KSerializer<T>): T = http.post(path, body, serializer)
    suspend fun <T> patch(path: String, body: JsonElement?, serializer: kotlinx.serialization.KSerializer<T>): T = http.patch(path, body, serializer)
    suspend fun <T> delete(path: String, body: JsonElement?, serializer: kotlinx.serialization.KSerializer<T>): T = http.delete(path, body, serializer)

    /** The `Cookie` header for media players and downloaders that cannot use the jar. */
    fun cookieHeader(url: String): String = jar.cookieHeader((if (url.startsWith("http")) url else http.config.url(url)).toHttpUrl())
    val userAgent: String get() = http.config.userAgent
}

/* ── The viewer's side panels (prompt §11.6, appendix A3 §7-9) ─────────── */

suspend fun FilesRepository.details(id: String): DetailsDto = get("/portal/files/files/$id/details", DetailsDto.serializer())
suspend fun FilesRepository.activity(id: String, filter: String, before: Long?): ActivityFeedDto =
    get("/portal/files/files/$id/activity?filter=$filter" + (before?.let { "&before=$it" } ?: ""), ActivityFeedDto.serializer())
suspend fun FilesRepository.access(id: String): AccessDto = get("/portal/files/files/$id/access", AccessDto.serializer())
/** `peek=1` reads without marking the file's threads read. */
suspend fun FilesRepository.comments(id: String, peek: Boolean): CommentsDto = get("/portal/files/files/$id/comments" + if (peek) "?peek=1" else "", CommentsDto.serializer())
suspend fun FilesRepository.postComment(id: String, body: String, parent: String?): CommentDto =
    post("/portal/files/files/$id/comments", kotlinx.serialization.json.buildJsonObject { put("body", body); parent?.let { put("parent", it) } }, CommentDto.serializer())
suspend fun FilesRepository.editComment(id: String, comment: String, body: String): CommentDto =
    patch("/portal/files/files/$id/comments/$comment", kotlinx.serialization.json.buildJsonObject { put("body", body) }, CommentDto.serializer())
suspend fun FilesRepository.deleteComment(id: String, comment: String) { delete("/portal/files/files/$id/comments/$comment", null, StatusOkDto.serializer()) }
suspend fun FilesRepository.resolveComment(id: String, comment: String, resolved: Boolean): CommentDto =
    post("/portal/files/files/$id/comments/$comment/resolve", kotlinx.serialization.json.buildJsonObject { put("resolved", resolved) }, CommentDto.serializer())
suspend fun FilesRepository.versions(id: String): VersionsDto = get("/portal/files/files/$id/versions", VersionsDto.serializer())
suspend fun FilesRepository.restoreVersion(id: String, version: String): JsonElement =
    post("/portal/files/files/$id/versions/$version/restore", kotlinx.serialization.json.buildJsonObject { }, JsonElement.serializer())
fun FilesRepository.versionPreviewUrl(id: String, version: String) = absolute("/portal/files/files/$id/versions/$version/preview")!!
fun FilesRepository.versionDownloadUrl(id: String, version: String) = absolute("/portal/files/files/$id/versions/$version/download")!!
/** Presence: say we are viewing; the server prunes after 10 min of silence. */
suspend fun FilesRepository.presence(id: String, session: String, leaving: Boolean) {
    runCatching {
        if (leaving) delete("/portal/files/files/$id/presence", kotlinx.serialization.json.buildJsonObject { put("session", session) }, JsonElement.serializer())
        else post("/portal/files/files/$id/presence", kotlinx.serialization.json.buildJsonObject { put("session", session); put("action", "viewing"); put("device", "android") }, JsonElement.serializer())
    }
}
