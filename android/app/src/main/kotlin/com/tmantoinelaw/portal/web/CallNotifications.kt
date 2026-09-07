package com.tmantoinelaw.portal.web

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import com.tmantoinelaw.portal.MainActivity
import com.tmantoinelaw.portal.core.ui.R
import org.json.JSONObject

/**
 * The desktop's incoming-call panel (desktop/call-window.js): the caller's
 * name with Accept and Decline, raised only when the app is not in front.
 * Accept and Decline land on the page's own `TMAMessagingCalls.accept()` /
 * `.decline()`, the same code paths as the in-page buttons. The page rings
 * with its own ringtone, so the notification itself is silent.
 *
 * One shade entry: the foreground service *is* this notification (CallStyle
 * while it rings, "in progress" once answered). A second "Ringing" tile was
 * the same call announced twice.
 */
object CallNotifications {
    const val CHANNEL = "calls"
    const val INCOMING_ID = 7001
    const val ONGOING_ID = 7002
    const val ACTION_ANSWER = "tma.call.answer"
    const val ACTION_DECLINE = "tma.call.decline"
    const val ACTION_OPEN = "tma.call.open"
    private val BRAND = Color.parseColor("#136DA0")

    fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Calls", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Incoming and ongoing calls"
                setSound(null, null)
                enableVibration(true)
            })
        }
    }

    /** `data-tma-call-info` as the page wrote it: `{name, avatar, media}` (messaging-calls.js). */
    data class Info(val name: String, val media: String) {
        companion object {
            fun parse(raw: String?): Info = runCatching {
                val o = JSONObject(raw ?: "")
                Info(o.optString("name").ifBlank { "Unknown caller" }, o.optString("media").ifBlank { "audio" })
            }.getOrDefault(Info("Incoming call", "audio"))
        }
    }

    private fun activityIntent(context: Context, action: String) = PendingIntent.getActivity(
        context, action.hashCode(),
        Intent(context, MainActivity::class.java).setAction(action).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun markBitmap(context: Context) = BitmapFactory.decodeResource(context.resources, R.drawable.logo_mark)

    private fun brand(builder: NotificationCompat.Builder, context: Context): NotificationCompat.Builder {
        builder.setSmallIcon(R.drawable.ic_stat_tma).setColor(BRAND).setOnlyAlertOnce(true)
        markBitmap(context)?.let { builder.setLargeIcon(it) }
        return builder
    }

    /** Incoming CallStyle, used as the ringing foreground-service notification. */
    fun incoming(context: Context, info: Info): Notification {
        ensureChannel(context)
        val person = Person.Builder().setName(info.name).setImportant(true)
            .setIcon(IconCompat.createWithResource(context, R.drawable.logo_mark)).build()
        val decline = activityIntent(context, ACTION_DECLINE)
        val answer = activityIntent(context, ACTION_ANSWER)
        return brand(NotificationCompat.Builder(context, CHANNEL), context)
            .setContentTitle(info.name)
            .setContentText(if (info.media == "video") "Incoming video call" else "Incoming call")
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer).setIsVideo(info.media == "video"))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setFullScreenIntent(activityIntent(context, ACTION_OPEN), true)
            .setContentIntent(activityIntent(context, ACTION_OPEN))
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setOngoing(true)
            .setSilent(true)
            .setAutoCancel(false)
            .build()
    }

    /** The foreground service's notification while a call rings in front or is already active. */
    fun ongoing(context: Context, info: Info?, ringing: Boolean): Notification {
        ensureChannel(context)
        return brand(NotificationCompat.Builder(context, CHANNEL), context)
            .setContentTitle(info?.name ?: "Call")
            .setContentText(if (ringing) "Ringing" else "Call in progress")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(activityIntent(context, ACTION_OPEN))
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    fun forService(context: Context, info: Info?, ringing: Boolean, headsUp: Boolean): Notification =
        if (ringing && headsUp) incoming(context, info ?: Info("Incoming call", "audio"))
        else ongoing(context, info, ringing)

    /** Older builds posted CallStyle on a second id; drop any leftover. */
    fun cancelIncoming(context: Context) = NotificationManagerCompat.from(context).cancel(INCOMING_ID)
}
