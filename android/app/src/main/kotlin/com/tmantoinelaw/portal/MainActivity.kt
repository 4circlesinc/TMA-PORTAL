package com.tmantoinelaw.portal

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AlertDialog
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.tmantoinelaw.portal.core.ui.theme.TmaTheme
import com.tmantoinelaw.portal.feature.auth.openCustomTab
import com.tmantoinelaw.portal.web.PortalWebHost
import com.tmantoinelaw.portal.web.WebNotifications
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import org.json.JSONObject
import javax.inject.Inject

/**
 * The window (desktop/main.js createMainWindow): the WebView host, the
 * bridge's ipc handlers, deep links, permissions and the file chooser.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity(), PortalWebHost.Listener {

    private val viewModel: AppViewModel by viewModels()
    @Inject lateinit var okHttp: OkHttpClient
    private lateinit var host: PortalWebHost

    private var permissionCallback: ((Boolean) -> Unit)? = null
    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        permissionCallback?.invoke(result.values.all { it }); permissionCallback = null
    }
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        host.evaluate("window.__tmaNotificationPermission && __tmaNotificationPermission($granted)")
    }
    private var fileCallback: ((Array<Uri>?) -> Unit)? = null
    private val chooseFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.invoke(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)); fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        var composed = false
        splash.setKeepOnScreenCondition { !composed }
        WebNotifications.ensureChannel(this)

        host = PortalWebHost(this, viewModel.config.origin, BuildConfig.VERSION_NAME, okHttp, this)
        lifecycleScope.launch { viewModel.connectivity.online.collect { host.setOnline(it) } }
        lifecycleScope.launch {
            viewModel.events.collect { e ->
                when (e) {
                    is AppEvent.OpenOutside -> openCustomTab(e.url)
                    is AppEvent.ShowSignInWaiting -> host.showSignInWaiting(e.providerLabel)
                    is AppEvent.SessionClaimed -> { host.importCookies(e.setCookieLines); host.loadPortal() }
                    is AppEvent.LoadPortal -> host.loadPortal(e.path)
                    is AppEvent.Notice -> AlertDialog.Builder(this@MainActivity).setTitle(e.title).setMessage(e.message).setPositiveButton("OK", null).show()
                }
            }
        }
        if (!handle(intent)) host.loadPortal()
        if (Build.VERSION.SDK_INT >= 33 && !notificationsAllowed()) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)

        setContent {
            val mode by viewModel.themeMode.collectAsStateWithLifecycle()
            TmaTheme(mode = mode) { PortalApp(host = host, onFirstFrame = { composed = true }) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    override fun onDestroy() { super.onDestroy(); host.destroy() }

    /**
     * `tmaportal://auth?token=…` is the sign-in handoff's return leg; an https
     * App Link loads in the page; a notification tap hands the click back to
     * the page's own handler. True when the intent decided what to load.
     */
    private fun handle(intent: Intent?): Boolean {
        if (intent == null) return false
        intent.getIntExtra(WebNotifications.EXTRA_ID, 0).takeIf { it > 0 }?.let { id ->
            val url = intent.getStringExtra(WebNotifications.EXTRA_URL).orEmpty()
            host.evaluate("window.__tmaNotificationClick && __tmaNotificationClick($id)")
            if (url.isNotBlank()) host.load(if (url.startsWith("http")) url else viewModel.config.url(url))
            intent.removeExtra(WebNotifications.EXTRA_ID)
            return url.isNotBlank()
        }
        val uri = intent.data ?: return false
        intent.data = null
        return when {
            uri.scheme == "tmaportal" && uri.host == "auth" -> {
                uri.getQueryParameter("token")?.takeIf { it.length == 64 }?.let { viewModel.onAuthToken(it) }
                true
            }
            uri.scheme == "https" || uri.scheme == "http" -> { host.load(uri.toString()); true }
            else -> false
        }
    }

    /* ---------- PortalWebHost.Listener (the ipc handlers) ---------- */

    override fun onSignInProvider(provider: String) = viewModel.startBrowserSignIn(provider)
    override fun onOpenOutside(url: String) = openCustomTab(url)
    override fun onBadge(count: Int) = Unit // launcher badges follow the shade on Android
    override fun onCallPhase(phase: String) {
        // applyCallPhase: the display stays awake while a call rings or runs.
        if (phase == "ringing" || phase == "active") window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    override fun onTheme(dark: Boolean) {
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = !dark
        viewModel.rememberTheme(dark)
    }
    override fun onOverlay(open: Boolean) = Unit
    override fun onFocus() = Unit
    override fun onSignInReopen() = viewModel.reopenBrowserSignIn()
    override fun onSignInCancel() = viewModel.cancelBrowserSignIn()
    override fun onNotification(note: JSONObject) = WebNotifications.show(this, note)
    override fun onCloseNotification(id: Int) = WebNotifications.close(this, id)
    override fun notificationsAllowed(): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    override fun requestNotifications() { if (Build.VERSION.SDK_INT >= 33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
    override fun requestPermissions(permissions: Array<String>, done: (Boolean) -> Unit) {
        if (permissions.all { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }) { done(true); return }
        permissionCallback = done
        askPermissions.launch(permissions)
    }
    override fun chooseFiles(intent: Intent, done: (Array<Uri>?) -> Unit) {
        fileCallback = done
        runCatching { chooseFile.launch(intent) }.onFailure { done(null); fileCallback = null }
    }
}
