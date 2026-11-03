package com.gchild.companion.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.gchild.companion.GChildApp
import com.gchild.companion.ui.screens.ConsentScreen
import com.gchild.companion.ui.screens.HomeScreen
import com.gchild.companion.ui.screens.OnboardingScreen
import com.gchild.companion.ui.screens.PairingScreen
import com.gchild.companion.ui.theme.GChildTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            GChildTheme {
                CompanionRoot()
            }
        }
    }
}

@Composable
private fun CompanionRoot() {
    val application = LocalContext.current.applicationContext as GChildApp
    val viewModel: CompanionViewModel = viewModel(
        factory = CompanionViewModel.factory(application.container.repository),
    )
    val state by viewModel.state.collectAsStateWithLifecycle()

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (val current = state) {
            CompanionUiState.Loading -> CenteredMessage("Memuat…")

            CompanionUiState.Onboarding -> OnboardingScreen(onContinue = viewModel::startPairing)

            is CompanionUiState.Pairing -> PairingScreen(
                state = current,
                onPair = viewModel::pair,
            )

            is CompanionUiState.Consent -> ConsentScreen(
                state = current,
                onAccept = viewModel::confirmLocal,
                onReject = viewModel::denyPairing,
                onCheckApproval = viewModel::checkApproval,
            )

            is CompanionUiState.Ready -> HomeScreen(
                state = current,
                onRefreshStatus = viewModel::refreshStatus,
                onCheckCommands = viewModel::checkCommands,
                onForgetDevice = viewModel::forgetDevice,
            )
        }
    }
}

@Composable
private fun CenteredMessage(text: String) {
    Box(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = text, style = MaterialTheme.typography.bodyLarge)
    }
}
