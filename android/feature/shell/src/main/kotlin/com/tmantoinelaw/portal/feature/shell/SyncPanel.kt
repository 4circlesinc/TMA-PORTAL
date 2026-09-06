package com.tmantoinelaw.portal.feature.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.database.WriteIntentEntity
import com.tmantoinelaw.portal.core.ui.theme.Tma

/**
 * The sync panel behind the pill (portal-sync-status.js): the offline lead
 * sentence, and every parked change with Try again and Discard. The queue
 * never throws work away by itself.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncPanel(
    online: Boolean,
    entries: List<WriteIntentEntity>,
    replica: String?,
    onRetry: (Long) -> Unit,
    onDiscard: (Long) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tma.colors.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Tma.space.s20).padding(bottom = Tma.space.s24), verticalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
            Text(
                if (!online) "You’re offline. These changes are saved on this device and will be sent on their own once you have a connection."
                else if (entries.isEmpty()) "Everything is up to date." else "Changes waiting to be sent.",
                style = Tma.type.text14, color = Tma.colors.ink,
            )
            replica?.let { Text(it, style = Tma.type.text12, color = Tma.colors.inkSecondary) }
            if (entries.isNotEmpty()) HorizontalDivider(color = Tma.colors.borderSoft)
            entries.forEach { e ->
                Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(e.label, style = Tma.type.text14sb, color = Tma.colors.ink, modifier = Modifier.weight(1f))
                        Text(if (e.state == "failed") "Couldn’t be sent" else "Waiting", style = Tma.type.text12, color = if (e.state == "failed") Tma.colors.danger else Tma.colors.inkSecondary)
                    }
                    if (e.state == "failed") {
                        if (e.error.isNotBlank()) Text(e.error, style = Tma.type.text12, color = Tma.colors.inkSecondary)
                        Row {
                            TextButton(onClick = { onRetry(e.id) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text("Try again", style = Tma.type.text14sb, color = Tma.colors.link) }
                            TextButton(onClick = { onDiscard(e.id) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp)) { Text("Discard", style = Tma.type.text14sb, color = Tma.colors.danger) }
                        }
                    }
                }
            }
        }
    }
}
