package com.tmantoinelaw.portal.core.ui.splash

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.motion.rememberReducedMotion
import com.tmantoinelaw.portal.core.ui.theme.Tokens

/**
 * The loading layer, pixel for pixel the desktop's (desktop/splash.html):
 * `--color-primary-dark` surface, the brand lockup knocked out to white rising
 * over 420 ms, a 180×4 track carrying an indeterminate full-width sweep on a
 * 1.3 s loop, and a 240 ms fade once the screen underneath has painted. It is
 * a layer over the app, never a page inside it: nothing half-built is on
 * screen while it is up.
 */
@Composable
fun BootSplash(visible: Boolean, modifier: Modifier = Modifier) {
    AnimatedVisibility(
        visible = visible,
        enter = EnterTransition.None,
        exit = fadeOut(animationSpec = tween(durationMillis = 240)),
        modifier = modifier,
    ) {
        val reduced = rememberReducedMotion()
        val rise = remember { Animatable(0f) }
        LaunchedEffect(Unit) {
            if (reduced) rise.snapTo(1f)
            else rise.animateTo(1f, tween(420, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
        }
        Box(
            modifier = Modifier.fillMaxSize().background(Tokens.Brand.primaryDark),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(30.dp),
                modifier = Modifier.padding(horizontal = 56.dp),
            ) {
                Image(
                    painter = painterResource(R.drawable.logo_full),
                    contentDescription = "TM ANTOINE Advisory",
                    colorFilter = ColorFilter.tint(Color.White),
                    modifier = Modifier
                        .width(220.dp)
                        .graphicsLayer {
                            alpha = rise.value
                            translationY = (1f - rise.value) * 6.dp.toPx()
                        },
                )
                LoadingTrack(reduced = reduced)
            }
        }
    }
}

@Composable
private fun LoadingTrack(reduced: Boolean) {
    val transition = rememberInfiniteTransition(label = "splash-sweep")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart),
        label = "phase",
    )
    Canvas(
        modifier = Modifier
            .width(180.dp)
            .height(4.dp)
            .clip(RoundedCornerShape(999.dp)),
    ) {
        drawRect(Color.White.copy(alpha = 0.22f))
        if (reduced) {
            drawRect(Color.White)
        } else {
            // background-size 220% swept from background-position 220% to -220%: the
            // gradient's left edge travels from -2.64w to +2.64w each cycle.
            val w = size.width
            val gradientWidth = w * 2.2f
            val left = -2.64f * w + phase * 5.28f * w
            drawRect(
                brush = Brush.horizontalGradient(
                    colorStops = arrayOf(
                        0f to Color.White.copy(alpha = 0.35f),
                        0.25f to Color.White.copy(alpha = 0.35f),
                        0.5f to Color.White,
                        0.75f to Color.White.copy(alpha = 0.35f),
                        1f to Color.White.copy(alpha = 0.35f),
                    ),
                    startX = left,
                    endX = left + gradientWidth,
                    tileMode = TileMode.Clamp,
                ),
            )
        }
    }
}
