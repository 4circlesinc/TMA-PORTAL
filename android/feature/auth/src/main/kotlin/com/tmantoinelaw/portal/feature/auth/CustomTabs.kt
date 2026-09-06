package com.tmantoinelaw.portal.feature.auth

import android.content.Context
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.ui.graphics.toArgb
import androidx.core.net.toUri
import com.tmantoinelaw.portal.core.ui.theme.Tokens

/**
 * The one browser surface the app uses: sign-in and OAuth consent, in the
 * person's own browser with their own cookies. Google refuses OAuth inside an
 * embedded webview (desktop/main.js:641-648), which is why the handoff exists.
 */
fun Context.openCustomTab(url: String) {
    val params = CustomTabColorSchemeParams.Builder()
        .setToolbarColor(Tokens.Brand.primaryDark.toArgb())
        .build()
    CustomTabsIntent.Builder()
        .setDefaultColorSchemeParams(params)
        .setShowTitle(true)
        .build()
        .launchUrl(this, url.toUri())
}
