package com.tmantoinelaw.portal.core.data.bytes

import android.content.Context
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import com.tmantoinelaw.portal.core.network.session.SessionState
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The document-byte cache (desktop/file-cache.js, prompt §9.5): previews and
 * thumbs a person has viewed are kept on disk, bounded at 512 MB, evicted
 * least-recently-USED. Network first, always: a file's URL does not change
 * when its content does, so the cache answers only when the network could
 * not, and a real answer, a 404 included, stands. Cleared on sign-out and
 * account change.
 */
@Singleton
class ByteCache @Inject constructor(
    @ApplicationContext context: Context,
    private val http: PortalHttp,
    private val session: SessionState,
) {
    private val dir = File(context.cacheDir, "portal-bytes").apply { mkdirs() }
    private val budget = 512L * 1024 * 1024

    sealed interface Answer {
        data class Ok(val file: File, val fromCache: Boolean) : Answer
        data class Refused(val status: Int) : Answer
        data object Unreachable : Answer
    }

    private fun keyFor(url: String): String {
        val account = session.accountId.value ?: 0
        return MessageDigest.getInstance("SHA-256").digest("$account|$url".toByteArray()).joinToString("") { "%02x".format(it) }
    }

    /** A local copy of `url`, fresh when the network answered, cached when it could not. */
    suspend fun fetch(url: String): Answer = withContext(Dispatchers.IO) {
        val target = File(dir, keyFor(url))
        try {
            val absolute = if (url.startsWith("http")) url else http.config.url(url)
            var response = http.raw(Request.Builder().url(absolute).get().build())
            // Media answers with a 302 to a signed R2 URL (Vault.php:371-381); follow that one hop ourselves.
            if (response.code in 301..303 || response.code == 307 || response.code == 308) {
                val location = response.header("Location")
                response.close()
                if (location == null) return@withContext Answer.Refused(response.code)
                response = http.client.newCall(Request.Builder().url(location).get().build()).execute()
            }
            response.use { r ->
                if (!r.isSuccessful) return@withContext Answer.Refused(r.code)
                val tmp = File(dir, target.name + ".part")
                tmp.outputStream().use { out -> r.body.byteStream().copyTo(out) }
                if (!tmp.renameTo(target)) { target.delete(); tmp.renameTo(target) }
            }
            target.setLastModified(System.currentTimeMillis())
            trim()
            Answer.Ok(target, fromCache = false)
        } catch (e: IOException) {
            if (target.exists()) { target.setLastModified(System.currentTimeMillis()); Answer.Ok(target, fromCache = true) } else Answer.Unreachable
        }
    }

    fun cached(url: String): File? = File(dir, keyFor(url)).takeIf { it.exists() }

    private fun trim() {
        val files = dir.listFiles()?.filter { !it.name.endsWith(".part") } ?: return
        var total = files.sumOf { it.length() }
        if (total <= budget) return
        for (f in files.sortedBy { it.lastModified() }) {
            total -= f.length(); f.delete()
            if (total <= budget) break
        }
    }

    fun clear() { dir.listFiles()?.forEach { it.delete() } }
}
