package com.tmantoinelaw.portal

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tmantoinelaw.portal.core.navigation.DeepLinks
import com.tmantoinelaw.portal.core.ui.theme.TmaTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val viewModel: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // The system splash holds until Compose has composed its first frame, so the
        // handoff to BootSplash (the same surface) never shows a blank window between.
        var composed = false
        splash.setKeepOnScreenCondition { !composed }

        handle(intent)
        setContent {
            val mode by viewModel.themeMode.collectAsStateWithLifecycle()
            TmaTheme(mode = mode) {
                PortalApp(viewModel = viewModel, onFirstFrame = { composed = true })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    override fun onStart() {
        super.onStart()
        // Back from the browser (sign-in, a wall, an OAuth connect): ask the server again.
        viewModel.refresh()
    }

    /**
     * `tmaportal://auth?token=…` is the sign-in handoff's return leg (prompt §5);
     * `https://portal…/<path>` is an App Link (prompt §8.4).
     */
    private fun handle(intent: Intent?) {
        val uri = intent?.data ?: return
        when {
            uri.scheme == "tmaportal" && uri.host == "auth" ->
                uri.getQueryParameter("token")?.takeIf { it.length == 64 }?.let { viewModel.onAuthToken(it) }
            uri.scheme == "https" || uri.scheme == "http" -> {
                val query = uri.queryParameterNames.associateWith { uri.getQueryParameter(it).orEmpty() }
                viewModel.onDeepLink(DeepLinks.parse(uri.path.orEmpty(), query), uri.toString())
            }
        }
        intent.data = null
    }
}
