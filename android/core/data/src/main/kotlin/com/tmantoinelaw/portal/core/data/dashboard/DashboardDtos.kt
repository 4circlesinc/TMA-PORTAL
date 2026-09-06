package com.tmantoinelaw.portal.core.data.dashboard

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** `GET /portal/dashboard/metrics?period=` (app/Support/Dashboard/DashboardMetrics.php). */
@Serializable
data class MetricsDto(
    val staff: Boolean = false,
    val provider: Boolean = false,
    val scope: String? = null,
    val period: String? = null,
    val windowDays: Int? = null,
    val cards: Map<String, KpiCardDto> = emptyMap(),
)

@Serializable
data class KpiCardDto(val value: String = "-", val delta: String = "", val deltaUp: Boolean = false, val hint: String? = null)

/** `GET /portal/dashboard/staff` (app/Http/Controllers/StaffPresenceController.php). */
@Serializable
data class StaffDto(val staff: Boolean = false, val canManage: Boolean = false, val employees: List<EmployeeDto> = emptyList())

@Serializable
data class EmployeeDto(
    val id: Long,
    val name: String = "",
    val firstName: String? = null,
    val jobTitle: String? = null,
    val avatar: String? = null,
    val accountType: String? = null,
    val self: Boolean = false,
    val online: Boolean = false,
    val lastSeen: String? = null,
    val lastSeenAt: String? = null,
    val status: String? = null,
    val statusLabel: String? = null,
    val statusSource: String? = null,
    val statusMessage: String? = null,
    val statusIcon: String? = null,
    val workStatus: JsonElement? = null,
)

/** `GET /portal/dashboard/work?want=` (app/Http/Controllers/DashboardWorkController.php, Hub rows). */
@Serializable
data class WorkDto(
    val enabled: Boolean = false,
    val want: List<String> = emptyList(),
    val requests: List<WorkRequestDto> = emptyList(),
    val comments: List<WorkCommentDto> = emptyList(),
    val counts: WorkCountsDto? = null,
)

@Serializable
data class WorkCountsDto(val waiting: Int = 0, val sent: Int = 0, val mentions: Int = 0, val unread: Int = 0, val updates: Int = 0)

@Serializable
data class WorkFileDto(val id: String? = null, val name: String? = null, val folderId: String? = null)

@Serializable
data class WorkPersonDto(val name: String? = null, val avatar: String? = null)

@Serializable
data class WorkHeadlineDto(val text: String? = null, val tone: String? = null)

@Serializable
data class WorkRequestDto(
    val id: String,
    val typeLabel: String? = null,
    val sentAt: String? = null,
    val statusLabel: String? = null,
    val headline: WorkHeadlineDto? = null,
    val file: WorkFileDto? = null,
    val sender: WorkPersonDto? = null,
)

@Serializable
data class WorkCommentDto(
    val id: String,
    val body: String? = null,
    val deleted: Boolean = false,
    val unread: Boolean = true,
    val resolved: Boolean = false,
    val createdAt: String? = null,
    val author: WorkPersonDto? = null,
    val file: WorkFileDto? = null,
)

/** `GET /portal/cip/dashboard` (app/Support/Cip/Buckets.php:304-360). */
@Serializable
data class CipDashboardDto(
    val cip: Boolean = false,
    val staff: Boolean? = null,
    val card: Boolean? = null,
    val dashboard: String? = null,
    val buckets: List<CipBucketDto> = emptyList(),
    val total: Int? = null,
)

@Serializable
data class CipBucketDto(
    val key: String,
    val label: String = "",
    val short: String? = null,
    val count: Int = 0,
    val scope: String? = null,
    val tone: String? = null,
    val aggregate: Boolean = false,
)

/** A lean File Library listing (`GET /portal/files?section=…&lean=1`, app/Support/Files/Presenter.php). */
@Serializable
data class FilesListingDto(val folders: List<FileRowDto> = emptyList(), val files: List<FileRowDto> = emptyList())

@Serializable
data class FileRefDto(val id: String, val name: String = "")

@Serializable
data class FileRowDto(
    val id: String,
    val type: String = "file",
    val name: String = "",
    val extension: String? = null,
    val category: String? = null,
    val mime: String? = null,
    val icon: String? = null,
    val thumbUrl: String? = null,
    val previewUrl: String? = null,
    val downloadUrl: String? = null,
    val folder: FileRefDto? = null,
    val path: List<FileRefDto> = emptyList(),
    val modifiedAt: String? = null,
    val updatedAt: String? = null,
    val createdAt: String? = null,
    val fileCount: Int? = null,
    val folderCount: Int? = null,
    val colour: String? = null,
    val iconName: String? = null,
    val favorite: Boolean = false,
    val size: Long? = null,
    val sizeLabel: String? = null,
)

/** `GET /portal/mail` (bootstrap) and `GET /portal/mail/messages` rows (app/Models/MailMessage.php toRow). */
@Serializable
data class MailIndexDto(val connected: Boolean = false)

@Serializable
data class MailMessagesDto(val messages: List<MailRowDto> = emptyList())

@Serializable
data class MailRowDto(
    val id: String,
    val sender: String? = null,
    val email: String? = null,
    val subject: String? = null,
    val body: String? = null,
    val time: String? = null,
    val sentAt: String? = null,
    val unread: Boolean = false,
    val avatarUrl: String? = null,
)

/** `GET /portal/messaging/conversations` rows (app/Support/Messaging/MessagingPresenter.php:168-243), the keys the board uses. */
@Serializable
data class ConversationsDto(val conversations: List<ConversationRowDto> = emptyList())

@Serializable
data class ConversationMemberDto(val id: Long? = null, val name: String? = null, val photo: String? = null, val online: Boolean = false)

@Serializable
data class ConversationPresenceDto(val online: Boolean = false, val label: String? = null, val onlineCount: Int? = null)

@Serializable
data class ConversationRowDto(
    val id: String,
    val type: String = "direct",
    val name: String? = null,
    val photo: String? = null,
    val members: List<ConversationMemberDto> = emptyList(),
    val memberCount: Int? = null,
    val preview: String? = null,
    val reactionNote: String? = null,
    val time: String? = null,
    val timestamp: String? = null,
    val unread: Int = 0,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val muted: Boolean = false,
    val markedUnread: Boolean = false,
    val draft: String? = null,
    val presence: ConversationPresenceDto? = null,
)

/** `GET /portal/calendar/events?from&to` rows (app/Models/CalendarEvent.php:100-142), the keys the road uses. */
@Serializable
data class CalendarEventsDto(val events: List<CalendarEventRowDto> = emptyList())

@Serializable
data class CalendarEventRowDto(
    val id: String,
    val calendarId: String? = null,
    val startsAt: String = "",
    val endsAt: String = "",
    val allDay: Boolean = false,
    val title: String? = null,
    val location: String? = null,
    val colour: String? = null,
    val organizerName: String? = null,
    val private: Boolean = false,
)

/** The board's layout preferences from `GET /me/preferences` (app/Http/Controllers/PreferencesController.php). */
@Serializable
data class DashboardLayoutDto(val order: List<String> = emptyList())

@Serializable
data class BoardPrefsDto(
    val dashboardTiles: Map<String, Boolean> = emptyMap(),
    val dashboardLayout: DashboardLayoutDto = DashboardLayoutDto(),
    val dashboardWorkflowStrip: Boolean = true,
)
