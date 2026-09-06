package com.tmantoinelaw.portal.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.theme.Tma

/**
 * Edit Dashboard (portal-home.js DASH_TILES): show or hide each tile and move
 * it up or down. Saved as one `/me/preferences` write on every change.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditDashboardSheet(
    identity: Identity,
    show: Map<String, Boolean>,
    order: List<String>,
    cipCard: Boolean,
    onDismiss: () -> Unit,
    onSave: (Map<String, Boolean>, List<String>) -> Unit,
) {
    var visible by remember { mutableStateOf(show) }
    var ordering by remember { mutableStateOf(order) }
    val offered = Board.tiles.filter { t ->
        (t.cap == null || identity.can(t.cap)) && (!t.staffOnly || identity.isStaff) && (!t.cipCard || cipCard)
    }
    fun commit() {
        val all = Board.defaultOrder.associateWith { visible[it] != false }
        onSave(all, ordering)
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tma.colors.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Tma.space.s20, vertical = Tma.space.s12), verticalArrangement = Arrangement.spacedBy(Tma.space.s4)) {
            Text("Edit Dashboard", style = Tma.type.text18sb, color = Tma.colors.ink, modifier = Modifier.padding(bottom = Tma.space.s8))
            ordering.filter { id -> offered.any { it.id == id } }.forEachIndexed { index, id ->
                val spec = offered.first { it.id == id }
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tma.space.s8)) {
                    Column(Modifier.weight(1f)) {
                        Text(spec.label, style = Tma.type.text14sb, color = Tma.colors.ink)
                        Text(spec.desc, style = Tma.type.text12, color = Tma.colors.inkSecondary)
                    }
                    IconButton(onClick = { ordering = ordering.moved(id, -1); commit() }, enabled = index > 0) {
                        Icon(painterResource(R.drawable.ic_arrow_line_down_16), contentDescription = "Move up", tint = Tma.colors.inkSecondary, modifier = Modifier.size(16.dp).rotate(180f))
                    }
                    IconButton(onClick = { ordering = ordering.moved(id, 1); commit() }, enabled = index < ordering.size - 1) {
                        Icon(painterResource(R.drawable.ic_arrow_line_down_16), contentDescription = "Move down", tint = Tma.colors.inkSecondary, modifier = Modifier.size(16.dp))
                    }
                    Switch(
                        checked = visible[id] != false,
                        onCheckedChange = { on -> visible = visible + (id to on); commit() },
                        colors = SwitchDefaults.colors(checkedTrackColor = Tma.colors.primary),
                    )
                }
            }
        }
    }
}

private fun List<String>.moved(id: String, delta: Int): List<String> {
    val i = indexOf(id); val j = i + delta
    if (i < 0 || j < 0 || j >= size) return this
    return toMutableList().apply { removeAt(i); add(j, id) }
}
