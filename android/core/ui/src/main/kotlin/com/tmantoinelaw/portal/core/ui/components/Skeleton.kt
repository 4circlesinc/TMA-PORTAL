package com.tmantoinelaw.portal.core.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.ui.motion.rememberReducedMotion
import com.tmantoinelaw.portal.core.ui.theme.Tma

/** One shimmering placeholder block, the web's `.tma-skeleton`. */
@Composable
fun SkeletonBlock(modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(6.dp)) {
    val reduced = rememberReducedMotion()
    val transition = rememberInfiniteTransition(label = "skeleton")
    val pulse by transition.animateFloat(
        initialValue = 0.55f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse), label = "pulse",
    )
    val alpha = if (reduced) 0.8f else pulse
    Box(modifier.clip(shape).background(Tma.colors.hoverDeep.copy(alpha = Tma.colors.hoverDeep.alpha * alpha)))
}

@Composable
fun SkeletonLine(width: Dp, height: Dp = 12.dp, modifier: Modifier = Modifier) =
    SkeletonBlock(modifier.width(width).height(height))

@Composable
fun SkeletonLineFraction(fraction: Float, height: Dp = 12.dp, modifier: Modifier = Modifier) =
    SkeletonBlock(modifier.fillMaxWidth(fraction).height(height))

@Composable
fun SkeletonCircle(size: Dp, modifier: Modifier = Modifier) = SkeletonBlock(modifier.size(size), CircleShape)

/** A file row placeholder: icon square + two lines (resources/views/pages/dashboard.html:328). */
@Composable
fun SkeletonFileRow(avatar: Boolean = false, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (avatar) SkeletonCircle(32.dp) else SkeletonBlock(Modifier.size(28.dp), RoundedCornerShape(8.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SkeletonLineFraction(0.58f)
            SkeletonLineFraction(0.34f)
        }
    }
}

/**
 * The first-paint skeleton the shell ships for the dashboard
 * (resources/views/pages/dashboard.html:304-338): greeting, four KPI cards,
 * three one-third panels of file rows, and a generic section of avatar rows.
 * Shown only when no snapshot exists; a warm boot paints real rows instead.
 */
@Composable
fun BootSkeleton(columns: Int = 3, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .semantics { contentDescription = "Loading" }
            .padding(Tma.space.s20),
        verticalArrangement = Arrangement.spacedBy(Tma.space.s20),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            SkeletonCircle(36.dp)
            SkeletonLine(150.dp, 16.dp)
        }
        val kpiPerRow = if (columns >= 3) 4 else 2
        repeat(4 / kpiPerRow) { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Tma.space.s16)) {
                repeat(kpiPerRow) { i ->
                    val purple = (row * kpiPerRow + i) % 2 == 1
                    Column(
                        Modifier.weight(1f).clip(RoundedCornerShape(Tma.radius.r16))
                            .background(if (purple) Tma.colors.dashCard2 else Tma.colors.dashCard1).padding(Tma.space.s16),
                        verticalArrangement = Arrangement.spacedBy(Tma.space.s12),
                    ) {
                        SkeletonLineFraction(0.55f)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                            SkeletonLine(72.dp, 28.dp)
                            SkeletonLine(40.dp, 14.dp)
                        }
                    }
                }
            }
        }
        val panels = 3
        val perRow = columns.coerceIn(1, 3)
        var drawn = 0
        while (drawn < panels) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tma.space.s16)) {
                repeat(perRow) {
                    if (drawn < panels) {
                        Column(
                            Modifier.weight(1f).clip(RoundedCornerShape(Tma.radius.r16)).background(Tma.colors.panel).padding(Tma.space.s16),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            SkeletonLineFraction(0.4f, 14.dp)
                            repeat(3) { SkeletonFileRow() }
                        }
                        drawn++
                    } else Box(Modifier.weight(1f))
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            SkeletonLine(220.dp, 14.dp)
            repeat(5) { SkeletonFileRow(avatar = true) }
        }
    }
}
