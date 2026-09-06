package com.tmantoinelaw.portal.feature.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.core.ui.theme.Tokens

/** What the pill has to say; null = nothing, and the pill is not drawn (portal-sync-status.js, silent by design). */
data class SyncStatus(val label: String, val tone: String)

fun syncStatusFor(online: Boolean, replicaRunning: Boolean, replicaTaken: Int, waiting: Int, failed: Int, syncing: Boolean): SyncStatus? = when {
    syncing && waiting > 0 -> SyncStatus("Syncing…", "neutral")
    failed > 0 -> SyncStatus("$failed couldn’t be sent", "amber")
    !online -> SyncStatus("You’re offline", "offline")
    replicaRunning -> SyncStatus(if (replicaTaken > 0) "Syncing for offline, ${"%,d".format(replicaTaken)} records" else "Syncing for offline…", "neutral")
    waiting > 0 -> SyncStatus("$waiting waiting to send", "neutral")
    else -> null
}

@Composable
fun SyncPill(status: SyncStatus?, onClick: () -> Unit) {
    val s = status ?: return
    val dot = when (s.tone) { "amber" -> Tokens.Accent.orange; "offline" -> Tma.colors.inactive; else -> Tma.colors.inkSecondary }
    Row(
        Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.hover).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
        Text(s.label, style = Tma.type.text12, color = Tma.colors.ink, maxLines = 1)
    }
}
