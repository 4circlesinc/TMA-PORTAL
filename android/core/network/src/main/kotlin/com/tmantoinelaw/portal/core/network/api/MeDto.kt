package com.tmantoinelaw.portal.core.network.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** `GET /me` (app/Http/Controllers/MeController.php:22-77), keys verbatim. */
@Serializable
data class MeDto(
    val id: Long,
    val name: String = "",
    val firstName: String? = null,
    val lastName: String? = null,
    val email: String = "",
    val phone: String? = null,
    val jobTitle: String? = null,
    val company: String? = null,
    val linkedin: String? = null,
    val avatar: String? = null,
    val hasAvatar: Boolean = false,
    val accountType: String = "",
    val isAdmin: Boolean = false,
    val isStaff: Boolean = false,
    val cipReach: Boolean = false,
    val isProviderContact: Boolean = false,
    val isPrivateClient: Boolean = false,
    val capabilities: List<String> = emptyList(),
    val providerPhoto: String? = null,
    val realtime: RealtimeDto = RealtimeDto(),
    val toasts: JsonElement? = null,
    val desktopNotifications: DesktopNotificationsDto = DesktopNotificationsDto(),
    val workStatus: JsonElement? = null,
    val availability: JsonElement? = null,
)

@Serializable
data class RealtimeDto(
    val enabled: Boolean = false,
    val key: String? = null,
    val host: String? = null,
    val port: Int? = null,
    val scheme: String? = null,
)

@Serializable
data class DesktopNotificationsDto(val enabled: Boolean = true, val preview: Boolean = true)

@Serializable
data class PendingStatusDto(val approved: Boolean = false, val hasRole: Boolean = false)
