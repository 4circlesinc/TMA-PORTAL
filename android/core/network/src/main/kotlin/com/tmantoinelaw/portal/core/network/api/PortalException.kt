package com.tmantoinelaw.portal.core.network.api

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Response
import java.io.IOException

/**
 * A non-2xx answer, decoded the way the web helpers decode it: `message`,
 * field `errors` on 422, `code` on the MFA wall, `redirect`, `reconnect` on a
 * dead mailbox grant, and `Location` on a 302 (a wall with no JSON branch).
 */
class PortalException(
    val status: Int,
    override val message: String,
    val code: String? = null,
    val errors: Map<String, List<String>> = emptyMap(),
    val redirect: String? = null,
    val reconnect: Boolean = false,
    val conflict: JsonObject? = null,
) : IOException(message) {

    val isUnauthorized get() = status == 401 || status == 419
    val isWall get() = status == 302 && redirect != null

    /** The first field message, else the general one: what a form shows. */
    fun firstError(): String = errors.values.firstOrNull()?.firstOrNull() ?: message

    companion object {
        fun from(response: Response): PortalException {
            val status = response.code
            val location = response.header("Location")
            val body = runCatching { response.body.string() }.getOrNull().orEmpty()
            val json = runCatching { PortalJson.parseToJsonElement(body).jsonObject }.getOrNull()
            val message = json?.get("message")?.jsonPrimitive?.content
                ?: when (status) {
                    302 -> "Finish this step in your browser."
                    401 -> "Unauthenticated."
                    419 -> "CSRF token mismatch."
                    403 -> "You do not have access to this."
                    404 -> "Not found."
                    429 -> "Too many attempts. Try again in a moment."
                    in 500..599 -> "The portal could not answer."
                    else -> "Request failed ($status)."
                }
            val errors = json?.get("errors")?.let { el ->
                runCatching {
                    el.jsonObject.mapValues { (_, v) -> v.jsonArray.map { it.jsonPrimitive.content } }
                }.getOrNull()
            } ?: emptyMap()
            return PortalException(
                status = status,
                message = message,
                code = json?.get("code")?.jsonPrimitive?.content,
                errors = errors,
                redirect = json?.get("redirect")?.jsonPrimitive?.content ?: location,
                reconnect = json?.get("reconnect")?.jsonPrimitive?.content == "true",
                conflict = json?.takeIf { it["conflict"]?.jsonPrimitive?.content == "true" || it.containsKey("duplicate") },
            )
        }
    }
}
