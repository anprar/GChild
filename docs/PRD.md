# PRD — GChild

Status: Tahap 0, rancangan. Bukan implementasi yang sudah diuji.
Tanggal: 2026-11-02.

> Pembaruan 2026-11-03: kanal Parent kini **bot Telegram**, bukan APK Parent
> (docs/DECISIONS.md ADR-001). Bagian yang menyebut login Parent APK atau
> "Telegram Tahap 5" adalah rencana lama yang sudah digantikan. Batas produk,
> pairing dua arah, dan larangan pengawasan tidak berubah.
Bahasa UI/dokumen: Indonesia. Identifier kode: Inggris.

## 1. Ringkasan

GChild membantu orang tua mengelola perangkat anak secara **transparan** pada
perangkat keluarga yang sah dikelola. Produk terdiri dari dua aplikasi Android dan
satu backend:

- **GChild Parent**: login, pairing, melihat status, mengirim command, melihat hasil.
- **GChild Companion**: penjelasan data, persetujuan lokal, izin, status, riwayat,
  eksekusi command, dan pemulihan/pemutusan pairing.
- **gchild-server**: autentikasi, relasi keluarga-perangkat, antrean command, status,
  policy revision, dan audit.

Tagline: **Guide. Protect. Connect.**

## 2. Masalah dan alasan

Orang tua membutuhkan cara yang jelas dan dapat dipertanggungjawabkan untuk mengetahui
kondisi perangkat anak (baterai, jaringan, layar) dan melakukan tindakan terbatas
(misalnya mengunci layar). Banyak aplikasi sejenis menjanjikan kontrol instan atau
pengawasan tersembunyi yang tidak sesuai dengan batas Android, kebijakan toko aplikasi,
dan privasi anak.

GChild mengambil posisi berbeda:

- Perangkat harus diketahui dan disetujui pengguna perangkat.
- Data yang dikirim minimal dan dapat dijelaskan.
- Hasil command adalah hasil yang dilaporkan Companion, bukan asumsi Parent.
- Keterbatasan Android ditampilkan, bukan disembunyikan.

## 3. Pengguna dan peran

| Peran | Kebutuhan utama | Catatan |
|---|---|---|
| Parent/guardian | Melihat status, mengirim command, melihat hasil, mencabut akses | Satu akun dapat mengelola satu atau lebih perangkat keluarga. |
| Device user (anak) | Tahu aplikasi apa yang terpasang, data apa yang dikirim, bisa memutuskan pairing | Persetujuan lokal wajib. Tidak ada penyamaran. |
| Admin keluarga | Mengelola anggota dan perangkat | MVP: satu OWNER; role ADMIN disiapkan di data model. |
| Operator/VPS | Menjaga service, backup, log | Tidak boleh membaca token/password. |
| Support | Membantu pemulihan | Tidak boleh meminta pairing code atau token. |

## 4. Tujuan

1. Parent dapat login dan melihat perangkat yang terhubung.
2. Pairing dua arah yang aman: kode sekali pakai + persetujuan lokal Companion +
   persetujuan Parent dengan kode verifikasi.
3. Parent dapat meminta status dan melihat nilai aktual beserta `observedAt` dan
   `lastSeenAt`.
4. Parent dapat mengirim `REQUEST_STATUS` dan (Tahap 3) `LOCK_SCREEN`; hasilnya
   dibedakan antara queued, received, executing, succeeded, failed, dan expired.
5. Semua akses dibatasi per keluarga dan diuji terhadap IDOR.
6. Tidak ada klaim palsu tentang background, uninstall, atau kontrol yang tidak tersedia.

## 5. Non-goals dan anti-goals

Tidak termasuk:

- Pengawasan diam-diam, ikon tersembunyi, penyamaran aplikasi, atau remote install.
- Membaca chat, OTP, password, mikrofon, kamera, notifikasi pribadi, kontak, SMS,
  riwayat panggilan, atau lokasi.
- Root, exploit, remote wipe, reset password, atau membuka PIN/pola Android.
- Accessibility untuk mengakali pembatasan sistem.
- Menampilkan tombol yang seolah didukung ketika izin/mode tidak memenuhi.
- Menjanjikan selalu-online, kontrol instan, atau tahan-uninstall tanpa bukti.
- Firebase/FCM, Cloud Functions, Wi-Fi Direct, atau Telegram pada MVP.
- Provisioning Device Owner/reset HP otomatis.
- Deployment VPS pada Tahap 0.

Anti-goal: fitur yang membuat anak tidak tahu sedang dipantau, atau yang membuat
orang tua percaya command berhasil padahal belum ada ACK.

## 6. Ruang lingkup per tahap

| Fitur | Tahap | Ketentuan |
|---|---|---|
| Login Parent | MVP/Tahap 1-2 | Tanpa public signup; admin bootstrap. |
| Pairing perangkat | MVP/Tahap 1-2 | Kode 8 digit, TTL, rate limit, persetujuan lokal, kode verifikasi. |
| Daftar perangkat | MVP/Tahap 2 | Isolasi per keluarga; status revocation. |
| Baterai/charging | MVP/Tahap 2 | `observedAt` dan `receivedAt`; nilai unknown jika tidak tersedia. |
| Status jaringan | MVP/Tahap 2 | Bedakan koneksi perangkat dan backend terjangkau. |
| Status layar/keyguard | MVP/Tahap 2 | Nilai terpisah; unknown jika tidak pasti. |
| Hasil command | MVP/Tahap 1-3 | Antrean, ACK, deduplikasi, expiry. |
| Kunci layar Android | Tahap 3 | Device Admin force-lock; bukan pembatas aplikasi; tidak membuka PIN. |
| Usage summary | Tahap 4 | Usage Access opsional; agregat dan minimisasi. |
| Jadwal lokal | Tahap 4 | Persisten; toleransi waktu; rekonsiliasi setelah reboot. |
| Suspend/resume aplikasi | Managed mode (keputusan terpisah) | Perlu Device Owner/Profile Owner; paket terlindungi dikecualikan. |
| Buka pembatasan 15/30 menit | Managed mode (keputusan terpisah) | Expiry lokal persisten; bukan membuka PIN. |
| Tema istirahat | Tahap 4+ | Hanya UI yang benar-benar didukung; tanpa pesan menakutkan palsu. |
| Telegram | Tahap 5 | Adapter ke service yang sama; allowlist; token di server. |
| Blokir internet aplikasi | Tahap 6 | VpnService, consent, IPv4/IPv6, recovery; tidak intercept isi trafik. |
| Firebase/P2P | Ditunda | Tidak diimplementasikan. |

## 7. Alur pengguna utama

### 7.1 Login Parent

1. Parent membuka aplikasi.
2. Memasukkan email dan password.
3. Server memverifikasi Argon2id, mengembalikan access token pendek dan refresh token.
4. Token disimpan di Android Keystore-backed secret store.
5. Jika access token kedaluwarsa, aplikasi melakukan refresh; jika refresh dicabut,
   kembali ke login.

Tidak ada pendaftaran publik. Akun awal dibuat oleh operator melalui CLI/server
bootstrap dengan password yang tidak disimpan di repository.

### 7.2 Pairing

1. Parent membuat pairing request; server menampilkan kode 8 digit dengan TTL.
2. Parent memberikan kode ke pengguna perangkat.
3. Companion memasukkan kode, menampilkan penjelasan data dan metadata perangkat.
4. Companion membuat device secret lokal dan mengirim claim; server membuat perangkat
   berstatus `PENDING` dan kode verifikasi 6 digit.
5. Pengguna Companion menekan “Setujui pairing di perangkat ini”.
6. Parent melihat metadata, kode verifikasi, dan status persetujuan lokal; Parent
   membandingkan kode dengan layar Companion lalu menyetujui.
7. Companion menerima status aktif, menyimpan device secret, dan mengirim status pertama.
8. Parent melihat perangkat di daftar.

Kode pairing saja tidak cukup untuk mendapatkan credential. Credential hanya aktif
setelah persetujuan lokal dan persetujuan Parent.

### 7.3 Status

1. Parent membuka detail perangkat.
2. Parent menekan “Minta status” (mengirim `REQUEST_STATUS`) atau melihat snapshot
   terakhir.
3. Companion menerima command saat aktif/terjadwal, mengumpulkan status, dan mengirim
   `POST /device-self/status`.
4. Parent melihat nilai, `observedAt`, `receivedAt`, `lastSeenAt`, dan label stale.
5. Nilai yang tidak dapat diamati ditampilkan sebagai “tidak diketahui”, bukan 0/false.

### 7.4 Kunci layar (Tahap 3)

1. Parent mengirim `LOCK_SCREEN`.
2. Server menyimpan `QUEUED` dan memeriksa ownership/expiry.
3. Companion mengambil command, mengirim ACK `RECEIVED`, memeriksa Device Admin dan
   expiry, lalu memanggil force-lock.
4. Companion mengirim ACK `SUCCEEDED` atau `FAILED` dengan alasan terstruktur.
5. Parent melihat state final. Jika belum ada ACK, Parent melihat queued/received,
   bukan “berhasil”.
6. Tidak ada tombol untuk membuka PIN/pola atau membuka kunci dari jauh.

### 7.5 Revocation dan pemulihan

- Parent dapat mencabut perangkat. Credential langsung dicabut; command queued
  dibatalkan; Companion menerima 401 dan menghapus credential lokal.
- Companion dapat memutuskan pairing; server mencabut credential dan mencatat audit.
- Kehilangan perangkat: Parent mencabut dari akun lain; tidak ada remote wipe.
- Pemulihan akun Parent belum termasuk MVP; desain harus menghindari master PIN
  hardcoded dan backdoor.

## 8. Kebutuhan fungsional

| ID | Kebutuhan | Prioritas | Tahap |
|---|---|---|---|
| FR-01 | Login, refresh, logout; tanpa public signup | Wajib | 1 |
| FR-02 | Satu akun terhubung ke satu family; semua query dibatasi family | Wajib | 1 |
| FR-03 | Pairing request dengan kode sekali pakai, TTL, attempt limit | Wajib | 1 |
| FR-04 | Claim Companion + persetujuan lokal + persetujuan Parent | Wajib | 1-2 |
| FR-05 | Device credential unik, hash di server, dapat dicabut | Wajib | 1 |
| FR-06 | Daftar/detail perangkat; status pairing/revocation | Wajib | 1-2 |
| FR-07 | Command queue dengan state machine dan expiry | Wajib | 1 |
| FR-08 | ACK idempotent; duplicate/out-of-order ACK ditangani | Wajib | 1 |
| FR-09 | Status snapshot minimal + `observedAt`/`receivedAt`/stale | Wajib | 2 |
| FR-10 | Capability report agar UI tidak menampilkan kontrol palsu | Wajib | 2 |
| FR-11 | LOCK_SCREEN via Device Admin force-lock | Wajib | 3 |
| FR-12 | Audit pairing, policy, revocation, command penting | Wajib | 1 |
| FR-13 | Policy revision check dan jadwal lokal | Berikutnya | 4 |
| FR-14 | Usage summary opsional dan minimisasi | Berikutnya | 4 |
| FR-15 | Telegram adapter dengan authorization sama | Opsional | 5 |
| FR-16 | VPN blocking aplikasi terpilih | Terakhir | 6 |

## 9. Kebutuhan non-fungsional

### Keamanan

- HTTPS wajib di production; HTTP hanya localhost/emulator development.
- Password Argon2id dengan parameter terukur; token acak 256-bit; simpan hash.
- Access token pendek (15 menit), refresh token dapat dicabut/dirotasi (30 hari).
- Device credential hanya berlaku untuk perangkatnya; tidak dapat mengakses endpoint Parent.
- Ownership check di setiap endpoint; test IDOR.
- Rate limit login, pairing, claim, command, dan ACK.
- Body size limit; validasi Zod; error tidak membocorkan detail internal.
- Secret tidak boleh masuk Git/APK/log; log redaction diuji.
- Backup terenkripsi dan diuji restore sebelum production.

### Privasi

- Data minimal: status perangkat, metadata perangkat, command, audit.
- Tanpa lokasi, kontak, SMS, chat, kamera, mikrofon, atau notifikasi pribadi.
- Retensi default 30 hari untuk audit/command; snapshot status terakhir dipertahankan
  sampai perangkat dihapus. Histori status tidak disimpan pada MVP.
- Kebijakan retensi dan penghapusan ditampilkan kepada pengguna.
- Tidak ada iklan, analytics pihak ketiga, atau penjualan data.

### Keandalan

- Command disimpan di database; WebSocket bukan sumber kebenaran.
- Reconnect menggunakan exponential backoff + jitter, dengan batas.
- Expired command tidak dieksekusi setelah reconnect.
- Command bersifat at-least-once; eksekusi harus idempotent atau aman diulang.
- Status lama diberi label stale; `unknown` bukan nilai palsu.
- SQLite backup konsisten (bukan copy file aktif); migrasi diuji.
- Jangan menjanjikan timer tepat detik pada semua kondisi Android.

### Aksesibilitas dan UX

- Kontras cukup, ukuran sentuh memadai, dukungan TalkBack di alur utama.
- UI Companion ramah anak dan transparan; tidak meniru layar kerusakan sistem.
- Pesan error menjelaskan tindakan berikutnya, bukan hanya kode.
- Parent melihat perbedaan “dikirim”, “diterima”, “sedang dijalankan”, “sukses”,
  “gagal”, “kedaluwarsa”.
- Tidak ada tombol yang terlihat aktif jika capability tidak tersedia.

## 10. Metrik keberhasilan MVP

Metrik berikut untuk evaluasi internal, bukan klaim marketing:

- Pairing berhasil tanpa bantuan pada perangkat target (diukur manual).
- Status terakhir memiliki `observedAt` dan `receivedAt` yang ditampilkan.
- Tidak ada kasus UI menampilkan sukses tanpa ACK final pada test.
- Command expired tidak dieksekusi pada test reconnect.
- Cross-family access = 0 pada automated test.
- Crash-free session di perangkat uji selama skenario utama.
- Dampak baterai diukur pada perangkat fisik; tidak diklaim sebelum ada data.

## 11. Acceptance criteria Tahap 0

- Folder audit tercatat: file yang ada, OS, tool, dan hambatan SDK.
- `AGENTS.md` dan dokumen PRD/arsitektur/kapabilitas/threat model/rencana/test plan ada.
- OpenAPI dan state machine command diusulkan.
- Matriks standard/managed mode, izin, batasan, risiko background, dan metode uji ada.
- Tidak ada source aplikasi lengkap, deployment, atau perubahan VPS.
- Keputusan terbuka dan risiko dicatat.

## 12. Acceptance criteria demo pertama (Tahap 2)

1. Parent login.
2. Parent membuat pairing; Companion menyetujui secara lokal; Parent menyetujui dengan
   kode verifikasi.
3. Parent meminta status; Companion mengirim observasi aktual.
4. Parent melihat baterai/charging/network/screen/keyguard, `observedAt`, `lastSeenAt`,
   dan label stale.
5. Perangkat tanpa izin atau tanpa koneksi menampilkan status queued/unknown, bukan sukses.

Demo pertama tidak termasuk lock, VPN, Telegram, managed provisioning, atau background
push.

## 13. Asumsi dan dependensi

- VPS tersedia dan dapat menjalankan Node/SQLite/Docker; belum diinventarisasi.
- Domain/DNS/TLS akan disiapkan setelah inventory; belum ada.
- Perangkat target adalah Android 9+ (minSdk 28 diusulkan); belum dikonfirmasi.
- Pengguna perangkat adalah anak yang mengetahui dan menyetujui aplikasi.
- Tidak ada FCM; latensi background diterima sebagai best-effort.
- Distribusi awal dapat sideload/private; Play Store belum diputuskan.
- Nama package `com.gchild.parent` dan `com.gchild.companion` sementara; namespace
  belum diverifikasi.

## 14. Risiko produk (ringkas)

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Tanpa FCM, command tidak instan | Parent mengira lock segera terjadi | UI queued + dokumentasi; keputusan arsitektur jika instan wajib. |
| Device Admin deprecated untuk enterprise | Lock bisa ditolak/diabaikan OEM | Uji perangkat; fallback managed mode; jangan klaim universal. |
| OEM battery killer | WorkManager/status tertunda | Uji OEM; panduan pengguna; tanpa bypass. |
| Play policy (spyware/FGS/VPN/device admin) | App ditolak | Transparansi, consent, deklarasi; review sebelum rilis. |
| Managed mode butuh factory reset | Pengguna tidak mau | Mode standar default; keputusan terpisah. |
| Data anak sensitif | Risiko hukum/privasi | Minimisasi, retensi, enkripsi, tanpa iklan/analytics. |
| Tidak ada hardware attestation | Device identity dapat dipalsukan | Kode verifikasi visual + parent approval; revoke. |
| VPS single point | Command/status berhenti | Backup, health check, restore; bukan HA MVP. |

## 15. Pertanyaan terbuka

1. Apakah lock harus instan saat Companion di background? Jika ya, FCM atau arsitektur
   lain diperlukan; tanpa itu, jawabannya tidak.
2. Apakah perangkat target akan memakai managed mode/Device Owner? Ini butuh factory
   reset/provisioning manual; bukan MVP default.
3. Distribusi: Play Store, private track, atau sideload? Ini memengaruhi kebijakan
   device admin, FGS, VPN, dan Families.
4. Perangkat/OS target dan OEM apa yang harus diuji fisik?
5. Yurisdiksi, usia anak, dan dasar hukum pemrosesan data?
6. Domain, inventory VPS, dan target backup?
7. Bagaimana pemulihan akun Parent tanpa backdoor?
8. Apakah jadwal butuh toleransi menit atau hanya jam? Exact alarm tidak dipakai.
9. Apakah Telegram tetap dilanjutkan setelah dua APK stabil?
10. Apakah data status perlu histori, atau snapshot terakhir cukup? MVP: snapshot terakhir.