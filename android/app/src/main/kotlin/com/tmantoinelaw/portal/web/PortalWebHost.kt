package com.tmantoinelaw.portal.web

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.concurrent.Executors

/**
 * The Android twin of desktop/main.js: one WebView over the portal origin,
 * the preload bridge, the navigation rules, the loading layer, the kept
 * shell for an offline boot, downloads, uploads, media permissions.
 *
 * The page is the portal's own front end, byte for byte what the browser
 * gets. Nothing here draws UI; it only adds what a browser tab cannot do.
 */
class PortalWebHost(
    context: Context,
    private val origin: String,
    private val versionName: String,
    private val client: OkHttpClient,
    private val listener: Listener,
) {
    interface Listener {
        fun onSignInProvider(provider: String)
        fun onOpenOutside(url: String)
        fun onBadge(count: Int)
        fun onCallPhase(phase: String)
        fun onTheme(dark: Boolean)
        fun onOverlay(open: Boolean)
        fun onFocus()
        fun onSignInReopen()
        fun onSignInCancel()
        fun onNotification(note: JSONObject)
        fun onCloseNotification(id: Int)
        fun notificationsAllowed(): Boolean
        fun requestNotifications()
        fun requestPermissions(permissions: Array<String>, done: (Boolean) -> Unit)
        fun chooseFiles(intent: Intent, done: (Array<Uri>?) -> Unit)
    }

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val rules = NavigationRules(origin)
    private val appContext = context.applicationContext
    val shellCache = ShellCache(appContext.filesDir, origin, client, userAgent())

    /** The loading layer (desktop/splash.js): up from a main-frame navigation until the page finished. */
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading

    @Volatile private var online = true
    private var startScriptsSupported = false
    private val preload: String by lazy { appContext.assets.open("preload.js").bufferedReader().readText() }
    private val hostBridge: String by lazy { runCatching { appContext.assets.open("host-bridge.js").bufferedReader().readText() }.getOrDefault("") }

    @SuppressLint("SetJavaScriptEnabled")
    val webView: WebView = WebView(context).apply {
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            useWideViewPort = true
            loadWithOverviewMode = true
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = if (origin.startsWith("http://")) WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE else WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = userAgent()
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        addJavascriptInterface(HostBridge(), "TMAAndroidHost")
        webViewClient = Client()
        webChromeClient = Chrome()
        setDownloadListener { url, _, contentDisposition, mimetype, _ -> download(url, contentDisposition, mimetype) }
        isFocusable = true
        isFocusableInTouchMode = true
        // Compose's AndroidView measures a WebView without layout params as wrap-content,
        // and Chromium then sizes every vh/dvh unit from that unconstrained pass: 0.
        layoutParams = android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
    }

    init {
        // chrome://inspect for debug builds only, the way the desktop opens DevTools.
        if (0 != (appContext.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)) WebView.setWebContentsDebuggingEnabled(true)
        // Chromium's Electron gets a preload; WebView gets a document-start script (androidx.webkit).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, preload + "\n" + hostBridge, setOf("*"))
            startScriptsSupported = true
        }
    }

    /** The default Chrome-on-Android string plus our own token, the way the desktop strips Electron's (chromeUserAgent). */
    private fun userAgent(): String = WebSettings.getDefaultUserAgent(appContext) + " TMAPortal/$versionName"

    fun loadPortal(path: String = "/") = load(origin + path)

    fun load(url: String) { main.post { webView.loadUrl(url) } }

    fun goBack(): Boolean = if (webView.canGoBack()) { webView.goBack(); true } else false

    fun evaluate(js: String) { main.post { webView.evaluateJavascript(js, null) } }

    /** desktop/signin-waiting.html, shown while the real browser signs in (showSignInWaiting). */
    fun showSignInWaiting(providerLabel: String) {
        _loading.value = false
        main.post { webView.loadUrl("file:///android_asset/signin-waiting.html?provider=" + Uri.encode(providerLabel)) }
    }

    /** The cookies a native sign-in claim collected, handed to the page's jar (one session, two clients). */
    fun importCookies(setCookieLines: List<String>) {
        val cm = CookieManager.getInstance()
        setCookieLines.forEach { cm.setCookie(origin, it) }
        cm.flush()
    }

    fun setOnline(now: Boolean) {
        online = now
        main.post { webView.settings.cacheMode = if (now) WebSettings.LOAD_DEFAULT else WebSettings.LOAD_CACHE_ELSE_NETWORK }
    }

    fun destroy() { webView.destroy(); io.shutdownNow() }

    /* ---------- downloads ---------- */

    private fun download(url: String, contentDisposition: String?, mimetype: String?) {
        if (url.startsWith("blob:") || url.startsWith("data:")) return
        val name = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimetype)
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle(name)
            .setMimeType(mimetype)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            .addRequestHeader("User-Agent", userAgent())
        CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
        appContext.getSystemService(DownloadManager::class.java).enqueue(request)
    }

    /* ---------- the page → host bridge (desktop/preload.js RELAYS) ---------- */

    private inner class HostBridge {
        @JavascriptInterface fun relay(channel: String, value: String) {
            main.post {
                when (channel) {
                    "badge" -> listener.onBadge(value.toIntOrNull() ?: 0)
                    "call" -> listener.onCallPhase(value)
                    "overlay" -> listener.onOverlay(value == "1")
                    "theme" -> listener.onTheme(value == "dark")
                    "focus" -> listener.onFocus()
                    "signin-reopen" -> listener.onSignInReopen()
                    "signin-cancel" -> listener.onSignInCancel()
                }
            }
        }
        @JavascriptInterface fun notify(json: String) { runCatching { JSONObject(json) }.getOrNull()?.let { n -> main.post { listener.onNotification(n) } } }
        @JavascriptInterface fun closeNotification(id: Int) { main.post { listener.onCloseNotification(id) } }
        @JavascriptInterface fun openInBrowser(url: String) { main.post { listener.onOpenOutside(url) } }
        @JavascriptInterface fun version(): String = versionName
        @JavascriptInterface fun notificationsAllowed(): Boolean = listener.notificationsAllowed()
        @JavascriptInterface fun requestNotifications() { main.post { listener.requestNotifications() } }
    }

    /* ---------- navigation (attachNavigationRules, asset-cache handle, shell-cache) ---------- */

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            val url = request.url.toString()
            if (url.startsWith("file:") || url.startsWith("data:") || url.startsWith("about:")) return false
            rules.signInProviderFor(url, view.url)?.let { listener.onSignInProvider(it); return true }
            if (rules.isSocialRedirect(url)) { listener.onOpenOutside(url); return true }
            if (rules.isPortalUrl(url) || rules.isAuthUrl(url)) return false
            listener.onOpenOutside(url)
            return true
        }

        /** Offline, a navigation to a page the kept shell covers is answered from disk (shellCache.maybeServe). */
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (!request.isForMainFrame || request.method != "GET" || online) return null
            val url = request.url
            if (!rules.isPortalUrl(url.toString())) return null
            if (!(request.requestHeaders["Accept"] ?: "").startsWith("text/html")) return null
            val html = shellCache.maybeServe(url.path ?: "/", offline = true) ?: return null
            return WebResourceResponse("text/html", "utf-8", 200, "OK", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(html.toByteArray()))
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            if (!url.startsWith("file:") && !url.startsWith("data:")) _loading.value = true
            if (!startScriptsSupported) view.evaluateJavascript(preload + "\n" + hostBridge, null)
        }

        override fun onPageFinished(view: WebView, url: String) {
            _loading.value = false
            if (rules.isPortalUrl(url) && !shellCache.servingFromCache) {
                val path = Uri.parse(url).path ?: "/"
                io.execute { runCatching { shellCache.capture(path) } }
            }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            val url = request.url.toString()
            if (!rules.isPortalUrl(url)) return
            val description = error.description?.toString() ?: "The page could not be loaded."
            io.execute {
                val offline = looksOffline()
                val shell = if (offline) shellCache.maybeServe(request.url.path ?: "/", offline = true) else null
                main.post {
                    when {
                        shell != null -> view.loadDataWithBaseURL(url, shell, "text/html", "utf-8", url)
                        offline -> view.loadDataWithBaseURL(origin, OfflinePages.offline(origin), "text/html", "utf-8", null)
                        else -> view.loadDataWithBaseURL(origin, OfflinePages.loadError(origin, description, url), "text/html", "utf-8", null)
                    }
                    _loading.value = false
                }
            }
        }
    }

    /** desktop/main.js looksOffline: `/up` answers, or it does not. */
    private fun looksOffline(): Boolean = try {
        client.newCall(Request.Builder().url("$origin/up").header("User-Agent", userAgent()).build()).execute().use { !it.isSuccessful }
    } catch (e: IOException) { true }

    /* ---------- permissions and uploads ---------- */

    private inner class Chrome : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            val from = request.origin?.toString().orEmpty().trimEnd('/')
            if (from != origin) { request.deny(); return }
            val wanted = request.resources.filter { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
            if (wanted.isEmpty()) { request.deny(); return }
            val permissions = buildList {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in wanted) add(android.Manifest.permission.RECORD_AUDIO)
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in wanted) add(android.Manifest.permission.CAMERA)
            }.toTypedArray()
            listener.requestPermissions(permissions) { granted -> if (granted) request.grant(wanted.toTypedArray()) else request.deny() }
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            listener.chooseFiles(params.createIntent()) { uris -> callback.onReceiveValue(uris) }
            return true
        }
    }
}
