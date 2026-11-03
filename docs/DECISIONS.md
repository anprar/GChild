# Catatan Keputusan Arsitektur — GChild

Dokumen ini mencatat perubahan keputusan yang **menggantikan** bagian tertentu di
blueprint/PRD/arsitektur. Blueprint adalah file pengguna dan tidak diubah tanpa izin;
karena itu perubahan dicatat di sini, bukan ditulis ulang di sana.

---

## ADR-001 — Bot Telegram menjadi satu-satunya kanal Parent

Status: **diterima atas persetujuan pengguna, 2026-11-03.**
Menggantikan: `GChild_Project_Blueprint.md` §2 poin 4 dan §14 Tahap 5,
`docs/PRD.md` §6 baris Telegram dan §7.1 (login Parent APK),
`docs/ARCHITECTURE.md` §2 poin 2 dan §4.1/§6.4 (auth Parent HTTP/Argon2/session).

### Konteks

Rencana Tahap 0 menetapkan dua APK (Parent + Companion) dengan backend HTTP, dan
menempatkan Telegram sebagai adapter opsional pada Tahap 5 setelah dua APK stabil.
Pengguna meminta urutan berbeda: **APK anak lebih dulu, dikontrol lewat bot Telegram
orang tua**, tanpa APK Parent.

Batasan yang ditemukan saat audit PC ini:

- tidak ada Android SDK/Studio, `adb`, emulator, atau Gradle;
- `java` di `PATH` masih JDK 8 (`JAVA_HOME` = JDK 17.0.2), bukan JDK 21;
- karena itu APK tidak dapat dibangun atau diuji di mesin ini.

Pengerjaan backend + kanal Telegram adalah satu-satunya irisan yang dapat dibangun,
dijalankan, dan dibuktikan sekarang tanpa mengarang hasil build Android.

### Keputusan

1. **Kanal Parent adalah bot Telegram.** Tidak ada APK Parent, tidak ada endpoint HTTP
   Parent, tidak ada password/Argon2/session token Parent pada tahap ini.
2. **Identitas Parent adalah `telegram_user_id`**, disimpan di `family_members`
   (satu user Telegram = satu keluarga pada MVP). Otorisasi tetap per keluarga:
   setiap query Telegram memakai `family_id` dari keanggotaan, bukan dari input pesan.
3. **Allowlist dua lapis:** keanggotaan di database + opsional `TELEGRAM_PARENT_IDS`
   di environment. Akun yang tidak lolos ditolak dengan pesan generik dan dicatat
   sebagai denial (tanpa PII) di log server.
4. **Token bot hanya ada di server** (`TELEGRAM_BOT_TOKEN`), tidak pernah dikirim ke
   perangkat atau ditulis ke repo/log/pesan.
5. **Pairing dua arah tetap wajib:** kode 8 digit (HMAC + TTL 10 menit + attempt limit
   persisten) + `deviceSecret` dibuat Companion + persetujuan lokal di perangkat +
   persetujuan Parent dengan kode verifikasi 6 digit yang dicocokkan di dua layar.
   Kode pairing saja tidak pernah cukup.
6. **Command/ACK/expiry tidak berubah.** State machine, TTL, sweeper, idempotensi ACK,
   dan larangan menampilkan sukses sebelum ACK final tetap mengikuti
   `docs/COMMAND_STATE_MACHINE.md`.
7. **Tanpa FCM tetap berlaku.** Bot hanya tahu apa yang sudah dilaporkan perangkat;
   UI bot menyebut "Menunggu perangkat" dan menjelaskan bahwa command dapat
   kedaluwarsa tanpa dijalankan.
8. **APK Companion tetap direncanakan** sebagai `apps/companion-android` dan memakai
   kontrak HTTP yang sudah ada. Bot tidak menggantikan Companion; bot menggantikan APK
   Parent sebagai antarmuka orang tua.

### Konsekuensi

Positif:

- Satu aplikasi yang harus dibangun dan diuji di perangkat (Companion), bukan dua.
- Orang tua tidak perlu memasang aplikasi; tidak ada distribusi APK Parent.
- Tidak ada password/session Parent yang bisa dicuri dari perangkat orang tua.

Biaya dan risiko baru:

| Risiko | Tingkat | Mitigasi saat ini | Residual |
|---|---|---|---|
| Akun Telegram orang tua dibajak = kontrol penuh perangkat | High | Allowlist + keanggotaan DB; bot tidak menyimpan password; pesan tidak memuat token; audit setiap aksi | Tidak ada 2FA tambahan di GChild; pengguna wajib mengamankan akun Telegram |
| Telegram sebagai pihak ketiga membaca isi pesan | Medium | Pesan hanya berisi label perangkat, status ringkas, state command; tanpa kode pairing setelah dipakai, tanpa credential, tanpa data sensitif | Metadata percakapan tetap terlihat Telegram |
| Bot token bocor | High | Token hanya di `.env` server, `.env` di `.gitignore`, redaksi header di log | Operator VPS dapat membaca env |
| Salah orang tua (akun Telegram orang lain ditambahkan) | Medium | Bootstrap owner lewat CLI di server; tidak ada endpoint menambah anggota | Prosedur operator belum didokumentasikan sebagai runbook |
| Telegram API down | Medium | Backend tetap sumber kebenaran; Companion tetap bisa enroll/ACK jika kode dibuat lewat CLI (belum ada) | Belum ada jalur cadangan pembuatan kode pairing tanpa bot |

### Yang berubah di kode

- `apps/backend/src/repositories/families.ts` — identitas Telegram, satu keluarga per
  user.
- `apps/backend/src/telegram/parent-bot.ts` — seluruh aksi Parent (pairing, status,
  lock, cancel, revoke) dengan ownership check per keluarga.
- `apps/backend/src/telegram/notifier.ts` — notifikasi ACK final; tidak pernah
  menyatakan sukses sebelum state final.
- Skema SQLite tidak memuat `users`, `sessions`, `password_hash`.
- `contracts/openapi.yaml` hanya memuat endpoint Companion + health.

### Yang belum diputuskan

1. Distribusi dan pengelolaan Companion (sideload vs Play) — keputusan D-03 lama.
2. Apakah nanti perlu APK Parent juga; endpoint HTTP Parent tidak dibuat sekarang.
3. Kanal cadangan bila Telegram tidak tersedia (CLI pairing atau APK Parent).
4. Perangkat target dan uji fisik (belum ada perangkat).
5. Managed mode / Device Owner (keputusan terpisah, tidak berubah).
