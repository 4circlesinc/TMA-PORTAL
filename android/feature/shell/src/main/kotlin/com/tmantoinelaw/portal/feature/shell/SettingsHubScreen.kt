package com.tmantoinelaw.portal.feature.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.ui.theme.Tma

/**
 * The settings hub (`/account-settings`, prompt §8.3 and §11.15): the rail of
 * pages the account may open, and the page beside it (or instead of it on a
 * phone). Each page's body arrives with its module; until then the title.
 */
@Composable
fun SettingsHubScreen(
    identity: Identity,
    page: String?,
    onOpen: (String) -> Unit,
    pageContent: @Composable (SettingsPage) -> Unit = { ModulePlaceholder(it.label) },
) {
    val pages = remember(identity) { NavTree.settingsFor(identity) }
    val layout = currentLayout()
    val current = pages.firstOrNull { it.id == page }

    if (layout == Layout.Compact) {
        if (current == null) SettingsRail(pages, selected = null, onOpen = onOpen, modifier = Modifier.fillMaxSize())
        else pageContent(current)
        return
    }
    Row(Modifier.fillMaxSize()) {
        SettingsRail(pages, selected = current?.id ?: pages.first().id, onOpen = onOpen, modifier = Modifier.width(260.dp).fillMaxHeight())
        Box(Modifier.fillMaxSize()) { pageContent(current ?: pages.first()) }
    }
}

@Composable
private fun SettingsRail(pages: List<SettingsPage>, selected: String?, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val grouped = remember(pages) { pages.groupBy { it.section } }
    LazyColumn(modifier.padding(Tma.space.s12), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        grouped.forEach { (section, rows) ->
            item(key = "section-$section") {
                Text(
                    section,
                    style = Tma.type.text12,
                    color = Tma.colors.inkSecondary,
                    modifier = Modifier.padding(horizontal = Tma.space.s12, vertical = Tma.space.s8),
                )
            }
            items(rows, key = { it.id }) { row ->
                val active = row.id == selected
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(Tma.radius.r12))
                        .background(if (active) Tma.colors.accentBg else Color.Transparent)
                        .clickable { onOpen(row.id) }
                        .padding(horizontal = Tma.space.s12, vertical = 10.dp),
                ) {
                    Text(
                        row.label,
                        style = Tma.type.text14,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                        color = Tma.colors.ink,
                    )
                }
            }
        }
    }
}
