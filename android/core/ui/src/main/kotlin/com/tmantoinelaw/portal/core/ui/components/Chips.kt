package com.tmantoinelaw.portal.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.core.ui.theme.Tokens

/** `.tma-portal-status--{tone}` colours (public/css/portal-ui.css). */
@Composable
fun toneColour(tone: String?): Color = when (tone) {
    "success" -> Tokens.Accent.green
    "danger" -> Tokens.Accent.red
    "warning", "action" -> Tokens.Accent.orange
    "pending" -> Tokens.Accent.yellow
    "info" -> Tokens.Accent.blue
    else -> Tma.colors.inactive
}

/** The inline status chip (`.tma-portal-status--inline`). Tappable when `onClick` is given. */
@Composable
fun ToneChip(label: String, tone: String?, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val colour = toneColour(tone)
    Box(
        modifier
            .clip(RoundedCornerShape(Tma.radius.pill))
            .background(colour.copy(alpha = 0.18f))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    ) {
        Text(label, style = Tma.type.text12, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The small count pill after a tab or card title (`tabCountChip`). */
@Composable
fun CountChip(text: String, modifier: Modifier = Modifier) {
    Box(modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.hover).padding(horizontal = 6.dp, vertical = 1.dp)) {
        Text(text, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1)
    }
}
