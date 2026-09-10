package com.tmantoinelaw.portal

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import com.tmantoinelaw.portal.core.ui.R
import com.tmantoinelaw.portal.core.ui.theme.TmaTheme
import com.tmantoinelaw.portal.core.ui.theme.Tokens
import com.tmantoinelaw.portal.web.CallNotifications
import com.tmantoinelaw.portal.web.CallSession
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/**
 * The lock-screen / background incoming call: slide to answer, slide to
 * decline, the same gestures a normal phone call uses. Accept and decline
 * still land on `TMAMessagingCalls` in the WebView.
 */
class CallActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockscreen()
        enableEdgeToEdge()
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        render(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        render(intent)
    }

    private fun render(intent: Intent) {
        val info = CallNotifications.Info(
            name = intent.getStringExtra(EXTRA_NAME)?.ifBlank { null }
                ?: CallNotifications.Info.parse(CallSession.infoJson).name,
            media = intent.getStringExtra(EXTRA_MEDIA)?.ifBlank { null }
                ?: CallNotifications.Info.parse(CallSession.infoJson).media,
        )
        setContent {
            TmaTheme {
                var ringing by remember { mutableStateOf(true) }
                DisposableEffect(Unit) {
                    val watch: (String) -> Unit = { phase ->
                        when (phase) {
                            // Video lives in the WebView once answered; this
                            // screen is only the lock-screen ring / decline.
                            "active", "" -> finish()
                        }
                    }
                    CallSession.watch(watch)
                    onDispose { CallSession.unwatch(watch) }
                }
                LaunchedEffect(Unit) {
                    delay(40_000)
                    handOff(CallNotifications.ACTION_DECLINE)
                    finish()
                }
                CallScreen(
                    info = info,
                    ringing = ringing,
                    onAnswer = { handOff(CallNotifications.ACTION_ANSWER); finish() },
                    onDecline = { handOff(CallNotifications.ACTION_DECLINE); finish() },
                    onHangup = { handOff(CallNotifications.ACTION_HANGUP); finish() },
                )
            }
        }
    }

    private fun handOff(action: String) {
        startActivity(
            Intent(this, MainActivity::class.java)
                .setAction(action)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private fun showOverLockscreen() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    companion object {
        const val EXTRA_NAME = "tma.call.name"
        const val EXTRA_MEDIA = "tma.call.media"
    }
}

@Composable
private fun CallScreen(
    info: CallNotifications.Info,
    ringing: Boolean,
    onAnswer: () -> Unit,
    onDecline: () -> Unit,
    onHangup: () -> Unit,
) {
    val pulse = remember { Animatable(0.35f) }
    LaunchedEffect(ringing) {
        if (!ringing) {
            pulse.snapTo(0.35f)
            return@LaunchedEffect
        }
        pulse.animateTo(1f, infiniteRepeatable(tween(1100, easing = LinearEasing), RepeatMode.Reverse))
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    0f to Color(0xFF0C4767),
                    0.55f to Color(0xFF083044),
                    1f to Color(0xFF062536),
                ),
            )
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 28.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("TMA", color = Color.White.copy(alpha = 0.45f), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp)
        Spacer(Modifier.weight(1f))
        Box(contentAlignment = Alignment.Center) {
            if (ringing) {
                Box(
                    Modifier
                        .size(188.dp)
                        .alpha(1f - pulse.value)
                        .clip(CircleShape)
                        .background(Tokens.Brand.primary.copy(alpha = 0.22f)),
                )
            }
            Image(
                painter = painterResource(R.drawable.logo_mark),
                contentDescription = null,
                modifier = Modifier.size(128.dp).clip(CircleShape),
            )
        }
        Spacer(Modifier.height(28.dp))
        Text(info.name, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            if (!ringing) "Slide to end"
            else if (info.media == "video") "Incoming video call"
            else "Incoming call",
            color = Color.White.copy(alpha = 0.62f),
            fontSize = 16.sp,
        )
        Spacer(Modifier.weight(1f))
        if (ringing) {
            SlideTrack(
                label = "Slide to answer",
                color = Color(0xFF12B76A),
                icon = R.drawable.ic_phone,
                onComplete = onAnswer,
            )
            Spacer(Modifier.height(16.dp))
            SlideTrack(
                label = "Slide to decline",
                color = Color(0xFFF04438),
                icon = R.drawable.ic_phone_x,
                onComplete = onDecline,
            )
        } else {
            SlideTrack(
                label = "Slide to end",
                color = Color(0xFFF04438),
                icon = R.drawable.ic_phone_x,
                onComplete = onHangup,
            )
        }
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun SlideTrack(
    label: String,
    color: Color,
    icon: Int,
    onComplete: () -> Unit,
) {
    val density = LocalDensity.current
    var trackWidth by remember { mutableFloatStateOf(0f) }
    val thumb = with(density) { 56.dp.toPx() }
    val max = (trackWidth - thumb - with(density) { 8.dp.toPx() * 2 }).coerceAtLeast(0f)
    var offset by remember { mutableFloatStateOf(0f) }
    val complete by rememberUpdatedState(onComplete)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(72.dp)
            .clip(RoundedCornerShape(36.dp))
            .background(color.copy(alpha = 0.22f))
            .onSizeChanged { trackWidth = it.width.toFloat() }
            .padding(4.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            label,
            color = Color.White.copy(alpha = (1f - offset / (max.takeIf { it > 0f } ?: 1f) * 1.4f).coerceIn(0.15f, 0.85f)),
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
            modifier = Modifier.align(Alignment.Center),
        )
        Box(
            modifier = Modifier
                .offset { IntOffset(offset.roundToInt(), 0) }
                .size(56.dp)
                .clip(CircleShape)
                .background(color)
                .pointerInput(max) {
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            if (max > 0f && offset / max >= 0.72f) complete()
                            else offset = 0f
                        },
                        onDragCancel = { offset = 0f },
                        onHorizontalDrag = { change, drag ->
                            change.consume()
                            offset = (offset + drag).coerceIn(0f, max)
                        },
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(icon),
                contentDescription = label,
                tint = Color.White,
                modifier = Modifier.size(26.dp),
            )
        }
    }
}
