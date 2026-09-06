package com.tmantoinelaw.portal.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import com.tmantoinelaw.portal.core.ui.theme.Tma

/** The section-error card (public/js/section-error.js:21-26). Never a full-screen error for one panel. */
@Composable
fun SectionError(
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
    title: String = "Unable to load this section",
    message: String = "There was a problem loading this section.",
) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Tma.radius.r16))
            .background(Tma.colors.card)
            .padding(Tma.space.s24),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Tma.space.s8),
    ) {
        Text(title, style = Tma.type.text14sb, color = Tma.colors.ink, textAlign = TextAlign.Center)
        Text(message, style = Tma.type.text14, color = Tma.colors.inkSecondary, textAlign = TextAlign.Center)
        if (onRetry != null) {
            OutlinedButton(onClick = onRetry, shape = RoundedCornerShape(Tma.radius.r14)) {
                Text("Try again", style = Tma.type.text14sb, color = Tma.colors.ink)
            }
        }
    }
}

/**
 * The offline notice, deliberately not an error (docs/offline-plan.md phase 4):
 * no URL, no code, no red, one sentence, and the app retries on its own.
 */
@Composable
fun OfflineNotice(modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(Tma.space.s32),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "The portal will come back on its own as soon as you have a connection.",
            style = Tma.type.text14,
            color = Tma.colors.inkSecondary,
            textAlign = TextAlign.Center,
        )
    }
}
