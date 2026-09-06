package com.tmantoinelaw.portal.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.ui.theme.Tma

/** The web's `.tma-dash__icon-btn`: a 20 dp masked icon in a 40 dp circle, ink-tinted, hover overlay only. */
@Composable
fun TmaIconButton(
    icon: Int,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = Tma.colors.ink,
    background: Color = Color.Transparent,
) {
    IconButton(onClick = onClick, modifier = modifier.size(40.dp)) {
        Box(Modifier.size(40.dp).background(background, CircleShape), contentAlignment = androidx.compose.ui.Alignment.Center) {
            Icon(painterResource(icon), contentDescription = contentDescription, tint = tint, modifier = Modifier.size(20.dp))
        }
    }
}
