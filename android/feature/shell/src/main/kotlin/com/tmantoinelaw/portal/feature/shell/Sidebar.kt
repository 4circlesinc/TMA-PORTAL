package com.tmantoinelaw.portal.feature.shell

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.navigation.Route
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.TmaIconButton
import com.tmantoinelaw.portal.core.ui.theme.Tma

/**
 * The sidebar (resources/views/pages/dashboard.html:97-230): brand, the nav
 * tree with expandable groups, and the profile block with sign-out. On phones
 * the same content sits in the drawer with the phone rows.
 */
@Composable
fun Sidebar(
    identity: Identity,
    activeId: String?,
    avatarUrl: String?,
    phone: Boolean,
    onNavigate: (Route) -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val items = remember(identity, phone) { if (phone) NavTree.phone(identity) else NavTree.visible(identity) }
    Column(
        modifier
            .fillMaxHeight()
            .background(Tma.colors.surface)
            .padding(vertical = Tma.space.s16),
    ) {
        Row(
            Modifier.padding(horizontal = Tma.space.s20, vertical = Tma.space.s8),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
        ) {
            androidx.compose.foundation.Image(
                painter = painterResource(R.drawable.logo_full),
                contentDescription = "TM ANTOINE Advisory",
                modifier = Modifier.height(44.dp),
            )
        }
        Spacer(Modifier.height(Tma.space.s8))
        Text(
            "Main Menu",
            style = Tma.type.text12,
            color = Tma.colors.inkSecondary,
            modifier = Modifier.padding(horizontal = Tma.space.s20, vertical = Tma.space.s8),
        )
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Tma.space.s12),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items.forEach { item ->
                if (item.children.isEmpty()) {
                    NavRow(item, active = item.id == activeId, nested = false) { onNavigate(item.route) }
                } else {
                    NavGroup(item, activeId, onNavigate)
                }
            }
        }
        ProfileBlock(identity, avatarUrl, onSignOut)
    }
}

@Composable
private fun NavGroup(item: NavItem, activeId: String?, onNavigate: (Route) -> Unit) {
    val containsActive = item.children.any { it.id == activeId }
    var expanded by rememberSaveable(item.id) { mutableStateOf(containsActive) }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Tma.radius.r12))
            .clickable { expanded = !expanded }
            .padding(horizontal = Tma.space.s12, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
    ) {
        Icon(painterResource(item.icon), contentDescription = null, tint = Tma.colors.ink, modifier = Modifier.size(20.dp))
        Text(item.label, style = Tma.type.text14, color = Tma.colors.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Icon(
            painterResource(R.drawable.ic_arrow_line_down_16),
            contentDescription = if (expanded) "Collapse" else "Expand",
            tint = Tma.colors.inkSecondary,
            modifier = Modifier.size(16.dp).rotate(if (expanded) 180f else 0f),
        )
    }
    AnimatedVisibility(visible = expanded) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            item.children.forEach { child ->
                NavRow(child, active = child.id == activeId, nested = true) { onNavigate(child.route) }
            }
        }
    }
}

@Composable
private fun NavRow(item: NavItem, active: Boolean, nested: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Tma.radius.r12))
            .background(if (active) Tma.colors.accentBg else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(start = if (nested) Tma.space.s40 else Tma.space.s12, end = Tma.space.s12, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
    ) {
        if (!nested) {
            Icon(
                painterResource(item.icon),
                contentDescription = null,
                tint = if (active) Tma.colors.primaryDark else Tma.colors.ink,
                modifier = Modifier.size(20.dp),
            )
        }
        Text(
            item.label,
            style = Tma.type.text14,
            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
            color = Tma.colors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ProfileBlock(identity: Identity, avatarUrl: String?, onSignOut: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Tma.space.s16, vertical = Tma.space.s8),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tma.space.s12),
    ) {
        PortalAvatar(url = avatarUrl, name = identity.name, size = 32.dp)
        Column(Modifier.weight(1f)) {
            Text(identity.name, style = Tma.type.text14sb, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(identity.email, style = Tma.type.text12, color = Tma.colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        TmaIconButton(icon = R.drawable.ic_sign_out, contentDescription = "Sign out", onClick = onSignOut, tint = Tma.colors.inkSecondary)
    }
}
