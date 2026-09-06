package com.tmantoinelaw.portal.core.data.notifications

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** `NotificationPresenter::notification` (app/Support/Notifications/NotificationPresenter.php:23-47), keys verbatim. */
@Serializable
data class NotificationDto(
    val id: String,
    val type: String = "",
    val level: String = "info",
    val module: String = "system",
    val priority: String = "normal",
    val title: String = "",
    val message: String? = null,
    val icon: String? = null,
    val image: String? = null,
    val isSystem: Boolean = false,
    val actor: ActorDto? = null,
    val actionUrl: String? = null,
    val actionLabel: String? = null,
    val subjectType: String? = null,
    val subjectId: String? = null,
    val read: Boolean = false,
    val readAt: String? = null,
    val requiresAction: Boolean = false,
    val completed: Boolean = false,
    val createdAt: String = "",
    val meta: JsonElement? = null,
)

@Serializable
data class ActorDto(val id: Long? = null, val name: String? = null, val avatar: String? = null)

@Serializable
data class NotificationsPage(val items: List<NotificationDto> = emptyList(), val nextCursor: Long? = null, val unread: Int = 0)

@Serializable
data class NotificationCounts(val unread: Int = 0, val actionRequired: Int = 0)

@Serializable
data class NotificationItemAnswer(val item: NotificationDto? = null, val unread: Int = 0)

@Serializable
data class UnreadAnswer(val unread: Int = 0, val ok: Boolean = true, val affected: Int = 0)
