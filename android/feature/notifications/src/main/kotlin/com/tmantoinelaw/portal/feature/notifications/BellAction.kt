package com.tmantoinelaw.portal.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.TmaIconButton
import com.tmantoinelaw.portal.core.ui.theme.Tma

/** The header bell with the unread count (the badge red is the desktop's, desktop/badge.js). */
@Composable
fun BellAction(unread: Int, onClick: () -> Unit) {
    Box {
        TmaIconButton(icon = R.drawable.ic_bell, contentDescription = "Notifications", onClick = onClick)
        if (unread > 0) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 4.dp, end = 2.dp)
                    .defaultMinSize(minWidth = 18.dp)
                    .height(18.dp)
                    .background(Color(0xFFD21C1C), RoundedCornerShape(9.dp))
                    .padding(horizontal = 5.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (unread > 99) "99+" else unread.toString(), style = Tma.type.text12, color = Color.White)
            }
        }
    }
}
