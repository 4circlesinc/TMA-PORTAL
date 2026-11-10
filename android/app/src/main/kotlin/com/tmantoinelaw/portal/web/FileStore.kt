package com.tmantoinelaw.portal.web

import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException

/**
 * Documents kept on the phone for offline: desktop/file-cache.js, for Android.
 *
 * Every load in the WebView can be answered here (shouldInterceptRequest), so
 * this works the way the desktop app does and the page needs no part in it:
 * a document's preview or thumbnail, or a profile photo, is fetched by the
 * app itself with the page's sign-in, kept whole, and handed to the page;
 * with no connection the kept copy is the answer. The page's offline download
 * (public/js/offline-download.js) fills it by simply reading the newest
 * documents.
 *
 * Network first, always: a document's address does not change when a new
 * version is uploaded, so the kept copy is only for when nothing answers.
 * In the app's private files (not the cache folder Android empties on its
 * own), within a budget (2.5 GB, the firm's figure), least recently used out
 * first, and wiped when somebody signs out or in.
 */
class FileStore(
    dir: File,
    private val origin: String,
    private val client: OkHttpClient,
    private val userAgent: String,
) {
    companion object {
        const val BUDGET: Long = 2_684_354_560L
        const val FILE_LIMIT: Long = 100L * 1024 * 1024
        private val KEEPS = Regex("^/(portal/files/files/[a-f0-9-]{36}/(preview|thumb)|media/avatars/[a-f0-9-]{36}\\.jpg)$")

        fun keeps(path: String): Boolean = KEEPS.matches(path)
    }

    private data class Entry(val file: String, val size: Long, var lastUsed: Long, val type: String)

    private val root = File(dir, "file-store")
    private val indexFile = File(root, "index.json")
    private val index = mutableMapOf<String, Entry>()

    init {
        root.mkdirs()
        load()
    }

    /**
     * The answer for one of the WebView's loads, or null to let it load as
     * usual (anything that is not a kept kind of file; a ranged read online).
     */
    fun intercept(request: WebResourceRequest, online: Boolean): WebResourceResponse? {
        if (request.method != "GET") return null
        val url = request.url
        if (!url.toString().startsWith(origin)) return null
        val path = url.path ?: return null
        if (!keeps(path)) return null
        val ranged = request.requestHeaders.keys.any { it.equals("Range", ignoreCase = true) }

        if (!online) return serve(path)
        // A video seeking, or pdf.js reading one page: the WebView's own.
        if (ranged) return null

        val cookie = CookieManager.getInstance().getCookie(url.toString()) ?: ""
        val call = Request.Builder()
            .url(url.toString())
            .header("Cookie", cookie)
            .header("User-Agent", userAgent)
            .header("Accept", request.requestHeaders["Accept"] ?: "*/*")
            .build()
        return try {
            client.newCall(call).execute().use { response ->
                val type = response.header("Content-Type") ?: "application/octet-stream"
                val length = response.body?.contentLength() ?: -1L
                when {
                    response.code == 200 && length <= FILE_LIMIT -> {
                        val bytes = response.body?.bytes() ?: ByteArray(0)
                        if (bytes.size.toLong() <= FILE_LIMIT) store(path, bytes, type)
                        respond(200, type, bytes)
                    }
                    // Too large to keep: the WebView loads it itself.
                    response.code == 200 -> null
                    else -> respond(response.code, type, response.body?.bytes() ?: ByteArray(0))
                }
            }
        } catch (e: IOException) {
            // Nothing answered: the kept copy, if there is one.
            serve(path)
        }
    }

    private fun respond(code: Int, type: String, bytes: ByteArray): WebResourceResponse {
        val mime = type.substringBefore(';').trim().ifEmpty { "application/octet-stream" }
        val reason = if (code == 200) "OK" else "Status $code"
        return WebResourceResponse(mime, null, code, reason, mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(bytes))
    }

    @Synchronized
    private fun serve(path: String): WebResourceResponse? {
        val entry = index[path] ?: return null
        val file = File(root, entry.file)
        if (!file.exists()) {
            index.remove(path)
            return null
        }
        entry.lastUsed = System.currentTimeMillis()
        save()
        return respond(200, entry.type, file.readBytes())
    }

    @Synchronized
    private fun store(path: String, bytes: ByteArray, type: String) {
        if (bytes.size.toLong() > BUDGET) return
        val name = path.map { if (it.isLetterOrDigit()) it else '_' }.joinToString("").takeLast(180)
        val target = File(root, name)
        try {
            val temp = File(root, "$name.part")
            temp.writeBytes(bytes)
            target.delete()
            if (!temp.renameTo(target)) {
                temp.delete()
                return
            }
        } catch (e: IOException) {
            return
        }
        index[path] = Entry(name, bytes.size.toLong(), System.currentTimeMillis(), type)
        var total = index.values.sumOf { it.size }
        if (total > BUDGET) {
            for ((key, entry) in index.entries.sortedBy { it.value.lastUsed }.map { it.key to it.value }) {
                if (total <= BUDGET) break
                File(root, entry.file).delete()
                index.remove(key)
                total -= entry.size
            }
        }
        save()
    }

    /** Somebody signed out, or another account signed in. */
    @Synchronized
    fun clear() {
        index.clear()
        root.deleteRecursively()
        root.mkdirs()
    }

    private fun load() {
        try {
            if (!indexFile.exists()) return
            val json = JSONObject(indexFile.readText())
            for (key in json.keys()) {
                val e = json.getJSONObject(key)
                index[key] = Entry(e.getString("file"), e.getLong("size"), e.getLong("lastUsed"), e.optString("type", "application/octet-stream"))
            }
        } catch (e: Exception) {
            index.clear()
        }
    }

    private fun save() {
        try {
            val json = JSONObject()
            for ((key, entry) in index) {
                json.put(key, JSONObject()
                    .put("file", entry.file)
                    .put("size", entry.size)
                    .put("lastUsed", entry.lastUsed)
                    .put("type", entry.type))
            }
            val temp = File(root, "index.json.part")
            temp.writeText(json.toString())
            indexFile.delete()
            temp.renameTo(indexFile)
        } catch (e: IOException) {
            // A lost index costs a download, never the page.
        }
    }
}
