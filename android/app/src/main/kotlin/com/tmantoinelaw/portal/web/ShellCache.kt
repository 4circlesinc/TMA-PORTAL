package com.tmantoinelaw.portal.web

import android.webkit.CookieManager
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException

/**
 * desktop/shell-cache.js: the last shell the server served, kept so the app
 * boots from it when the network cannot answer. A shell is any navigation
 * whose first 4 KB carry the `tma-shell:` marker; it is remembered per deploy
 * build (`GET /desktop/build`) with the first path segments it was seen for,
 * and served only while a session cookie exists. Sign-in and share pages are
 * never shells.
 */
class ShellCache(dir: File, private val origin: String, private val client: OkHttpClient, private val userAgent: String) {
    private val root = File(dir, "shell-cache").apply { mkdirs() }
    private val html = File(root, "shell.html")
    private val metaFile = File(root, "meta.json")
    @Volatile var remoteBuild: String? = null
    @Volatile var servingFromCache = false
        private set

    private data class Meta(val build: String?, val segments: MutableSet<String>)

    private fun readMeta(): Meta? = runCatching {
        val o = JSONObject(metaFile.readText())
        val segs = o.optJSONArray("segments") ?: return null
        Meta(o.optString("build").takeIf { it.isNotBlank() }, (0 until segs.length()).map { segs.getString(it) }.toMutableSet())
    }.getOrNull()

    fun invalidate() { html.delete(); metaFile.delete() }

    private fun firstSegment(path: String): String = Regex("^/([^/]+)").find(path)?.groupValues?.get(1) ?: ""

    fun hasSessionCookie(): Boolean {
        val header = CookieManager.getInstance().getCookie(origin) ?: return false
        return header.split(";").map { it.trim().substringBefore("=") }.any { it.contains("session") || it.startsWith("remember") }
    }

    /** The kept shell for a navigation, or null when the rules say the network must answer (maybeServe). */
    fun maybeServe(path: String, offline: Boolean): String? {
        val meta = readMeta() ?: return null
        val segment = firstSegment(path)
        if (path != "/" && segment !in meta.segments) {
            if (!offline || segment in NEVER_SHELL) return null
        }
        val remote = remoteBuild
        if (remote != null && meta.build != null && meta.build != remote) { invalidate(); return null }
        if (!hasSessionCookie()) return null
        val text = runCatching { html.readText() }.getOrNull() ?: return null
        servingFromCache = true
        return text
    }

    /** After the network served a page: fetch the same shell ourselves and keep it (captureIfShell). Off the main thread. */
    fun capture(path: String) {
        val build = remoteBuild ?: refreshBuild() ?: return
        if (firstSegment(path) in NEVER_SHELL) return
        val cookies = CookieManager.getInstance().getCookie(origin) ?: return
        val request = Request.Builder().url(origin + path).get()
            .header("Accept", "text/html").header("Cookie", cookies).header("User-Agent", userAgent).build()
        val body = try {
            client.newCall(request).execute().use { r -> if (!r.isSuccessful || !(r.header("Content-Type") ?: "").contains("text/html")) return; r.body.string() }
        } catch (e: IOException) { return }
        if (!body.take(SNIFF_CHARS).contains(MARKER)) return
        val meta = readMeta() ?: Meta(null, mutableSetOf())
        val segment = firstSegment(path)
        val segments = if (meta.build == build) meta.segments else mutableSetOf()
        if (segment.isNotBlank()) segments += segment
        servingFromCache = false
        html.writeText(body)
        metaFile.writeText(JSONObject().put("build", build).put("segments", JSONArray(segments.toList())).toString())
    }

    /** `GET /desktop/build` → the deploy's hash; a change invalidates the kept shell. */
    fun refreshBuild(): String? = try {
        client.newCall(Request.Builder().url("$origin/desktop/build").header("Accept", "application/json").header("User-Agent", userAgent).build()).execute().use { r ->
            if (!r.isSuccessful) null else {
                val text = r.body.string().trim()
                val build = runCatching { JSONObject(text).optString("build").takeIf { it.isNotBlank() } }.getOrNull() ?: text.trim('"').takeIf { it.isNotBlank() && it.length < 128 }
                build?.also { remoteBuild = it }
            }
        }
    } catch (e: IOException) { null }

    companion object {
        const val MARKER = "tma-shell:"
        private const val SNIFF_CHARS = 4096
        val NEVER_SHELL = setOf("auth", "r", "invite", "s", "sign-in", "sign-up", "design", "up")
    }
}
