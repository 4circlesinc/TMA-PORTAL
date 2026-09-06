package com.tmantoinelaw.portal.core.data.files

import com.tmantoinelaw.portal.core.data.dashboard.FilePersonDto
import com.tmantoinelaw.portal.core.data.dashboard.FileRefDto
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** `permissions` on a file or folder (app/Support/Files/Presenter.php); a missing key means allowed, `false` means refused. */
@Serializable
data class PermissionsDto(
    val view: Boolean? = null, val preview: Boolean? = null, val download: Boolean? = null, val upload: Boolean? = null,
    val rename: Boolean? = null, val move: Boolean? = null, val copy: Boolean? = null, val delete: Boolean? = null,
    val share: Boolean? = null, val assign: Boolean? = null, val review: Boolean? = null, val colour: Boolean? = null,
    val icon: Boolean? = null, val restore: Boolean? = null,
) {
    fun allows(ability: String): Boolean = when (ability) {
        "view" -> view; "preview" -> preview; "download" -> download; "upload" -> upload; "rename" -> rename; "move" -> move
        "copy" -> copy; "delete" -> delete; "share" -> share; "assign" -> assign; "review" -> review; "colour" -> colour
        "icon" -> icon; "restore" -> restore; else -> null
    } != false
}

@Serializable
data class CommentsChipDto(val open: Int = 0, val unread: Int = 0, val mentionsMe: Boolean = false)

@Serializable
data class StatusChipDto(val status: String? = null, val label: String? = null, val tone: String? = null)

@Serializable
data class AudienceDto(val label: String? = null, val role: String? = null, val count: Int? = null)

/**
 * One row of the File Library: a file or a folder (`type`), the union of the
 * File and Folder shapes in app/Support/Files/Presenter.php:188-320.
 */
@Serializable
data class FileItemDto(
    val id: String,
    val type: String = "file",
    val name: String = "",
    val extension: String? = null,
    val category: String? = null,
    val mime: String? = null,
    val icon: String? = null,
    val iconName: String? = null,
    val colour: String? = null,
    val folderType: String? = null,
    val previewable: Boolean = false,
    val size: Long? = null,
    val sizeLabel: String? = null,
    val versionNumber: Int? = null,
    val comments: CommentsChipDto? = null,
    val folder: FileRefDto? = null,
    val parent: FileRefDto? = null,
    val path: List<FileRefDto> = emptyList(),
    val createdAt: String? = null,
    val uploadedAt: String? = null,
    val modifiedAt: String? = null,
    val updatedAt: String? = null,
    val deletedAt: String? = null,
    val owner: FilePersonDto? = null,
    val uploadedBy: FilePersonDto? = null,
    val createdBy: FilePersonDto? = null,
    val people: List<FilePersonDto> = emptyList(),
    val peopleTotal: Int? = null,
    val audience: AudienceDto? = null,
    val assignedTo: List<String> = emptyList(),
    val shared: Boolean = false,
    val favorite: Boolean = false,
    val status: StatusChipDto? = null,
    val review: JsonElement? = null,
    val permissions: PermissionsDto? = null,
    val packageLocked: Boolean = false,
    val fileCount: Int? = null,
    val folderCount: Int? = null,
    val downloadUrl: String? = null,
    val previewUrl: String? = null,
    val thumbUrl: String? = null,
) {
    val isFolder get() = type == "folder"
    fun can(ability: String): Boolean = permissions?.allows(ability) ?: true
    /** Counts that were not sent must not read as zero (portal-files.js folderLooksEmpty). */
    val looksEmpty: Boolean get() = isFolder && fileCount != null && folderCount != null && (fileCount + folderCount) == 0
}

@Serializable
data class FolderMetaDto(val id: String, val name: String = "", val permissions: PermissionsDto? = null, val packageLocked: Boolean = false)

@Serializable
data class OwnerFacetDto(val id: Long, val name: String = "", val n: Int = 0)

@Serializable
data class CountsDto(val folders: Int = 0, val files: Int = 0)

/** `GET /portal/files` (app/Http/Controllers/Files/BrowserController.php:161-177). */
@Serializable
data class ListingDto(
    val section: String = "all",
    val folder: FolderMetaDto? = null,
    val breadcrumb: List<FileRefDto> = emptyList(),
    val folders: List<FileItemDto> = emptyList(),
    val files: List<FileItemDto> = emptyList(),
    val page: Int = 1,
    val perPage: Int = 60,
    val total: Int = 0,
    val hasMore: Boolean = false,
    val counts: CountsDto? = null,
    val owners: List<OwnerFacetDto> = emptyList(),
)

@Serializable
data class BulkErrorDto(val id: String, val message: String = "")

@Serializable
data class BulkResultDto(val id: String, val type: String = "file", val item: FileItemDto? = null)

@Serializable
data class BulkAnswerDto(val ok: Boolean = true, val processed: Int = 0, val errors: List<BulkErrorDto> = emptyList(), val results: List<BulkResultDto> = emptyList())

@Serializable
data class FavoriteAnswerDto(val favorite: Boolean = false)

@Serializable
data class OkDto(val ok: Boolean = true, val files: Int = 0, val folders: Int = 0)

/** The listing request, the web's `listingParams()` (portal-files.js:365-377). */
data class ListingQuery(
    val section: String = "all",
    val folder: String? = null,
    val search: String = "",
    val type: String? = null,
    val owner: Long? = null,
    val sort: String = "name",
    val dir: String = "asc",
    val perPage: Int = 50,
    val page: Int = 1,
) {
    val isPlain get() = search.isBlank() && type == null && owner == null
    fun toQueryString(): String = buildString {
        append("section=").append(section)
        folder?.let { append("&folder=").append(it) }
        if (search.isNotBlank()) append("&search=").append(java.net.URLEncoder.encode(search, "UTF-8"))
        type?.let { append("&type=").append(it) }
        owner?.let { append("&owner=").append(it) }
        append("&sort=").append(sort).append("&dir=").append(dir)
        append("&perPage=").append(perPage).append("&page=").append(page)
    }
}
