package com.gchild.companion.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.gchild.companion.ui.CompanionUiState

@Composable
fun HomeScreen(
    state: CompanionUiState.Ready,
    onRefreshStatus: () -> Unit,
    onCheckCommands: () -> Unit,
    onForgetDevice: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Text("GChild Companion", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text(
            "Perangkat: ${state.deviceLabel ?: "tanpa nama"}",
            style = MaterialTheme.typography.bodyMedium,
        )

        if (!state.serverConfigured) {
            Spacer(Modifier.height(12.dp))
            Text(
                "Server belum dikonfigurasi pada build ini. Status tidak dapat dikirim.",
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
        }

        Spacer(Modifier.height(16.dp))
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Status terakhir", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                val snapshot = state.snapshot
                if (snapshot == null) {
                    Text(
                        "Belum ada laporan status dari perangkat ini pada sesi sekarang.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                } else {
                    StatusRow("Baterai", snapshot.batteryLevel?.let { "$it%" } ?: "tidak diketahui")
                    StatusRow("Mengisi daya", yesNo(snapshot.charging))
                    StatusRow("Jaringan tersambung", yesNo(snapshot.networkConnected))
                    StatusRow("Server terjangkau", yesNo(snapshot.backendReachable))
                    StatusRow("Layar menyala", yesNo(snapshot.screenInteractive))
                    StatusRow("Keyguard terkunci", yesNo(snapshot.keyguardLocked))
                    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                    StatusRow("Waktu observasi", snapshot.observedAt)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "Snapshot, bukan pemantauan realtime. Tanpa push notification, perintah hanya " +
                        "diambil saat aplikasi aktif.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        state.message?.let { message ->
            Text(message, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(12.dp))
        }

        Button(
            onClick = onRefreshStatus,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.busy) "Memproses…" else "Kirim status sekarang")
        }

        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = onCheckCommands,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Periksa perintah dari orang tua")
        }

        Spacer(Modifier.height(16.dp))
        Text(
            "Kontrol dilakukan dari bot Telegram orang tua. Command kunci layar akan dilaporkan " +
                "gagal sampai Device Admin diimplementasikan.",
            style = MaterialTheme.typography.bodySmall,
        )

        Spacer(Modifier.height(16.dp))
        TextButton(
            onClick = onForgetDevice,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Lupakan perangkat ini (hapus credential lokal)")
        }
    }
}

@Composable
private fun StatusRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun yesNo(value: Boolean?): String = when (value) {
    null -> "tidak diketahui"
    true -> "ya"
    false -> "tidak"
}
