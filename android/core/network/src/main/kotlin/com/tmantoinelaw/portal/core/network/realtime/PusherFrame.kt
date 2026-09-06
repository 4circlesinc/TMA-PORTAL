package com.tmantoinelaw.portal.core.network.realtime

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * One Pusher-protocol (v7) frame as Reverb sends it. `data` arrives as a JSON
 * **string** on every frame (public/js/messaging-realtime.js:326-334), so it is
 * parsed twice; `channel` is absent on connection-level frames.
 */
data class PusherFrame(val event: String, val channel: String?, val data: JsonElement) {
    val dataObject: JsonObject? get() = data as? JsonObject

    fun string(key: String): String? = dataObject?.get(key)?.let { (it as? JsonPrimitive)?.content }

    companion object {
        private val json = Json { ignoreUnknownKeys = true; isLenient = true }

        fun parse(text: String): PusherFrame? = runCatching {
            val root = json.parseToJsonElement(text).jsonObject
            val event = root["event"]?.jsonPrimitive?.content ?: return null
            val channel = root["channel"]?.let { (it as? JsonPrimitive)?.content }
            val raw = root["data"]
            val data: JsonElement = when (raw) {
                null, JsonNull -> JsonObject(emptyMap())
                is JsonPrimitive -> if (raw.isString) runCatching { json.parseToJsonElement(raw.content) }.getOrDefault(raw) else raw
                else -> raw
            }
            PusherFrame(event, channel, data)
        }.getOrNull()

        fun pong(): String = """{"event":"pusher:pong","data":{}}"""

        fun subscribe(channel: String, auth: String?, channelData: String?): String = buildJsonObject {
            put("event", "pusher:subscribe")
            put("data", buildJsonObject {
                put("channel", channel)
                if (auth != null) put("auth", auth)
                if (channelData != null) put("channel_data", channelData)
            })
        }.toString()

        fun unsubscribe(channel: String): String = buildJsonObject {
            put("event", "pusher:unsubscribe")
            put("data", buildJsonObject { put("channel", channel) })
        }.toString()
    }
}
