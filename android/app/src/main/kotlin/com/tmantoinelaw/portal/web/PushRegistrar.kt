package com.tmantoinelaw.portal.web

import android.content.Context
import android.os.Build
import android.webkit.CookieManager
import android.webkit.WebSettings
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * `POST /me/devices` with the page's own session (CookieManager), after a
 * portal page has loaded with a session cookie and on token rotation.
 * Remembered per token + session so the post happens once per sign-in.
 */
object PushRegistrar {
    private val io = Executors.newSingleThreadExecutor()
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    private const val PREFS = "push"
    @Volatile private var inFlight: String? = null

    fun ensure(context: Context, origin: String, versionName: String) {
        if (FirebaseApp.getApps(context).isEmpty()) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> register(context, origin, versionName, token) }
    }

    fun register(context: Context, origin: String, versionName: String, token: String) {
        val cookies = CookieManager.getInstance().getCookie(origin) ?: return
        val names = cookies.split(";").map { it.trim().substringBefore("=") }
        val session = names.firstOrNull { it.contains("session") } ?: return
        val sessionValue = cookies.split(";").map { it.trim() }.firstOrNull { it.startsWith("$session=") } ?: return
        val stamp = sha(token + "|" + sessionValue)
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString("registered", null) == stamp || inFlight == stamp) return
        inFlight = stamp
        val xsrf = cookies.split(";").map { it.trim() }.firstOrNull { it.startsWith("XSRF-TOKEN=") }?.substringAfter("=")?.let { URLDecoder.decode(it, "UTF-8") }
        val body = JSONObject().put("platform", "android").put("token", token).put("appVersion", versionName)
            .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}".trim()).toString()
        // The page's own user agent: the session is the WebView's, and a session guard may compare it.
        val userAgent = WebSettings.getDefaultUserAgent(context.applicationContext) + " TMAPortal/$versionName"
        io.execute {
            val request = Request.Builder().url("$origin/me/devices").post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
                .header("Accept", "application/json").header("X-Requested-With", "XMLHttpRequest").header("Cookie", cookies).header("User-Agent", userAgent)
                .apply { xsrf?.let { header("X-XSRF-TOKEN", it) } }.build()
            runCatching { client.newCall(request).execute().use { if (it.isSuccessful) prefs.edit().putString("registered", stamp).apply() } }
            if (inFlight == stamp) inFlight = null
        }
    }

    private fun sha(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
