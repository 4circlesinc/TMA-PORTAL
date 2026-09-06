package com.tmantoinelaw.portal.feature.files.viewer

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import coil3.compose.AsyncImage
import com.tmantoinelaw.portal.core.common.time.TimeLabels
import com.tmantoinelaw.portal.core.data.files.CommentDto
import com.tmantoinelaw.portal.core.data.files.FileItemDto
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.components.SectionError
import com.tmantoinelaw.portal.core.ui.components.SkeletonFileRow
import com.tmantoinelaw.portal.core.ui.components.TmaIconButton
import com.tmantoinelaw.portal.core.ui.icons.PhosphorIcons
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.core.ui.theme.Tokens
import com.tmantoinelaw.portal.feature.files.FileGlyph
import com.tmantoinelaw.portal.feature.files.fmtDate
import com.tmantoinelaw.portal.feature.shell.PortalAvatar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The one file viewer (portal-files.js openLightbox, prompt §11.6): a head
 * with the file's tools, the stage by category (image, PDF pages rendered
 * on the device, video and audio, text, or the no-preview card), the foot,
 * and the comments and details panes, side by side on tablets and as
 * sheets on phones.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileViewerScreen(
    onClose: () -> Unit,
    onDownload: (String, String) -> Unit,
    onDelete: (FileItemDto) -> Unit,
    viewModel: ViewerViewModel = hiltViewModel(),
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(viewModel) { viewModel.toasts.collect { snackbar.showSnackbar(it) } }
    val f = ui.file

    Box(Modifier.fillMaxSize().background(Tma.colors.page)) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val wide = maxWidth >= 840.dp
            Column(Modifier.fillMaxSize()) {
                ViewerHead(ui, viewModel, onClose, onDownload, onDelete)
                Row(Modifier.weight(1f).fillMaxWidth()) {
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        when {
                            ui.error != null -> SectionError(onRetry = null, message = ui.error!!, modifier = Modifier.padding(Tma.space.s16))
                            f == null -> Column(Modifier.padding(Tma.space.s16)) { repeat(3) { SkeletonFileRow() } }
                            else -> Stage(ui, f, viewModel, onDownload)
                        }
                        f?.let { Foot(it, Modifier.align(Alignment.BottomCenter)) }
                    }
                    if (wide && ui.commentsOpen) Box(Modifier.width(320.dp).fillMaxHeight().background(Tma.colors.surface)) { CommentsPane(ui, viewModel) }
                    if (wide && ui.panel) Box(Modifier.width(340.dp).fillMaxHeight().background(Tma.colors.surface)) { SidePanel(ui, viewModel, onDownload) }
                }
            }
            if (!wide && ui.commentsOpen) ModalBottomSheet(onDismissRequest = { viewModel.toggleComments() }, containerColor = Tma.colors.surface) { Box(Modifier.fillMaxWidth().height(520.dp)) { CommentsPane(ui, viewModel) } }
            if (!wide && ui.panel) ModalBottomSheet(onDismissRequest = { viewModel.togglePanel() }, containerColor = Tma.colors.surface) { Box(Modifier.fillMaxWidth().height(560.dp)) { SidePanel(ui, viewModel, onDownload) } }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
}

/** The tools (portal-files.js toolbarHtml), gated by the file's permissions. */
@Composable
private fun ViewerHead(ui: ViewerUi, vm: ViewerViewModel, onClose: () -> Unit, onDownload: (String, String) -> Unit, onDelete: (FileItemDto) -> Unit) {
    val f = ui.file
    Row(Modifier.fillMaxWidth().background(Tma.colors.surface).statusBarsPadding().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        TmaIconButton(R.drawable.ic_arrow_left, "Close", onClose)
        Text(f?.name ?: "", style = Tma.type.text14sb, color = Tma.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (f != null) {
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                if (f.can("download")) TmaIconButton(R.drawable.ic_arrow_line_down_16, "Download", { vm.downloadUrl()?.let { (u, n) -> onDownload(u, n) } })
                Icon(painterResource(R.drawable.ic_star), contentDescription = if (f.favorite) "Remove from favourites" else "Add to favourites", tint = if (f.favorite) Tokens.Accent.yellow else Tma.colors.ink, modifier = Modifier.size(40.dp).padding(10.dp).clickable { vm.toggleFavorite() })
                if (f.can("delete")) TmaIconButton(R.drawable.ic_trash, "Delete", { onDelete(f) })
                TmaIconButton(R.drawable.ic_chat_circle, "Add a comment", { vm.toggleComments() }, tint = if (ui.commentsOpen) Tma.colors.primaryDark else Tma.colors.ink)
                TmaIconButton(R.drawable.ic_clock_counter_clockwise, "Version history", { vm.openTab(ViewerTab.Versions) }, tint = if (ui.panel && ui.tab == ViewerTab.Versions) Tma.colors.primaryDark else Tma.colors.ink)
                TmaIconButton(R.drawable.ic_info, "File details", { if (ui.panel && ui.tab == ViewerTab.Details) vm.togglePanel() else vm.openTab(ViewerTab.Details) }, tint = if (ui.panel) Tma.colors.primaryDark else Tma.colors.ink)
            }
        }
    }
}

@Composable
private fun Foot(f: FileItemDto, modifier: Modifier) {
    f.sizeLabel?.let { Text(it, style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = modifier.padding(8.dp)) }
}

@Composable
private fun Stage(ui: ViewerUi, f: FileItemDto, vm: ViewerViewModel, onDownload: (String, String) -> Unit) {
    when (val s = ui.stage) {
        Stage.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Loading…", style = Tma.type.text14, color = Tma.colors.inkSecondary) }
        is Stage.Image -> ZoomableImage(s.url, f.name)
        is Stage.Pdf -> PdfPages(s.file)
        is Stage.Media -> MediaStage(s.url, s.video, f, vm)
        is Stage.Text -> Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tma.space.s16)) { Text(s.text, style = Tma.type.text12.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace), color = Tma.colors.ink) }
        is Stage.Failed -> SectionError(onRetry = null, message = s.message, modifier = Modifier.padding(Tma.space.s16))
        Stage.NoPreview -> NoPreview(f, vm, onDownload)
    }
}

/** portal-files.js lightboxBody: "No in-browser preview for this file type." */
@Composable
private fun NoPreview(f: FileItemDto, vm: ViewerViewModel, onDownload: (String, String) -> Unit) {
    Column(Modifier.fillMaxSize().padding(Tma.space.s32), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        FileGlyph(f, 72.dp)
        Spacer(Modifier.height(Tma.space.s12))
        Text(f.name, style = Tma.type.text14sb, color = Tma.colors.ink, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Text("No preview for this file type.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
        if (f.can("download")) {
            Spacer(Modifier.height(Tma.space.s12))
            Button(onClick = { vm.downloadUrl()?.let { (u, n) -> onDownload(u, n) } }, colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.ink, contentColor = Tma.colors.surface)) { Text("Download") }
        }
    }
}

@Composable
private fun ZoomableImage(url: String, name: String) {
    var scale by remember { mutableStateOf(1f) }
    var offset by remember { mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }
    Box(Modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) {
        detectTransformGestures { _, pan, zoom, _ -> scale = (scale * zoom).coerceIn(1f, 6f); offset = if (scale > 1f) offset + pan else androidx.compose.ui.geometry.Offset.Zero }
    }, contentAlignment = Alignment.Center) {
        AsyncImage(model = url, contentDescription = name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y })
    }
}

/** PDF pages painted on the device with PdfRenderer, one bitmap per page at the viewport's width (never a WebView). */
@Composable
private fun PdfPages(file: File) {
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize().background(Tma.colors.hoverDeep)) {
        val widthPx = with(density) { maxWidth.roundToPx() }
        val renderer = remember(file) { runCatching { PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)) }.getOrNull() }
        DisposableEffect(renderer) { onDispose { runCatching { renderer?.close() } } }
        if (renderer == null) { SectionError(onRetry = null, message = "Could not load this PDF.", modifier = Modifier.padding(Tma.space.s16)); return@BoxWithConstraints }
        val count = renderer.pageCount
        var scale by remember { mutableStateOf(1f) }
        Column(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.weight(1f).fillMaxWidth().pointerInput(Unit) { detectTransformGestures { _, _, zoom, _ -> scale = (scale * zoom).coerceIn(1f, 3f) } }, verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(8.dp)) {
                items((0 until count).toList()) { index ->
                    var bitmap by remember(index, widthPx, scale) { mutableStateOf<Bitmap?>(null) }
                    LaunchedEffect(index, widthPx, scale) {
                        bitmap = withContext(Dispatchers.IO) {
                            runCatching {
                                synchronized(renderer) {
                                    renderer.openPage(index).use { page ->
                                        val w = (widthPx * scale).toInt().coerceAtLeast(1)
                                        val h = (w * page.height / page.width.toFloat()).toInt().coerceAtLeast(1)
                                        Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { b -> b.eraseColor(android.graphics.Color.WHITE); page.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
                                    }
                                }
                            }.getOrNull()
                        }
                    }
                    Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).background(Color.White)) {
                        bitmap?.let { Image(it.asImageBitmap(), contentDescription = "Page ${index + 1}", modifier = Modifier.width(with(density) { it.width.toDp() })) }
                            ?: Box(Modifier.fillMaxWidth().height(400.dp).background(Color.White))
                    }
                }
            }
            Row(Modifier.fillMaxWidth().background(Tma.colors.surface).padding(horizontal = Tma.space.s12, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TmaIconButton(R.drawable.ic_magnifying_glass_minus, "Zoom out", { scale = (scale - 0.25f).coerceAtLeast(1f) })
                Text(if (scale == 1f) "Fit" else "${(scale * 100).toInt()}%", style = Tma.type.text12, color = Tma.colors.ink)
                TmaIconButton(R.drawable.ic_magnifying_glass_plus, "Zoom in", { scale = (scale + 0.25f).coerceAtMost(3f) })
                Spacer(Modifier.weight(1f))
                Text("$count page${if (count == 1) "" else "s"}", style = Tma.type.text12, color = Tma.colors.inkSecondary)
            }
        }
    }
}

/** Video and audio through ExoPlayer with the session cookie; the preview URL 302s to a signed R2 URL (Vault.php). */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
private fun MediaStage(url: String, video: Boolean, f: FileItemDto, vm: ViewerViewModel) {
    val context = LocalContext.current
    val player = remember(url) {
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(vm.userAgent)
            .setAllowCrossProtocolRedirects(true)
            .setDefaultRequestProperties(mapOf("Cookie" to vm.cookieHeader(url), "Accept" to "*/*"))
        ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(http)).build().apply {
            setMediaItem(MediaItem.fromUri(url)); prepare(); playWhenReady = true
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    Column(Modifier.fillMaxSize().background(if (video) Color.Black else Tma.colors.page), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        if (!video) { FileGlyph(f, 64.dp); Spacer(Modifier.height(Tma.space.s16)) }
        AndroidView(factory = { ctx -> PlayerView(ctx).apply { this.player = player; useController = true } }, modifier = if (video) Modifier.fillMaxSize() else Modifier.fillMaxWidth().height(120.dp))
    }
}

/* ── side panel ───────────────────────────────────────────────────────── */

@Composable
private fun SidePanel(ui: ViewerUi, vm: ViewerViewModel, onDownload: (String, String) -> Unit) {
    val f = ui.file ?: return
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Tma.space.s12), horizontalArrangement = Arrangement.spacedBy(Tma.space.s16)) {
            ViewerTab.entries.forEach { tab ->
                val active = ui.tab == tab
                val count = when (tab) { ViewerTab.Versions -> ui.details?.counts?.get("versions"); else -> null }
                Column(Modifier.clickable { vm.openTab(tab) }) {
                    Text(tab.name + (count?.takeIf { it > 0 }?.let { " $it" } ?: ""), style = Tma.type.text14, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal, color = if (active) Tma.colors.ink else Tma.colors.inkSecondary, modifier = Modifier.padding(vertical = 10.dp))
                    Box(Modifier.height(2.dp).fillMaxWidth().background(if (active) Tma.colors.primary else Color.Transparent))
                }
            }
        }
        HorizontalDivider(color = Tma.colors.borderSoft)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tma.space.s16), verticalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
            ui.panelError?.let { Text(it, style = Tma.type.text14, color = Tma.colors.danger) }
            when (ui.tab) {
                ViewerTab.Details -> DetailsTab(ui, f)
                ViewerTab.Versions -> VersionsTab(ui, vm, onDownload)
                ViewerTab.Activity -> ActivityTab(ui, vm)
                ViewerTab.Access -> AccessTab(ui, vm)
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String?) {
    if (value.isNullOrBlank()) return
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(label, style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.width(110.dp))
        Text(value, style = Tma.type.text14, color = Tma.colors.ink)
    }
}

/** portal-files.js paintDetails: the file card, Location / Owner / Modified, then the server's groups. */
@Composable
private fun DetailsTab(ui: ViewerUi, f: FileItemDto) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
        FileGlyph(f, 36.dp)
        Column { Text(f.name, style = Tma.type.text14sb, color = Tma.colors.ink); Text(listOfNotNull(f.category?.replaceFirstChar { it.uppercase() }, f.sizeLabel).joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary) }
    }
    DetailRow("Location", f.folder?.name ?: "File Box")
    DetailRow("Owner", f.owner?.name)
    DetailRow("Modified", f.modifiedAt?.let { fmtDate(it) })
    val d = ui.details
    if (d == null) { SkeletonFileRow(); return }
    d.groups.forEach { g ->
        Text(g.title, style = Tma.type.text12, color = Tma.colors.inkSecondary, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = Tma.space.s8))
        g.rows.forEach { r -> DetailRow(r.label, r.value) }
    }
}

/** portal-files.js versionsHtml. */
@Composable
private fun VersionsTab(ui: ViewerUi, vm: ViewerViewModel, onDownload: (String, String) -> Unit) {
    val v = ui.versions
    if (v == null) { repeat(3) { SkeletonFileRow() }; return }
    if (v.versions.isEmpty()) { Text("No version history for this file.", style = Tma.type.text14, color = Tma.colors.inkSecondary); return }
    v.versions.forEach { ver ->
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(Tma.space.s12), verticalAlignment = Alignment.Top) {
            Box(Modifier.clip(RoundedCornerShape(Tma.radius.r8)).background(if (ver.isCurrent) Tma.colors.tint1 else Tma.colors.hover).padding(horizontal = 6.dp, vertical = 2.dp)) { Text("v${ver.number}", style = Tma.type.text12, color = Tma.colors.ink, fontWeight = FontWeight.SemiBold) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(ver.uploadedBy?.name ?: "Someone", style = Tma.type.text14sb, color = Tma.colors.ink)
                    Text(TimeLabels.clockOrDate(ver.uploadedAt), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                    if (ver.isCurrent) Flag("Current")
                    ver.restoredFrom?.let { Flag("restored from v$it") }
                    ver.approvalStatus?.let { Flag(it.replace(Regex("[_-]+"), " ").replaceFirstChar { c -> c.uppercase() }) }
                }
                ver.note?.let { Text(it, style = Tma.type.text14, color = Tma.colors.ink) }
                Text(listOfNotNull(ver.sizeLabel, ver.checksum).joinToString(" · "), style = Tma.type.text12, color = Tma.colors.inkSecondary)
                Row(horizontalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
                    if (!ver.isCurrent && ver.can.download) Text("Download", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable { onDownload(vm.versionUrl(ver.id, download = true), "${ui.file?.name ?: "file"} (v${ver.number})") })
                    if (ver.can.restore) Text("Restore", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable { vm.restoreVersion(ver.id) })
                }
            }
        }
    }
}

@Composable
private fun Flag(text: String) {
    Box(Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(Tma.colors.hover).padding(horizontal = 6.dp, vertical = 1.dp)) { Text(text, style = Tma.type.text12, color = Tma.colors.inkSecondary) }
}

/** portal-files.js activityHtml: bands, rows with "You"/name, "Show older activity". */
@Composable
private fun ActivityTab(ui: ViewerUi, vm: ViewerViewModel) {
    val a = ui.activity
    if (a == null) { LaunchedEffect(Unit) { vm.loadActivity() }; repeat(3) { SkeletonFileRow(avatar = true) }; return }
    if (a.filters.isNotEmpty()) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            a.filters.forEach { opt ->
                val on = opt.value == ui.activityFilter
                Box(Modifier.clip(RoundedCornerShape(Tma.radius.pill)).background(if (on) Tma.colors.ink else Tma.colors.hover).clickable { vm.setActivityFilter(opt.value) }.padding(horizontal = 10.dp, vertical = 4.dp)) { Text(opt.label, style = Tma.type.text12, color = if (on) Tma.colors.surface else Tma.colors.ink) }
            }
        }
    }
    if (a.entries.isEmpty()) { Text(if (ui.activityFilter == "all") "No activity recorded for this file yet." else "No activity of this kind yet.", style = Tma.type.text14, color = Tma.colors.inkSecondary); return }
    var band: String? = null
    a.entries.forEach { e ->
        if (e.group != band) { band = e.group; Text(e.group, style = Tma.type.text12, color = Tma.colors.inkSecondary, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp)) }
        val actor = e.actor
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(Tma.space.s12), verticalAlignment = Alignment.Top) {
            if (actor != null) PortalAvatar(url = vm.absolute(actor.avatar), name = actor.name, size = 28.dp)
            else Box(Modifier.size(28.dp).clip(RoundedCornerShape(14.dp)).background(Tma.colors.hover), contentAlignment = Alignment.Center) { Icon(painterResource(PhosphorIcons.resolveOr(e.icon, R.drawable.ic_clock_counter_clockwise)), contentDescription = null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(14.dp)) }
            Column {
                Text(buildString { append(if (actor?.isSelf == true) "You" else actor?.name ?: "Someone"); append(" "); append(e.text) }, style = Tma.type.text14, color = Tma.colors.ink)
                Text(TimeLabels.clockOrDate(e.at), style = Tma.type.text12, color = Tma.colors.inkSecondary)
            }
        }
    }
    if (a.nextCursor != null) TextButton(onClick = { vm.loadActivity(append = true) }) { Text("Show older activity", style = Tma.type.text14sb, color = Tma.colors.ink) }
}

@Composable
private fun AccessTab(ui: ViewerUi, vm: ViewerViewModel) {
    val a = ui.access
    if (a == null) { repeat(3) { SkeletonFileRow(avatar = true) }; return }
    if (a.sources.isEmpty()) { Text("Only you can see this file.", style = Tma.type.text14, color = Tma.colors.inkSecondary); return }
    a.sources.forEach { src ->
        Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(painterResource(PhosphorIcons.resolveOr(src.icon, R.drawable.ic_users_three)), contentDescription = null, tint = Tma.colors.inkSecondary, modifier = Modifier.size(16.dp))
                Text(src.label, style = Tma.type.text14sb, color = Tma.colors.ink, modifier = Modifier.weight(1f))
                src.role?.let { Text(it.replaceFirstChar { c -> c.uppercase() }, style = Tma.type.text12, color = Tma.colors.inkSecondary) }
            }
            src.detail?.let { Text(it, style = Tma.type.text12, color = Tma.colors.inkSecondary) }
            src.members.forEach { m ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(start = 24.dp)) {
                    PortalAvatar(url = vm.absolute(m.avatar), name = m.name ?: m.email, size = 22.dp)
                    Text(m.name ?: m.email ?: "", style = Tma.type.text14, color = Tma.colors.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    (m.label ?: m.role)?.let { Text(it, style = Tma.type.text12, color = Tma.colors.inkSecondary) }
                }
            }
            if (src.truncated) Text("and ${src.total - src.members.size} more", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.padding(start = 24.dp))
        }
    }
}

/* ── comments ─────────────────────────────────────────────────────────── */

@Composable
private fun CommentsPane(ui: ViewerUi, vm: ViewerViewModel) {
    val c = ui.comments
    var draft by remember { mutableStateOf("") }
    var replyTo by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<CommentDto?>(null) }
    Column(Modifier.fillMaxSize()) {
        Text("Comments" + (c?.openCount?.takeIf { it > 0 }?.let { " · $it open" } ?: ""), style = Tma.type.text14sb, color = Tma.colors.ink, modifier = Modifier.padding(Tma.space.s16))
        HorizontalDivider(color = Tma.colors.borderSoft)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(Tma.space.s12), verticalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
            when {
                c == null -> repeat(2) { SkeletonFileRow(avatar = true) }
                c.threads.isEmpty() -> Text("No comments yet.", style = Tma.type.text14, color = Tma.colors.inkSecondary)
                else -> c.threads.forEach { t ->
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r12)).background(if (t.resolved) Tma.colors.hover else Color.Transparent).padding(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        CommentRow(t, vm, root = true, onReply = { replyTo = t.id }, onEdit = { editing = t; draft = t.body.orEmpty() })
                        t.replies.forEach { r -> Box(Modifier.padding(start = 24.dp)) { CommentRow(r, vm, root = false, onReply = null, onEdit = { editing = r; draft = r.body.orEmpty() }) } }
                    }
                }
            }
        }
        if (c?.canComment == true) {
            HorizontalDivider(color = Tma.colors.borderSoft)
            Column(Modifier.padding(Tma.space.s12), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                replyTo?.let { Row { Text("Replying", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.weight(1f)); Text("Cancel", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable { replyTo = null }) } }
                editing?.let { Row { Text("Editing", style = Tma.type.text12, color = Tma.colors.inkSecondary, modifier = Modifier.weight(1f)); Text("Cancel", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable { editing = null; draft = "" }) } }
                Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tma.radius.r12)).background(Tma.colors.input).padding(10.dp)) {
                    if (draft.isEmpty()) Text(if (replyTo != null) "Reply…" else "Add a comment", style = Tma.type.text14, color = Tma.colors.placeholder)
                    BasicTextField(value = draft, onValueChange = { if (it.length <= 4000) draft = it }, textStyle = Tma.type.text14.copy(color = Tma.colors.ink), cursorBrush = SolidColor(Tma.colors.primary), maxLines = 6)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Button(onClick = {
                        val text = draft.trim(); if (text.isEmpty()) return@Button
                        val e = editing
                        if (e != null) vm.editComment(e.id, text) else vm.postComment(text, replyTo)
                        draft = ""; replyTo = null; editing = null
                    }, colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.ink, contentColor = Tma.colors.surface)) { Text(if (editing != null) "Save" else "Post") }
                }
            }
        }
    }
}

/** portal-files.js commentHtml: author (You), edited/Resolved flags, time, body, and the row's actions. */
@Composable
private fun CommentRow(c: CommentDto, vm: ViewerViewModel, root: Boolean, onReply: (() -> Unit)?, onEdit: () -> Unit) {
    if (c.deleted) { Text("This comment was deleted.", style = Tma.type.text14.copy(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic), color = Tma.colors.inkSecondary); return }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        PortalAvatar(url = vm.absolute(c.author?.avatar), name = c.author?.name, size = 24.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (c.author?.isSelf == true) "You" else c.author?.name ?: "Someone", style = Tma.type.text14sb, color = Tma.colors.ink)
                if (c.editedAt != null) Flag("edited")
                if (c.resolved) Flag("Resolved")
                Spacer(Modifier.weight(1f))
                Text(TimeLabels.clockOrDate(c.createdAt), style = Tma.type.text12, color = Tma.colors.inkSecondary)
            }
            Text(c.body.orEmpty(), style = Tma.type.text14, color = Tma.colors.ink)
            Row(horizontalArrangement = Arrangement.spacedBy(Tma.space.s12)) {
                if (root && c.can.reply && onReply != null) Text("Reply", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable(onClick = onReply))
                if (root && c.can.resolve) Text(if (c.resolved) "Reopen" else "Mark as resolved", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable { vm.resolve(c) })
                if (c.can.edit) Text("Edit", style = Tma.type.text12, color = Tma.colors.link, modifier = Modifier.clickable(onClick = onEdit))
                if (c.can.delete) Text("Delete", style = Tma.type.text12, color = Tma.colors.danger, modifier = Modifier.clickable { vm.deleteComment(c.id) })
            }
        }
    }
}
