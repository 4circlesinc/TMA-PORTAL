package com.tmantoinelaw.portal.web

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import com.tmantoinelaw.portal.MainActivity
import com.tmantoinelaw.portal.core.ui.R
import org.json.JSONObject

/**
 * The desktop's incoming-call panel (desktop/call-window.js): the caller's
 * name with Accept and Decline, raised only when the app is not in front.
 * Accept and Decline land on the page's own `TMAMessagingCalls.accept()` /
 * `.decline()`, the same code paths as the in-page buttons. The page rings
 * with its own ringtone, so the notification itself is silent.
 */
object CallNotifications {
    const val CHANNEL = "calls"
    const val INCOMING_ID = 7001
    const val ONGOING_ID = 7002
    const val ACTION_ANSWER = "tma.call.answer"
    const val ACTION_DECLINE = "tma.call.decline"
    const val ACTION_OPEN = "tma.call.open"

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

    fun showIncoming(context: Context, info: Info) {
        ensureChannel(context)
        val person = Person.Builder().setName(info.name).setImportant(true).build()
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_phone_call)
            .setContentTitle(info.name)
            .setContentText(if (info.media == "video") "Incoming video call" else "Incoming call")
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, activityIntent(context, ACTION_DECLINE), activityIntent(context, ACTION_ANSWER)).setIsVideo(info.media == "video"))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setFullScreenIntent(activityIntent(context, ACTION_OPEN), true)
            .setOngoing(true)
            .setSilent(true)
            .setAutoCancel(false)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(INCOMING_ID, n) }
    }

    /** The foreground service's notification while a call rings or runs. */
    fun ongoing(context: Context, info: Info?, ringing: Boolean): android.app.Notification {
        ensureChannel(context)
        return NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_phone_call)
            .setContentTitle(info?.name ?: "Call")
            .setContentText(if (ringing) "Ringing" else "Call in progress")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(activityIntent(context, ACTION_OPEN))
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    fun cancelIncoming(context: Context) = NotificationManagerCompat.from(context).cancel(INCOMING_ID)
}
