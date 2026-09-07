package com.tmantoinelaw.portal.web

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.tmantoinelaw.portal.BuildConfig
import com.tmantoinelaw.portal.core.network.PortalConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Sideloaded auto-update (desktop/updater.js): poll `/desktop/releases`,
 * download the APK, hand it to the system installer. Play is not involved.
 * Android still asks the person to confirm the install; this only finds,
 * fetches, and opens that prompt.
 */
@Singleton
class AppUpdater @Inject constructor(
    @ApplicationContext private val context: Context,
    client: OkHttpClient,
    private val config: PortalConfig,
) {
    private val feedClient = client
    private val downloadClient = OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES)
        .build()
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val checking = AtomicBoolean(false)

    data class Release(val version: String, val url: String)

    /**
     * Background tick: nothing when already current, recently checked, or
     * "Later" is still holding. Failures stay quiet, the next hour tries again.
     */
    suspend fun findNewer(now: Long = System.currentTimeMillis()): Release? {
        if (!checking.compareAndSet(false, true)) return null
        val last = prefs.getLong(KEY_LAST_CHECK, 0L)
        if (last != 0L && now - last < CHECK_INTERVAL_MS) {
            checking.set(false)
            return null
        }
        return try {
            val release = fetchRelease() ?: return null.also { prefs.edit().putLong(KEY_LAST_CHECK, now).apply() }
            prefs.edit().putLong(KEY_LAST_CHECK, now).apply()
            if (!AppVersions.isNewer(release.version, BuildConfig.VERSION_NAME)) return null
            val declinedVersion = prefs.getString(KEY_DECLINED_VERSION, null)
            val declinedAt = prefs.getLong(KEY_DECLINED_AT, 0L)
            if (!AppVersions.shouldReoffer(declinedVersion, declinedAt, release.version, now, REMIND_AFTER_MS)) return null
            Release(release.version, release.url)
        } catch (_: Exception) {
            null
        } finally {
            checking.set(false)
        }
    }

    fun defer(version: String, now: Long = System.currentTimeMillis()) {
        prefs.edit().putString(KEY_DECLINED_VERSION, version).putLong(KEY_DECLINED_AT, now).apply()
    }

    suspend fun ensureApk(release: Release): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val dest = File(dir, "TMA-Portal-${release.version}.apk")
        if (dest.exists() && dest.length() > 0L) return@withContext dest
        dir.listFiles()?.forEach { if (it != dest) it.delete() }
        val tmp = File(dir, dest.name + ".part")
        val request = Request.Builder().url(release.url).header("Accept", "*/*").build()
        downloadClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("The update could not be downloaded (${response.code}).")
            val body = response.body
            tmp.outputStream().use { out -> body.byteStream().copyTo(out) }
        }
        if (!tmp.renameTo(dest)) {
            dest.delete()
            tmp.copyTo(dest, overwrite = true)
            tmp.delete()
        }
        dest
    }

    fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()

    fun installPermissionIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun installIntent(apk: File): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", apk)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    private suspend fun fetchRelease(): AppVersions.Release? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(config.url("/desktop/releases"))
            .header("Cache-Control", "no-cache")
            .build()
        feedClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@use null
            AppVersions.parseFeed(response.body.string())
        }
    }

    companion object {
        private const val PREFS = "updates"
        private const val KEY_LAST_CHECK = "last_check"
        private const val KEY_DECLINED_VERSION = "declined_version"
        private const val KEY_DECLINED_AT = "declined_at"
        const val CHECK_INTERVAL_MS = 60L * 60L * 1000L
        const val REMIND_AFTER_MS = 3L * 60L * 60L * 1000L
    }
}
