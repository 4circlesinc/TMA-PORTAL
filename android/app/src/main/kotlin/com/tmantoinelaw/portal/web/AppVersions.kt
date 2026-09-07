package com.tmantoinelaw.portal.web

import com.tmantoinelaw.portal.core.network.api.PortalJson
import kotlinx.serialization.Serializable

/**
 * The portal's `/desktop/releases` answer, reduced to whether a newer APK
 * exists. Same feed the Overview download pill and the Mac updater already
 * read; numeric semver so `0.1.1` is newer than `0.1.0` and a leftover
 * suffix (`0.1.1-debug`) does not break the compare.
 */
object AppVersions {
    data class Release(val version: String, val url: String)

    fun parseFeed(body: String): Release? {
        val android = runCatching {
            PortalJson.decodeFromString(ReleasesFeed.serializer(), body).android
        }.getOrNull() ?: return null
        if (!android.available) return null
        val version = android.version.trim()
        val url = android.url.trim()
        if (version.isEmpty() || url.isEmpty()) return null
        return Release(version, url)
    }

    /** True when `remote` should replace `installed`. */
    fun isNewer(remote: String, installed: String): Boolean = compare(remote, installed) > 0

    fun shouldReoffer(declinedVersion: String?, declinedAt: Long, version: String, now: Long, remindAfterMs: Long): Boolean {
        if (declinedVersion.isNullOrEmpty() || declinedVersion != version) return true
        return now - declinedAt >= remindAfterMs
    }

    internal fun compare(a: String, b: String): Int {
        val x = parts(a)
        val y = parts(b)
        val n = maxOf(x.size, y.size)
        for (i in 0 until n) {
            val diff = (x.getOrElse(i) { 0 }) - (y.getOrElse(i) { 0 })
            if (diff != 0) return diff
        }
        return 0
    }

    private fun parts(v: String): List<Int> =
        v.trim().substringBefore('-').substringBefore('+').split('.').map { it.toIntOrNull() ?: 0 }

    @Serializable
    private data class ReleasesFeed(val android: PlatformRelease? = null)

    @Serializable
    private data class PlatformRelease(
        val available: Boolean = false,
        val version: String = "",
        val url: String = "",
    )
}
