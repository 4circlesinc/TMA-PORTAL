package com.tmantoinelaw.portal.core.data.identity

import com.tmantoinelaw.portal.core.network.api.MeDto
import com.tmantoinelaw.portal.core.network.api.RealtimeDto

/** Who is signed in, as the shell needs it. Built from `/me`; cached per device like the desktop's `tma.me`. */
data class Identity(
    val id: Long,
    val name: String,
    val firstName: String,
    val lastName: String?,
    val email: String,
    val phone: String?,
    val jobTitle: String?,
    val company: String?,
    val linkedin: String?,
    val avatar: String?,
    val accountType: String,
    val isAdmin: Boolean,
    val isStaff: Boolean,
    val cipReach: Boolean,
    val isProviderContact: Boolean,
    val isPrivateClient: Boolean,
    val capabilities: Set<String>,
    val realtime: RealtimeConfig,
    val desktopNotifications: Boolean,
    val notificationPreview: Boolean,
) {
    /** Capabilities are a courtesy from the server; every one is enforced again on the request that acts. */
    fun can(capability: String): Boolean = isAdmin || capability in capabilities
    fun canAny(vararg capabilities: String): Boolean = capabilities.any { can(it) }
}

data class RealtimeConfig(
    val enabled: Boolean,
    val key: String?,
    val host: String?,
    val port: Int,
    val scheme: String,
)

fun MeDto.toIdentity(): Identity = Identity(
    id = id,
    name = name,
    firstName = firstName?.takeIf { it.isNotBlank() } ?: name,
    lastName = lastName,
    email = email,
    phone = phone,
    jobTitle = jobTitle,
    company = company,
    linkedin = linkedin,
    avatar = avatar,
    accountType = accountType,
    isAdmin = isAdmin,
    isStaff = isStaff,
    cipReach = cipReach,
    isProviderContact = isProviderContact,
    isPrivateClient = isPrivateClient,
    capabilities = capabilities.toSet(),
    realtime = realtime.toConfig(),
    desktopNotifications = desktopNotifications.enabled,
    notificationPreview = desktopNotifications.preview,
)

private fun RealtimeDto.toConfig() = RealtimeConfig(
    enabled = enabled && !key.isNullOrBlank() && !host.isNullOrBlank(),
    key = key,
    host = host,
    port = port ?: 443,
    scheme = scheme ?: "https",
)
