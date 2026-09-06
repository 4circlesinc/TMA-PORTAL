package com.tmantoinelaw.portal.feature.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.tmantoinelaw.portal.core.ui.theme.Tma

/** Holds a route while its module is not built yet. Title only: no invented UI. */
@Composable
fun ModulePlaceholder(title: String) {
    Box(Modifier.fillMaxSize().padding(Tma.space.s24), contentAlignment = Alignment.TopStart) {
        Text(title, style = Tma.type.text24sb, color = Tma.colors.ink)
    }
}
