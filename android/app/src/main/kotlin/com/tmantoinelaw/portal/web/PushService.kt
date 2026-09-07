package com.tmantoinelaw.portal.web

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.tmantoinelaw.portal.BuildConfig
import org.json.JSONObject

/**
 * FCM data messages (app/Support/Notifications/Push.php): `notification`
 * carries the presenter's record, `call` the call.signal payload. In front,
 * the page already heard the socket and shows its own UI; otherwise the same
 * shade entries the page would have raised.
 */
class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PushRegistrar.register(this, BuildConfig.PORTAL_ORIGIN.trimEnd('/'), BuildConfig.VERSION_NAME, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (AppForeground.resumed) return
        val data = message.data
        when (data["kind"]) {
            "notification" -> {
                val record = runCatching { JSONObject(data["notification"] ?: "") }.getOrNull() ?: return
                val id = record.optString("id").hashCode().let { if (it == 0) 1 else Math.abs(it) }
                WebNotifications.show(this, JSONObject()
                    .put("id", id)
                    .put("title", record.optString("title"))
                    .put("body", record.optString("message"))
                    .put("tag", record.optString("module"))
                    .put("url", record.optString("actionUrl")))
            }
            "call" -> {
                val signal = runCatching { JSONObject(data["signal"] ?: "") }.getOrNull() ?: return
                if (signal.optString("type") != "ring") return
                val payload = signal.optJSONObject("payload")
                val info = JSONObject().put("name", payload?.optString("fromName")?.ifBlank { null } ?: "Unknown caller").put("media", payload?.optString("media")?.ifBlank { null } ?: "audio")
                CallNotifications.showIncoming(this, CallNotifications.Info.parse(info.toString()))
                CallService.start(this, info.toString(), ringing = true)
            }
        }
    }
}
