package com.tmantoinelaw.portal.web

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat
import com.tmantoinelaw.portal.MainActivity
import com.tmantoinelaw.portal.core.ui.R
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * A message, a group message, a CIP file thread or an email, shown the way a
 * messaging app shows one: the push's "msg" (App\Support\Notifications\
 * MessagePush) as a conversation notification.
 *
 *   direct message   the sender's photo, their name, the message
 *   group message    the group's name over "who: message", the group's photo
 *   email            the subject over "sender: start of the email"
 *   activity         what happened over "who: its line", the person's photo
 *                    (a file's status, a comment); no Reply, nothing to answer
 *
 * A tap opens the conversation (a CIP thread's group chat, the email); the
 * inline Reply posts to the push's signed reply link with this phone's push
 * token (ReplyReceiver), so signing out of the phone ends it. Called on FCM's
 * worker thread, so the photos are fetched here, briefly, or left out.
 */
object MessageNotifications {
    const val ACTION_REPLY = "tma.notification.reply"
    const val KEY_TEXT = "tma.reply.text"
    const val EXTRA_MSG = "tma.reply.msg"
    private val BRAND = Color.parseColor("#136DA0")
    private val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).build()

    /** One notification per conversation: a new message replaces the last. */
    fun idFor(msg: JSONObject): Int = msg.optString("conversation").hashCode().let { if (it == 0) 1 else it and 0x7fffffff }

    fun show(context: Context, msg: JSONObject) {
        WebNotifications.ensureChannel(context)
        val id = idFor(msg)
        val title = msg.optString("title").ifBlank { msg.optString("name").ifBlank { "TM ANTOINE Portal" } }
        val subtitle = msg.optString("subtitle").ifBlank { null }
        val body = msg.optString("body").ifBlank { subtitle ?: "" }
        val url = msg.optString("url")
        val photo = download(msg.optString("photo"))
        val groupPhoto = download(msg.optString("groupPhoto"))

        val sender = Person.Builder()
            .setName(title)
            .setKey(msg.optString("sender").ifBlank { title })
            .apply { photo?.let { setIcon(IconCompat.createWithBitmap(it)) } }
            .build()
        val me = Person.Builder().setName("You").build()
        val style = NotificationCompat.MessagingStyle(me)
            .setConversationTitle(subtitle)
            .setGroupConversation(subtitle != null)
            .addMessage(body, System.currentTimeMillis(), sender)

        val tap = Intent(context, MainActivity::class.java).apply {
            action = "tma.notification.$id"
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(WebNotifications.EXTRA_ID, id)
            putExtra(WebNotifications.EXTRA_URL, url)
        }
        val open = PendingIntent.getActivity(context, id, tap, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val builder = NotificationCompat.Builder(context, "portal")
            .setSmallIcon(R.drawable.ic_stat_tma)
            .setColor(BRAND)
            .setStyle(style)
            .setContentTitle(subtitle ?: title)
            .setContentText(if (subtitle != null) "$title: $body" else body)
            .setCategory(if (msg.optString("kind") == "activity") NotificationCompat.CATEGORY_STATUS else NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(open)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOnlyAlertOnce(false)
        (groupPhoto ?: photo)?.let { builder.setLargeIcon(it) }

        msg.optString("reply").takeIf { it.startsWith("https://") || it.startsWith("http://") }?.let {
            val input = RemoteInput.Builder(KEY_TEXT).setLabel(if (msg.optString("kind") == "email") "Reply to email" else "Reply").build()
            val send = Intent(context, ReplyReceiver::class.java).apply {
                action = ACTION_REPLY
                putExtra(EXTRA_MSG, msg.toString())
            }
            // Mutable: the system writes the typed text into it.
            val pending = PendingIntent.getBroadcast(context, id, send, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            builder.addAction(
                NotificationCompat.Action.Builder(IconCompat.createWithResource(context, R.drawable.ic_stat_tma), "Reply", pending)
                    .addRemoteInput(input)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                    .setShowsUserInterface(false)
                    .build()
            )
        }

        runCatching { NotificationManagerCompat.from(context).notify(id, builder.build()) }
    }

    /** A photo for the notification, small, or null for none. */
    private fun download(url: String): Bitmap? {
        if (!(url.startsWith("https://") || url.startsWith("http://"))) return null
        return runCatching {
            client.newCall(Request.Builder().url(url).header("Accept", "image/*").build()).execute().use { response ->
                if (!response.isSuccessful) return null
                val bytes = response.body.bytes()
                if (bytes.isEmpty() || bytes.size > 5_000_000) return null
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
                val side = 256
                if (bitmap.width <= side && bitmap.height <= side) bitmap
                else Bitmap.createScaledBitmap(bitmap, side, (bitmap.height * side / bitmap.width.coerceAtLeast(1)).coerceAtLeast(1), true)
            }
        }.getOrNull()
    }
}
