package com.tmantoinelaw.portal.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import com.tmantoinelaw.portal.MainActivity
import com.tmantoinelaw.portal.R
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.data.notifications.NotificationDto
import com.tmantoinelaw.portal.core.network.PortalConfig
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OS notifications (prompt §12): one channel per notification group, raised
 * only while the app is not in front and the account's device channel is on,
 * title only when previews are off, tap = the item's deep link, and the
 * launcher badge follows the unread count.
 */
@Singleton
class OsNotifications @Inject constructor(private val config: PortalConfig) {

    /** The groups `GET /portal/notifications/preferences` names, as channels. */
    private val groups = listOf(
        "email" to "Email", "messages" to "Messages", "calendar" to "Calendar", "files" to "Files",
        "signatures" to "Signatures", "clients" to "Clients", "groups" to "Groups", "feed" to "Feed",
        "approvals" to "Approvals", "security" to "Security", "system" to "System updates",
    )

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        groups.forEach { (id, name) ->
            val importance = if (id == "security" || id == "approvals") NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT
            manager.createNotificationChannel(NotificationChannel(id, name, importance))
        }
        manager.createNotificationChannel(NotificationChannel(CALLS, "Calls", NotificationManager.IMPORTANCE_HIGH))
    }

    fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun show(context: Context, identity: Identity, item: NotificationDto, unread: Int) {
        if (!canPost(context) || !identity.desktopNotifications) return
        val channel = groupFor(item.module, item.type)
        val target = item.actionUrl?.let { if (it.startsWith("http")) it else config.url(it) } ?: config.url("/")
        val tap = PendingIntent.getActivity(
            context, item.id.hashCode(),
            Intent(Intent.ACTION_VIEW, target.toUri(), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_portal)
            .setContentTitle(item.title)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setGroup(channel)
            .setNumber(unread)
            .setPriority(if (item.priority == "high") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
        if (identity.notificationPreview && !item.message.isNullOrBlank()) {
            builder.setContentText(item.message).setStyle(NotificationCompat.BigTextStyle().bigText(item.message))
        }
        NotificationManagerCompat.from(context).notify(item.id.hashCode(), builder.build())
    }

    fun clearAll(context: Context) = NotificationManagerCompat.from(context).cancelAll()

    private fun groupFor(module: String, type: String): String = when {
        type.startsWith("call.") -> "messages"
        type.startsWith("cip.") -> "clients"
        type.startsWith("company.") -> "clients"
        type.startsWith("account.") -> "approvals"
        type.startsWith("file.approval") || type.startsWith("file.signature") -> "approvals"
        module in groups.map { it.first } -> module
        else -> "system"
    }

    companion object { const val CALLS = "calls" }
}
