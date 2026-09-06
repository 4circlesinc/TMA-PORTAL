package com.tmantoinelaw.portal.feature.shell

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.TmaIconButton
import com.tmantoinelaw.portal.core.ui.theme.Tma

/**
 * The header (dashboard.html:213-260 and dashboard.js:664-690 for the phone
 * bubble): menu button and logo mark on phones, the page title otherwise,
 * then the theme toggle and the avatar menu. Search and the bell join in
 * their phases.
 */
@Composable
fun Header(
    title: String,
    identity: Identity,
    avatarUrl: String?,
    phone: Boolean,
    onMenu: () -> Unit,
    onToggleTheme: () -> Unit,
    onProfile: () -> Unit,
    onSettings: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
    actions: @Composable RowScopeActions.() -> Unit = {},
) {
    Row(
        modifier
            .fillMaxWidth()
            .background(Tma.colors.page)
            .statusBarsPadding()
            .padding(horizontal = Tma.space.s16, vertical = Tma.space.s12)
            .height(44.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tma.space.s8),
    ) {
        if (phone) {
            Row(
                Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.surface).padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TmaIconButton(icon = R.drawable.ic_list_dashes, contentDescription = "Menu", onClick = onMenu)
                Image(
                    painter = painterResource(R.drawable.logo_mark),
                    contentDescription = "TM ANTOINE Advisory home",
                    modifier = Modifier.size(28.dp).padding(end = 2.dp),
                )
                Spacer(Modifier.width(6.dp))
            }
        } else {
            Text(title, style = Tma.type.text18sb, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.weight(1f))
        Row(
            Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(if (phone) Tma.colors.surface else Color.Transparent).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RowScopeActions(this).actions()
            TmaIconButton(icon = R.drawable.ic_sun, contentDescription = "Toggle theme", onClick = onToggleTheme)
            var open by remember { mutableStateOf(false) }
            Box {
                Box(
                    Modifier.padding(horizontal = 6.dp).clip(CircleShape).clickable { open = true },
                ) {
                    PortalAvatar(url = avatarUrl, name = identity.name, size = 32.dp)
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    DropdownMenuItem(text = { Text("My profile", style = Tma.type.text14) }, onClick = { open = false; onProfile() })
                    DropdownMenuItem(text = { Text("Settings", style = Tma.type.text14) }, onClick = { open = false; onSettings() })
                    DropdownMenuItem(text = { Text("Sign out", style = Tma.type.text14) }, onClick = { open = false; onSignOut() })
                }
            }
        }
    }
}

/** Extra header actions a screen adds (the bell, search, a page's own buttons). */
class RowScopeActions(val scope: androidx.compose.foundation.layout.RowScope)
