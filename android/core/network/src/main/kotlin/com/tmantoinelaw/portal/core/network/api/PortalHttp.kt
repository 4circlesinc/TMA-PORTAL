package com.tmantoinelaw.portal.core.network.api

import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.network.session.SessionState
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * The one HTTP door. Redirects are never followed automatically: a 302 from the
 * portal is a wall (sign-in, pending approval, onboarding) that the app must
 * hand to a Custom Tab, never a page to load.
 */
class PortalHttp(
    val client: OkHttpClient,
    val config: PortalConfig,
    private val session: SessionState,
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun <T> get(path: String, serializer: KSerializer<T>): T =
        decode(execute(request(path).get().build()), serializer)

    suspend fun getJson(path: String): JsonElement = get(path, JsonElement.serializer())

    suspend fun <T> post(path: String, body: JsonElement?, serializer: KSerializer<T>): T =
        decode(execute(request(path).post(body.toBody()).build()), serializer)

    suspend fun <T> put(path: String, body: JsonElement?, serializer: KSerializer<T>): T =
        decode(execute(request(path).put(body.toBody()).build()), serializer)

    suspend fun <T> patch(path: String, body: JsonElement?, serializer: KSerializer<T>): T =
        decode(execute(request(path).patch(body.toBody()).build()), serializer)

    suspend fun <T> delete(path: String, body: JsonElement?, serializer: KSerializer<T>): T =
        decode(execute(request(path).delete(body?.toBody()).build()), serializer)

    /** A raw call for the few places that read status and headers themselves (the sign-in claim, downloads). */
    suspend fun raw(request: Request): Response = client.newCall(request).await().also { session.reachable.value = true }

    /** A portal path, or an absolute URL (a queued write stores the URL it was going to). */
    fun request(path: String): Request.Builder = Request.Builder().url(if (path.startsWith("http")) path else config.url(path))

    private fun JsonElement?.toBody(): RequestBody = (this?.toString() ?: "{}").toRequestBody(jsonType)

    private suspend fun execute(request: Request): Response {
        val response = try {
            client.newCall(request).await()
        } catch (e: IOException) {
            session.reachable.value = false
            throw e
        }
        session.reachable.value = true
        if (!response.isSuccessful) {
            val error = PortalException.from(response)
            response.close()
            throw error
        }
        return response
    }

    private fun <T> decode(response: Response, serializer: KSerializer<T>): T = response.use {
        val text = it.body.string()
        if (text.isBlank()) throw PortalException(it.code, "Empty answer.")
        PortalJson.decodeFromString(serializer, text)
    }
}

suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }
        override fun onResponse(call: Call, response: Response) {
            cont.resume(response)
        }
    })
    cont.invokeOnCancellation { runCatching { cancel() } }
}
