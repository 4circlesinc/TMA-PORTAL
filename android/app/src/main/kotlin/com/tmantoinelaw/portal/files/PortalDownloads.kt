package com.tmantoinelaw.portal.files

import android.app.DownloadManager
import android.content.Context
import android.os.Environment
import androidx.core.net.toUri
import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.network.cookies.PersistentCookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import javax.inject.Inject
import javax.inject.Singleton

/** Downloads go through the system manager, carrying the session cookie the portal needs (prompt §11.6). */
@Singleton
class PortalDownloads @Inject constructor(private val jar: PersistentCookieJar, private val config: PortalConfig) {
    fun enqueue(context: Context, url: String, name: String) {
        val absolute = if (url.startsWith("http")) url else config.url(url)
        val request = DownloadManager.Request(absolute.toUri())
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            .addRequestHeader("Cookie", jar.cookieHeader(absolute.toHttpUrl()))
            .addRequestHeader("User-Agent", config.userAgent)
        context.getSystemService(DownloadManager::class.java).enqueue(request)
    }
}
