package com.tmantoinelaw.portal

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tmantoinelaw.portal.core.ui.splash.BootSplash
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.web.PortalWebHost
import kotlinx.coroutines.delay

/**
 * The window: the portal's own front end in the WebView, under the loading
 * layer (desktop/splash.js) that lifts once the page has finished and the
 * lockup has risen. Back walks the page's history first.
 */
@Composable
fun PortalApp(host: PortalWebHost, onFirstFrame: () -> Unit) {
    val loading by host.loading.collectAsStateWithLifecycle()
    var risen by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        onFirstFrame()
        delay(420)
        risen = true
    }
    BackHandler(enabled = true) { if (!host.goBack()) host.loadPortal() }
    Box(Modifier.fillMaxSize().background(Tma.colors.page)) {
        AndroidView(factory = { host.webView }, modifier = Modifier.fillMaxSize())
        BootSplash(visible = loading || !risen)
    }
}
