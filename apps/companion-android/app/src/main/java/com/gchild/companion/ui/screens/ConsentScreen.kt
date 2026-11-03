package com.gchild.companion.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.gchild.companion.ui.CompanionUiState

@Composable
fun ConsentScreen(
    state: CompanionUiState.Consent,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    onCheckApproval: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Text("Persetujuan di perangkat ini", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))
        Text("Perangkat: ${state.deviceLabel}", style = MaterialTheme.typography.bodyMedium)

        Spacer(Modifier.height(20.dp))
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Kode verifikasi", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text(
                    state.verificationCode.ifEmpty { "-" },
                    style = MaterialTheme.typography.displaySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Cocokkan kode ini dengan yang tampil di bot Telegram orang tua. " +
                        "Jika berbeda, jangan setujui.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        Spacer(Modifier.height(20.dp))
        Text("Dengan menyetujui, perangkat ini akan:", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "mengirim status baterai, jaringan, layar, dan keyguard; menerima perintah status " +
                "dan kunci layar; menampilkan hasil perintah di aplikasi ini. Orang tua dapat " +
                "mencabut akses kapan saja.",
            style = MaterialTheme.typography.bodyMedium,
        )

        Spacer(Modifier.height(20.dp))
        state.message?.let { message ->
            Text(message, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(12.dp))
        }

        Button(
            onClick = onAccept,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Setujui pairing di perangkat ini")
        }

        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = onReject,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Tolak")
        }

        Spacer(Modifier.height(8.dp))
        TextButton(
            onClick = onCheckApproval,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Cek persetujuan orang tua")
        }
    }
}
