package com.tmantoinelaw.portal.feature.shell

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import coil3.compose.SubcomposeAsyncImage
import com.tmantoinelaw.portal.core.ui.components.InitialsAvatar

/**
 * A person's photo, or their initials when there is none (memory: real uploads
 * and provider photos only, initials fallback). `url` may be relative to the
 * portal origin; the caller resolves it.
 */
@Composable
fun PortalAvatar(url: String?, name: String?, size: Dp, modifier: Modifier = Modifier) {
    if (url.isNullOrBlank()) {
        InitialsAvatar(name = name, size = size, modifier = modifier)
        return
    }
    SubcomposeAsyncImage(
        model = url,
        contentDescription = name,
        contentScale = ContentScale.Crop,
        modifier = modifier.size(size).clip(CircleShape),
        loading = { InitialsAvatar(name = name, size = size) },
        error = { InitialsAvatar(name = name, size = size) },
    )
}
