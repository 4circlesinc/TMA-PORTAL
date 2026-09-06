package com.tmantoinelaw.portal.core.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.sp
import com.tmantoinelaw.portal.core.ui.R

/** Inter 400/600/700, bundled (the web loads the same three weights from Google Fonts). */
val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
)

private fun Tokens.Type.Step.style(scale: Float = 1f) = TextStyle(
    fontFamily = Inter,
    fontSize = (size * scale).sp,
    lineHeight = (lineHeight * scale).sp,
    fontWeight = weight,
    letterSpacing = 0.sp,
    fontFeatureSettings = Tokens.Type.fontFeatures,
    platformStyle = PlatformTextStyle(includeFontPadding = false),
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

/** The design system's type scale (design/tokens.json `typography.scale`), at the default font scale. */
object TmaType {
    val text12 = Tokens.Type.text12.style()
    val text14 = Tokens.Type.text14.style()
    val text14sb = Tokens.Type.text14sb.style()
    val text18 = Tokens.Type.text18.style()
    val text18sb = Tokens.Type.text18sb.style()
    val text24sb = Tokens.Type.text24sb.style()
    val text48 = Tokens.Type.text48.style()
    val text48sb = Tokens.Type.text48sb.style()
    val text64sb = Tokens.Type.text64sb.style()
    val heading64 = Tokens.Type.heading64.style()
}

/** `/me/preferences.fontScale` 1..5 (default 3) steps the whole scale; the system font scale applies on top through sp. */
fun fontScaleFactor(step: Int): Float = when (step.coerceIn(1, 5)) {
    1 -> 0.90f
    2 -> 0.95f
    3 -> 1f
    4 -> 1.08f
    else -> 1.16f
}

fun tmaTypography(fontScale: Int = 3): Typography {
    val f = fontScaleFactor(fontScale)
    val t = Tokens.Type
    return Typography(
        displayLarge = t.heading64.style(f),
        displayMedium = t.text64sb.style(f),
        displaySmall = t.text48sb.style(f),
        headlineLarge = t.text48.style(f),
        headlineMedium = t.text24sb.style(f),
        headlineSmall = t.text24sb.style(f),
        titleLarge = t.text24sb.style(f),
        titleMedium = t.text18sb.style(f),
        titleSmall = t.text14sb.style(f),
        bodyLarge = t.text18.style(f),
        bodyMedium = t.text14.style(f),
        bodySmall = t.text12.style(f),
        labelLarge = t.text14sb.style(f),
        labelMedium = t.text12.style(f).copy(fontWeight = FontWeight.SemiBold),
        labelSmall = t.text12.style(f),
    )
}
