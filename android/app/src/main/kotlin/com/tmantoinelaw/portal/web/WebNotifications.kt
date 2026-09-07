package com.tmantoinelaw.portal.web

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.tmantoinelaw.portal.MainActivity
import com.tmantoinelaw.portal.core.ui.R
import org.json.JSONObject

/**
 * The page's `new Notification(title, {body, tag, data:{url}})` (notify-store.js,
 * messaging-calls.js, messages.js), shown in the Android shade the way Chromium
 * shows it on the desktop. A tap brings the app forward and hands the click
 * back to the page's own onclick.
 */
object WebNotifications {
    private const val CHANNEL = "portal"
    const val EXTRA_ID = "tma.notification.id"
    const val EXTRA_URL = "tma.notification.url"

    fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Portal", NotificationManager.IMPORTANCE_HIGH).apply { description = "Messages, email, files, calendar and applications" })
        }
    }

    fun show(context: Context, note: JSONObject) {
        ensureChannel(context)
        val id = note.optInt("id")
        val url = note.optString("url")
        val tap = Intent(context, MainActivity::class.java).apply {
            action = "tma.notification.$id"
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_ID, id)
            putExtra(EXTRA_URL, url)
        }
        val pending = PendingIntent.getActivity(context, id, tap, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_bell)
            .setContentTitle(note.optString("title"))
            .setContentText(note.optString("body"))
            .setStyle(NotificationCompat.BigTextStyle().bigText(note.optString("body")))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setSilent(note.optBoolean("silent"))
        note.optString("tag").takeIf { it.isNotBlank() }?.let { builder.setGroup(it) }
        runCatching { NotificationManagerCompat.from(context).notify(id, builder.build()) }
    }

    fun close(context: Context, id: Int) = NotificationManagerCompat.from(context).cancel(id)
}
