package com.tmantoinelaw.portal.web

import android.content.Context
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.ui.graphics.toArgb
import androidx.core.net.toUri
import com.tmantoinelaw.portal.core.ui.theme.Tokens

/** The system browser for everything the shell must not load itself (shell.openExternal). */
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
