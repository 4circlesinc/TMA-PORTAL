package com.tmantoinelaw.portal.core.data.files

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** `GET /portal/files/files/{uuid}/details` (app/Support/Files/FileDetails.php). */
@Serializable
data class DetailsDto(val counts: Map<String, Int> = emptyMap(), val groups: List<DetailGroupDto> = emptyList())

@Serializable
data class DetailGroupDto(val title: String = "", val rows: List<DetailRowDto> = emptyList())

@Serializable
data class DetailRowDto(val label: String = "", val value: String? = null)

/** `GET /portal/files/files/{uuid}/activity?filter&before` (app/Support/Files/ActivityFeed.php). */
@Serializable
data class ActivityFeedDto(val filter: String = "all", val entries: List<ActivityEntryDto> = emptyList(), val nextCursor: Long? = null, val filters: List<FilterOptionDto> = emptyList())

@Serializable
data class FilterOptionDto(val value: String, val label: String = "")

@Serializable
data class ActivityActorDto(val name: String? = null, val isSelf: Boolean = false, val email: String? = null, val avatar: String? = null)

@Serializable
data class ActivityEntryDto(val id: Long, val action: String = "", val text: String = "", val actor: ActivityActorDto? = null, val icon: String? = null, val meta: JsonElement? = null, val at: String = "", val group: String = "")

/** `GET /portal/files/files/{uuid}/access` (app/Support/Files/AccessSources.php). */
@Serializable
data class AccessDto(val sources: List<AccessSourceDto> = emptyList(), val canManage: Boolean = false, val shared: JsonElement? = null)

@Serializable
data class AccessMemberDto(val userId: Long? = null, val name: String? = null, val email: String? = null, val avatar: String? = null, val role: String? = null, val label: String? = null)

@Serializable
data class AccessSourceDto(val key: String = "", val label: String = "", val detail: String? = null, val role: String? = null, val icon: String? = null, val origin: String? = null, val total: Int = 0, val members: List<AccessMemberDto> = emptyList(), val truncated: Boolean = false)

/** `GET /portal/files/files/{uuid}/comments` (app/Support/Files/CommentPresenter.php:87-116). */
@Serializable
data class CommentsDto(val threads: List<CommentDto> = emptyList(), val nextCursor: Long? = null, val openCount: Int = 0, val total: Int = 0, val canComment: Boolean = false, val readCleared: Boolean = false)

@Serializable
data class CommentAuthorDto(val id: Long? = null, val name: String? = null, val isSelf: Boolean = false, val email: String? = null, val avatar: String? = null)

@Serializable
data class CommentAnchorDto(val page: Int = 1, val x: Double = 0.0, val y: Double = 0.0, val w: Double = 0.0, val h: Double = 0.0)

@Serializable
data class CommentCanDto(val edit: Boolean = false, val delete: Boolean = false, val resolve: Boolean = false, val reply: Boolean = false)

@Serializable
data class CommentMentionDto(val id: Long, val name: String = "")

@Serializable
data class CommentDto(
    val id: String,
    val body: String? = null,
    val anchor: CommentAnchorDto? = null,
    val deleted: Boolean = false,
    val author: CommentAuthorDto? = null,
    val mentions: List<CommentMentionDto> = emptyList(),
    val createdAt: String = "",
    val editedAt: String? = null,
    val resolved: Boolean = false,
    val resolvedAt: String? = null,
    val resolvedBy: String? = null,
    val replyCount: Int = 0,
    val isReply: Boolean = false,
    val can: CommentCanDto = CommentCanDto(),
    val replies: List<CommentDto> = emptyList(),
)

/** `GET /portal/files/files/{uuid}/versions` (app/Http/Controllers/Files/FileVersionController.php:25-70). */
@Serializable
data class VersionsDto(val canAddVersion: Boolean = false, val current: String? = null, val versions: List<VersionDto> = emptyList())

@Serializable
data class VersionPersonDto(val name: String? = null, val email: String? = null, val avatar: String? = null)

@Serializable
data class VersionCanDto(val download: Boolean = false, val preview: Boolean = false, val restore: Boolean = false)

@Serializable
data class VersionDto(
    val id: String,
    val number: Int = 1,
    val isCurrent: Boolean = false,
    val size: Long? = null,
    val sizeLabel: String? = null,
    val mime: String? = null,
    val extension: String? = null,
    val category: String? = null,
    val checksum: String? = null,
    val note: String? = null,
    val restoredFrom: Int? = null,
    val approvalStatus: String? = null,
    val uploadedAt: String = "",
    val uploadedBy: VersionPersonDto? = null,
    val can: VersionCanDto = VersionCanDto(),
)

@Serializable
data class StatusOkDto(val status: String = "ok")
