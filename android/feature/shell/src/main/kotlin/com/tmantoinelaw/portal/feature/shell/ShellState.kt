package com.tmantoinelaw.portal.feature.shell

import androidx.compose.runtime.Composable
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.window.core.layout.WindowSizeClass

/**
 * The web's three layouts (public/css/dashboard-tma-overrides.css): phone
 * (≤767), tablet (≤1024) and desktop, as window size classes (prompt §7.7).
 */
enum class Layout { Compact, Medium, Expanded }

@Composable
fun currentLayout(): Layout {
    val sizeClass = currentWindowAdaptiveInfo().windowSizeClass
    return when {
        sizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND) -> Layout.Expanded
        sizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND) -> Layout.Medium
        else -> Layout.Compact
    }
}
