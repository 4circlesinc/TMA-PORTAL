package com.tmantoinelaw.portal.feature.files

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.data.files.UploadJob
import com.tmantoinelaw.portal.core.data.files.UploadStatus
import com.tmantoinelaw.portal.core.ui.theme.Tma

/** The upload panel (portal-upload-manager.js renderPanel): title, one row per job, its status label and actions. */
@Composable
fun UploadPanel(jobs: List<UploadJob>, onCancel: (String) -> Unit, onRetry: (String) -> Unit, onDismiss: (String) -> Unit, onClear: () -> Unit) {
    if (jobs.isEmpty()) return
    val active = jobs.count { it.active }
    val done = jobs.count { it.status == UploadStatus.Completed }
    val title = if (active > 0) "Uploading $active file${if (active == 1) "" else "s"}" else "$done upload${if (done == 1) "" else "s"} complete"
    Column(Modifier.fillMaxWidth().padding(horizontal = Tma.space.s12, vertical = 6.dp).clip(RoundedCornerShape(Tma.radius.r12)).background(Tma.colors.surface).padding(Tma.space.s12), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = Tma.type.text14sb, color = Tma.colors.ink, modifier = Modifier.weight(1f))
            if (active == 0) Text("Clear", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable(onClick = onClear))
        }
        Column(Modifier.heightIn(max = 200.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            jobs.forEach { job ->
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(job.name, style = Tma.type.text12, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text(statusLabel(job), style = Tma.type.text12, color = if (job.status == UploadStatus.Failed) Tma.colors.danger else Tma.colors.inkSecondary, maxLines = 1)
                        when (job.status) {
                            UploadStatus.Failed -> Text("Retry", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable { onRetry(job.id) })
                            UploadStatus.Completed, UploadStatus.Cancelled -> Text("✕", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.clickable { onDismiss(job.id) })
                            else -> Text("✕", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.clickable { onCancel(job.id) })
                        }
                    }
                    if (job.active) LinearProgressIndicator(progress = { job.progress }, modifier = Modifier.fillMaxWidth(), color = Tma.colors.primary, trackColor = Tma.colors.hover)
                }
            }
        }
    }
}

private fun statusLabel(job: UploadJob): String = when (job.status) {
    UploadStatus.Queued -> "Waiting…"
    UploadStatus.Uploading -> job.error ?: "${(job.progress * 100).toInt()}%"
    UploadStatus.Processing -> "Processing…"
    UploadStatus.Completed -> "Completed"
    UploadStatus.Failed -> job.error ?: "Failed"
    UploadStatus.Cancelled -> "Cancelled"
    UploadStatus.Conflict -> "Paused"
}

/** portal-upload-manager.js promptConflict: "File already exists". */
@Composable
fun UploadConflictDialog(job: UploadJob, onChoice: (choice: String, newName: String?) -> Unit, onCancel: () -> Unit) {
    val conflict = job.conflict ?: return
    var renaming by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf(conflict.suggestion ?: job.name) }
    AlertDialog(
        onDismissRequest = onCancel,
        containerColor = Tma.colors.surface,
        title = { Text("File already exists", style = Tma.type.text18sb, color = Tma.colors.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Tma.space.s8)) {
                Text("“${conflict.existingName}” already exists here. What would you like to do?", style = Tma.type.text14, color = Tma.colors.inkSecondary)
                if (renaming) OutlinedTextField(value = name, onValueChange = { name = it }, singleLine = true, label = { Text("New name") }, keyboardActions = KeyboardActions(onDone = { if (name.isNotBlank()) onChoice("rename", name.trim()) }), modifier = Modifier.fillMaxWidth())
                else {
                    Button(onClick = { onChoice("keep-both", null) }, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.ink, contentColor = Tma.colors.surface)) { Text("Keep both") }
                    TextButton(onClick = { onChoice("replace", null) }, modifier = Modifier.fillMaxWidth()) { Text("Replace existing", color = Tma.colors.ink) }
                    TextButton(onClick = { renaming = true }, modifier = Modifier.fillMaxWidth()) { Text("Rename…", color = Tma.colors.ink) }
                }
            }
        },
        confirmButton = { if (renaming) Button(onClick = { if (name.isNotBlank()) onChoice("rename", name.trim()) }, colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.ink, contentColor = Tma.colors.surface)) { Text("Rename") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel", color = Tma.colors.ink) } },
    )
}
