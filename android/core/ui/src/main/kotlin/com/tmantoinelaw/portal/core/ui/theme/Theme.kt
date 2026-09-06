package com.tmantoinelaw.portal.core.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The portal's theme preference. Light is the default and the device scheme is
 * ignored unless the person chose System or Dark (Settings › Theme,
 * `/me/preferences.themeMode`).
 */
enum class ThemeMode { System, Light, Dark }

/** Every colour the design system names, resolved for one theme. */
@Immutable
data class TmaColors(
    val isDark: Boolean,
    val page: Color,
    val surface: Color,
    val card: Color,
    val panel: Color,
    val input: Color,
    val popup: Color,
    val popupGlass: Color,
    val tooltip: Color,
    val tag: Color,
    val code: Color,
    val ink: Color,
    val inkSecondary: Color,
    val inkMuted: Color,
    val placeholder: Color,
    val link: Color,
    val hint: Color,
    val borderSoft: Color,
    val borderMedium: Color,
    val borderStrong: Color,
    val borderHeavy: Color,
    val hover: Color,
    val hoverDeep: Color,
    val active: Color,
    val inactive: Color,
    val primary: Color,
    val primaryDark: Color,
    val tint1: Color,
    val tint2: Color,
    val accentBg: Color,
    val accentBgHover: Color,
    val dashCard1: Color,
    val dashCard2: Color,
    val kpi1: Color,
    val kpi2: Color,
    val danger: Color,
    val success: Color,
    val warning: Color,
    val onPrimary: Color,
)

val lightTmaColors: TmaColors = with(Tokens.Light) {
    TmaColors(
        isDark = false,
        page = page, surface = surface, card = card, panel = panel, input = input, popup = popup, popupGlass = popupGlass,
        tooltip = tooltip, tag = tag, code = code,
        ink = ink, inkSecondary = inkSecondary, inkMuted = inkMuted, placeholder = placeholder, link = link, hint = hint,
        borderSoft = borderSoft, borderMedium = borderMedium, borderStrong = borderStrong, borderHeavy = borderHeavy,
        hover = hover, hoverDeep = hoverDeep, active = active, inactive = inactive,
        primary = Tokens.Brand.primary, primaryDark = Tokens.Brand.primaryDark, tint1 = Tokens.Brand.tint1, tint2 = Tokens.Brand.tint2,
        accentBg = accentBg, accentBgHover = accentBgHover,
        dashCard1 = dashCard1, dashCard2 = dashCard2, kpi1 = kpi1, kpi2 = kpi2,
        danger = Tokens.Accent.red, success = Tokens.Accent.green, warning = Tokens.Accent.orange,
        onPrimary = Tokens.Brand.white,
    )
}

val darkTmaColors: TmaColors = with(Tokens.Dark) {
    TmaColors(
        isDark = true,
        page = page, surface = surface, card = card, panel = panel, input = input, popup = popup, popupGlass = popupGlass,
        tooltip = tooltip, tag = tag, code = code,
        ink = ink, inkSecondary = inkSecondary, inkMuted = inkMuted, placeholder = placeholder, link = link, hint = hint,
        borderSoft = borderSoft, borderMedium = borderMedium, borderStrong = borderStrong, borderHeavy = borderHeavy,
        hover = hover, hoverDeep = hoverDeep, active = active, inactive = inactive,
        primary = Tokens.Brand.primary, primaryDark = Tokens.Brand.primaryDark, tint1 = tag, tint2 = dashCard2,
        accentBg = accentBg, accentBgHover = accentBgHover,
        dashCard1 = dashCard1, dashCard2 = dashCard2, kpi1 = kpi1, kpi2 = kpi2,
        danger = Tokens.Accent.red, success = Tokens.Accent.green, warning = Tokens.Accent.orange,
        onPrimary = Tokens.Brand.white,
    )
}

val LocalTmaColors = staticCompositionLocalOf { lightTmaColors }

/** `Tma.colors.page`, `Tma.space.s16`, `Tma.radius.r16`, `Tma.type.text14sb`: the one door to the design system. */
object Tma {
    val colors: TmaColors
        @Composable @ReadOnlyComposable get() = LocalTmaColors.current
    val space = Tokens.Space
    val radius = Tokens.Radius
    val size = Tokens.Size
    val type = TmaType
}

private fun TmaColors.toMaterial(): ColorScheme {
    val base = if (isDark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = primary,
        onPrimary = onPrimary,
        primaryContainer = tint1,
        onPrimaryContainer = ink,
        secondary = primaryDark,
        onSecondary = onPrimary,
        secondaryContainer = tint2,
        onSecondaryContainer = ink,
        tertiary = primaryDark,
        tertiaryContainer = tint2,
        background = page,
        onBackground = ink,
        surface = card,
        onSurface = ink,
        surfaceVariant = card,
        onSurfaceVariant = inkSecondary,
        surfaceContainerLowest = surface,
        surfaceContainerLow = card,
        surfaceContainer = card,
        surfaceContainerHigh = panel,
        surfaceContainerHighest = panel,
        outline = borderMedium,
        outlineVariant = borderSoft,
        error = danger,
        onError = Tokens.Brand.white,
        scrim = Color.Black,
    )
}

@Composable
fun TmaTheme(
    mode: ThemeMode = ThemeMode.Light,
    fontScale: Int = 3,
    content: @Composable () -> Unit,
) {
    val dark = when (mode) {
        ThemeMode.Dark -> true
        ThemeMode.Light -> false
        ThemeMode.System -> isSystemInDarkTheme()
    }
    val colors = if (dark) darkTmaColors else lightTmaColors
    CompositionLocalProvider(LocalTmaColors provides colors) {
        MaterialTheme(
            colorScheme = colors.toMaterial(),
            typography = tmaTypography(fontScale),
            content = content,
        )
    }
}
