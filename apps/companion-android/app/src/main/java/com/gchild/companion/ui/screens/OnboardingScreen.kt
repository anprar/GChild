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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun OnboardingScreen(onContinue: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Text("GChild Companion", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))
        Text(
            "Aplikasi ini terlihat di launcher dan pengaturan perangkat. " +
                "Tidak ada ikon tersembunyi dan tidak ada penyamaran.",
            style = MaterialTheme.typography.bodyMedium,
        )

        Spacer(Modifier.height(20.dp))
        Text("Yang dikirim ke server", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Bullet("Baterai, status mengisi daya, koneksi internet, layar menyala, dan keyguard terkunci.")
        Bullet("Waktu observasi perangkat dan waktu server menerima laporan.")
        Bullet("Status perintah dari orang tua: menunggu, diterima, sedang dijalankan, berhasil, gagal, atau kedaluwarsa.")

        Spacer(Modifier.height(20.dp))
        Text("Yang tidak diambil", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Bullet("Lokasi, chat, OTP, notifikasi, kontak, SMS, kamera, mikrofon, atau riwayat browsing.")
        Bullet("Isi layar dan password/PIN perangkat.")

        Spacer(Modifier.height(20.dp))
        Text("Batasan versi ini", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Kunci layar dari jauh belum diimplementasikan (Device Admin masuk tahap berikutnya). " +
                "Perintah kunci akan dilaporkan gagal, bukan diklaim berhasil. Tanpa push notification, " +
                "perintah hanya diambil saat aplikasi ini aktif.",
            style = MaterialTheme.typography.bodyMedium,
        )

        Spacer(Modifier.height(24.dp))
        Button(onClick = onContinue, modifier = Modifier.fillMaxWidth()) {
            Text("Mulai pairing")
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "Pairing butuh kode dari orang tua dan persetujuan di perangkat ini. " +
                "Orang tua harus menyetujui lagi dengan kode verifikasi.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun Bullet(text: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text("• ", style = MaterialTheme.typography.bodyMedium)
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}
