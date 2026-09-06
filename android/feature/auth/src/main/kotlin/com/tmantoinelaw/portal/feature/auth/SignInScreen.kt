package com.tmantoinelaw.portal.feature.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tmantoinelaw.portal.core.ui.theme.Tma
import com.tmantoinelaw.portal.core.ui.theme.Tokens
import java.time.Year
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * The sign-in surface (resources/views/auth/login.blade.php, AUTH_DESIGN.md §1
 * screen 9): the lockup, "Sign in", the three provider buttons, and, once the
 * browser has the sign-in, the desktop's waiting copy (desktop/signin-waiting.html).
 */
@Composable
fun SignInScreen(
    pendingToken: MutableStateFlow<String?>,
    onSignedIn: () -> Unit,
    onFinishInBrowser: (String) -> Unit,
    viewModel: SignInViewModel = hiltViewModel(),
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val token by pendingToken.collectAsStateWithLifecycle()

    LaunchedEffect(token) {
        token?.let {
            pendingToken.value = null
            viewModel.onToken(it)
        }
    }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is SignInEvent.OpenBrowser -> context.openCustomTab(event.url)
                SignInEvent.SignedIn -> onSignedIn()
                is SignInEvent.FinishInBrowser -> onFinishInBrowser(event.url)
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Tma.colors.page)
            .safeDrawingPadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth()
                .padding(horizontal = Tma.space.s24, vertical = Tma.space.s32)
                .clip(RoundedCornerShape(Tokens.Popup.radiusCompact))
                .background(Tma.colors.card)
                .padding(Tma.space.s32),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Tma.space.s16),
        ) {
            Image(
                painter = painterResource(com.tmantoinelaw.portal.core.ui.R.drawable.logo_full),
                contentDescription = "TM ANTOINE Advisory",
                modifier = Modifier.width(180.dp),
            )
            when (val state = ui) {
                is SignInUi.Choose -> Choose(state, viewModel)
                is SignInUi.Waiting -> Waiting(state, viewModel)
                SignInUi.Claiming -> {
                    Spacer(Modifier.height(Tma.space.s8))
                    CircularProgressIndicator(color = Tma.colors.primary)
                    Text("Signing you in…", style = Tma.type.text14, color = Tma.colors.inkSecondary)
                }
            }
            Spacer(Modifier.height(Tma.space.s8))
            Text(
                text = "© ${Year.now().value} TM ANTOINE Advisory",
                style = Tma.type.text12,
                color = Tma.colors.inkSecondary,
            )
        }
    }
}

@Composable
private fun Choose(state: SignInUi.Choose, viewModel: SignInViewModel) {
    Text("Sign in", style = Tma.type.text24sb, color = Tma.colors.ink)
    state.error?.let {
        Text(
            text = it,
            style = Tma.type.text14,
            color = Tma.colors.danger,
            textAlign = TextAlign.Center,
        )
    }
    ProviderButton("Sign in with Google") { viewModel.start("google") }
    ProviderButton("Sign in with Microsoft") { viewModel.start("microsoft") }
    ProviderButton("Sign in with Email") { viewModel.start(null) }
}

@Composable
private fun Waiting(state: SignInUi.Waiting, viewModel: SignInViewModel) {
    val detail = when (state.provider) {
        "google" -> "Finish signing in with Google, then return here."
        "microsoft" -> "Finish signing in with Microsoft, then return here."
        else -> "Finish signing in, then return here."
    }
    Text("Continue in your browser", style = Tma.type.text24sb, color = Tma.colors.ink, textAlign = TextAlign.Center)
    Text(detail, style = Tma.type.text14, color = Tma.colors.inkSecondary, textAlign = TextAlign.Center)
    Button(
        onClick = { viewModel.reopen() },
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Tokens.Button.large.radius.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Tma.colors.ink, contentColor = Tma.colors.surface),
    ) { Text("Open in browser", style = Tma.type.text14sb) }
    TextButton(onClick = { viewModel.back() }) {
        Text("Back to sign in", style = Tma.type.text14sb, color = Tma.colors.ink)
    }
}

@Composable
private fun ProviderButton(label: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Tokens.Button.large.radius.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Tma.colors.ink),
    ) {
        Text(label, style = Tma.type.text14sb)
    }
}
