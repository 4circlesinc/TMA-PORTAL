package com.tmantoinelaw.portal.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tmantoinelaw.portal.core.ui.theme.Inter

/**
 * The initials fallback, exactly the web's (public/js/current-user.js:151-160):
 * the first letters of the first two words, upper-cased, on one of seven colours
 * picked by summing the seed's character codes mod 997 mod 7. Real photos are
 * drawn by the caller through Coil; this is what stands in when `avatar` is null.
 */
private val palette = listOf(
    Color(0xFF136DA0), Color(0xFF03A5E9), Color(0xFF0F9D8C), Color(0xFF3F9142),
    Color(0xFFC77D18), Color(0xFFB5497E), Color(0xFF3B6FB8),
)

fun initialsOf(name: String?): String =
    name.orEmpty().trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2)
        .joinToString("") { it.substring(0, 1) }.uppercase().ifEmpty { "?" }

fun initialsColour(seed: String?): Color {
    var n = 0
    for (ch in seed.orEmpty()) n = (n + ch.code) % 997
    return palette[n % palette.size]
}

@Composable
fun InitialsAvatar(name: String?, size: Dp, modifier: Modifier = Modifier, seed: String? = name) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(initialsColour(seed)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initialsOf(name),
            color = Color.White,
            fontFamily = Inter,
            fontWeight = FontWeight.SemiBold,
            fontSize = (size.value * 0.4f).sp,
            lineHeight = (size.value * 0.4f).sp,
        )
    }
}
