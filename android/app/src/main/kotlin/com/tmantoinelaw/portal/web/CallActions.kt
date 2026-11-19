package com.tmantoinelaw.portal.web

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Decline from the phone's own call screen without opening the app, the way
 * a phone call is declined: the ring push's signed link
 * (App\Http\Controllers\PushCallController) with this phone's push token.
 * The server sends the same `reject` the page would, so the caller stops
 * ringing and the call history reads the same.
 */
object CallActions {
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()

    /**
     * Stops the ring here and declines through the link. False when there is
     * no link (the ring came from the page alone): only the page can decline
     * it then, so the caller opens it with ACTION_DECLINE.
     */
    fun declineNatively(context: Context, done: () -> Unit = {}): Boolean {
        val url = CallSession.callUrl ?: return false
        val app = context.applicationContext
        CallSession.update("", null)
        CallService.stop(app)
        thread(name = "tma-call-decline") {
            runCatching {
                val token = Tasks.await(FirebaseMessaging.getInstance().token, 10, TimeUnit.SECONDS)
                val body = JSONObject().put("device", token).put("action", "decline").toString()
                val request = Request.Builder().url(url)
                    .post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .header("Accept", "application/json")
                    .build()
                client.newCall(request).execute().close()
            }
            done()
        }
        return true
    }
}

/** The incoming-call notification's Decline, when the ring carried its link. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != CallNotifications.ACTION_DECLINE) return
        val pending = goAsync()
        if (!CallActions.declineNatively(context) { pending.finish() }) {
            // The link went with the call (it ended a moment ago): nothing left to decline.
            CallSession.update("", null)
            CallService.stop(context.applicationContext)
            pending.finish()
        }
    }
}
