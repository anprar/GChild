package com.gchild.companion.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.gchild.companion.ui.CompanionUiState

@Composable
fun PairingScreen(
    state: CompanionUiState.Pairing,
    onPair: (String, String) -> Unit,
) {
    var code by rememberSaveable { mutableStateOf("") }
    var label by rememberSaveable { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Text("Pairing perangkat", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))
        Text(
            "Masukkan kode 8 digit dari bot Telegram orang tua. Kode berlaku 10 menit.",
            style = MaterialTheme.typography.bodyMedium,
        )

        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = code,
            onValueChange = { input ->
                if (input.length <= 8 && input.all(Char::isDigit)) code = input
            },
            label = { Text("Kode pairing") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = label,
            onValueChange = { if (it.length <= 60) label = it },
            label = { Text("Nama perangkat (mis. HP Budi)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(20.dp))
        state.error?.let { message ->
            Text(message, color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(12.dp))
        }

        Button(
            onClick = { onPair(code, label) },
            enabled = !state.busy && code.length == 8,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.busy) "Mengirim…" else "Kirim kode")
        }

        if (state.busy) {
            Spacer(Modifier.height(16.dp))
            CircularProgressIndicator()
        }

        Spacer(Modifier.height(20.dp))
        Text(
            "Data yang dikirim: baterai, pengisian daya, jaringan, layar, keyguard, dan hasil " +
                "perintah. Tidak ada lokasi, chat, OTP, notifikasi, kontak, SMS, kamera, atau mikrofon.",
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Setelah kode dikirim, perangkat ini masih harus menyetujui di layar berikutnya dan " +
                "orang tua menyetujui dengan kode verifikasi. Kode pairing saja tidak cukup.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
