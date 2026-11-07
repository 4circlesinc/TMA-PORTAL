package com.tmantoinelaw.portal.web

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * The inline Reply on a message or email notification (MessageNotifications):
 * posted to the push's signed reply link with this phone's push token
 * (App\Http\Controllers\PushReplyController), which sends it the same way the
 * portal's page would. Sent, the conversation's notification goes (replying
 * is reading it); not sent, a notification says so and opens the
 * conversation, so a reply is never lost quietly.
 */
class ReplyReceiver : BroadcastReceiver() {
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != MessageNotifications.ACTION_REPLY) return
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(MessageNotifications.KEY_TEXT)?.toString()?.trim().orEmpty()
        val msg = runCatching { JSONObject(intent.getStringExtra(MessageNotifications.EXTRA_MSG) ?: "") }.getOrNull() ?: return
        val url = msg.optString("reply")
        if (text.isEmpty() || url.isBlank()) return

        val app = context.applicationContext
        val pending = goAsync()
        thread(name = "tma-reply") {
            val sent = runCatching {
                val token = Tasks.await(FirebaseMessaging.getInstance().token, 10, TimeUnit.SECONDS)
                val body = JSONObject().put("body", text).put("device", token).put("nonce", UUID.randomUUID().toString()).toString()
                val request = Request.Builder().url(url)
                    .post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .header("Accept", "application/json")
                    .build()
                client.newCall(request).execute().use { it.isSuccessful }
            }.getOrDefault(false)

            val id = MessageNotifications.idFor(msg)
            if (sent) {
                NotificationManagerCompat.from(app).cancel(id)
            } else {
                WebNotifications.show(app, JSONObject()
                    .put("id", id)
                    .put("title", "Reply not sent")
                    .put("body", "Your reply to ${msg.optString("group").ifBlank { msg.optString("name") }} didn't send. Tap to open the conversation.")
                    .put("url", msg.optString("url")))
            }
            pending.finish()
        }
    }
}
