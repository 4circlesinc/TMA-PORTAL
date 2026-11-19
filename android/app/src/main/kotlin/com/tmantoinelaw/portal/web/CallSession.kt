package com.tmantoinelaw.portal.web

import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The call this phone is ringing for or on: the phase the page publishes
 * (`data-tma-call`), or a ring that only the push has heard of so far (the
 * app was closed, so there is no page yet). The full-screen call activity
 * watches this so a hangup on the other end dismisses the slider without
 * waiting for the user.
 */
object CallSession {
    @Volatile var phase: String = ""
        private set
    @Volatile var infoJson: String? = null
        private set

    /** The ring's id and conversation: the push's, or the page's call-info. */
    @Volatile var signalId: String? = null
        private set
    @Volatile var conversationId: String? = null
        private set
    /** The ring push's signed link: Decline without the app (App\Http\Controllers\PushCallController). */
    @Volatile var callUrl: String? = null
    /** Rung from a push, with no page that knows of this call yet. */
    @Volatile var fromPush: Boolean = false
        private set
    /** Answered on this phone: a "stop ringing" push about it is this phone's own answer. */
    @Volatile var answeredHere: Boolean = false

    private val watchers = CopyOnWriteArrayList<(String) -> Unit>()

    fun update(phase: String, infoJson: String?) {
        this.phase = phase
        if (!infoJson.isNullOrBlank()) this.infoJson = infoJson
        if (phase.isEmpty()) {
            this.infoJson = null
            signalId = null
            conversationId = null
            callUrl = null
            fromPush = false
            answeredHere = false
        }
        watchers.forEach { it(phase) }
    }

    /** A ring push (PushService): the phone rings before any page has heard of the call. */
    fun ringFromPush(infoJson: String, signalId: String?, conversationId: String?, callUrl: String?) {
        this.signalId = signalId
        this.conversationId = conversationId
        this.callUrl = callUrl
        fromPush = true
        answeredHere = false
        update("ringing", infoJson)
    }

    /**
     * The page published its phase. Its call-info names the ring, so a push
     * for the same call is recognised as the same call, and the push's
     * decline link kept for it.
     */
    fun fromPage(phase: String, infoJson: String?) {
        val info = runCatching { JSONObject(infoJson ?: "") }.getOrNull()
        val id = info?.optString("signalId")?.ifBlank { null }
        if (id != null && id != signalId) {
            signalId = id
            conversationId = info?.optString("conversationId")?.ifBlank { null }
            callUrl = null
            answeredHere = false
        }
        fromPush = false
        update(phase, infoJson)
    }

    /** `{signalId, conversationId}` for the page's TMAMessagingCalls.*FromHost. */
    fun refJson(): String = JSONObject()
        .put("signalId", signalId ?: "")
        .put("conversationId", conversationId ?: "")
        .toString()

    fun watch(listener: (String) -> Unit) {
        watchers.add(listener)
        if (phase.isNotEmpty()) listener(phase)
    }

    fun unwatch(listener: (String) -> Unit) {
        watchers.remove(listener)
    }
}
