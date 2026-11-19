package com.tmantoinelaw.portal.web

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.tmantoinelaw.portal.BuildConfig
import org.json.JSONObject

/**
 * FCM data messages (app/Support/Notifications/Push.php): `notification`
 * carries the presenter's record, `call` the call.signal payload. In front,
 * the page already heard the socket and shows its own UI; otherwise FCM is
 * the shade (notify-store.js does not also banner on Android). A ringing
 * call starts the foreground service, whose notification *is* the incoming
 * CallStyle — not a second tile beside it — and rings the phone. `call-end`
 * stops it the moment the call stops ringing (Push::callEnded).
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
                // A message, group message, CIP file thread or email: a
                // conversation notification with the photo and a Reply. An
                // activity (a status change, a comment) gets the person's
                // photo the same way, without the Reply.
                val msg = runCatching { JSONObject(data["msg"] ?: "") }.getOrNull()
                if (msg != null && msg.optString("conversation").isNotBlank()) {
                    MessageNotifications.show(this, msg)
                    return
                }
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
                val signalId = signal.optString("signalId").ifBlank { null }
                // The page in the background already rang this one: keep it, with the push's decline link.
                if (signalId != null && signalId == CallSession.signalId && CallSession.phase.isNotEmpty()) {
                    CallSession.callUrl = data["callUrl"] ?: CallSession.callUrl
                    return
                }
                // Already on a call: a second ring does not take the screen from it.
                if (CallSession.phase == "active") return
                val payload = signal.optJSONObject("payload")
                val info = JSONObject()
                    .put("name", payload?.optString("fromName")?.ifBlank { null } ?: "Unknown caller")
                    .put("media", payload?.optString("media")?.ifBlank { null } ?: "audio")
                    .put("signalId", signalId ?: "")
                    .put("conversationId", signal.optString("conversationId"))
                CallSession.ringFromPush(info.toString(), signalId, signal.optString("conversationId").ifBlank { null }, data["callUrl"])
                CallService.start(this, info.toString(), ringing = true)
            }
            // The call stopped ringing: answered elsewhere, declined, or the
            // caller gave up. This phone stops too, unless it is the one
            // that answered.
            "call-end" -> {
                if (CallSession.phase != "ringing" || CallSession.answeredHere) return
                val signalId = data["signalId"]
                if (!signalId.isNullOrBlank() && CallSession.signalId != null && CallSession.signalId != signalId) return
                CallSession.update("", null)
                CallService.stop(this)
            }
        }
    }
}
