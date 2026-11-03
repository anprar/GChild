# GChild

**Guide. Protect. Connect.**

GChild membantu orang tua mengelola perangkat anak secara **transparan** pada perangkat
keluarga yang sah dikelola.

## Status

**Tahap 1 — backend + kanal Parent bot Telegram. Tahap 2 sebagian — APK Companion
sudah terbangun di CI dan sedang diuji di perangkat fisik; deployment VPS disiapkan di
`infra/` tetapi belum dijalankan.**

| Komponen | Status |
|---|---|
| Backend Fastify + SQLite (`apps/backend`) | Ada, berjalan, teruji |
| Kanal Parent: bot Telegram | Ada, teruji tanpa jaringan (Bot API direkam di test) |
| Pairing dua arah (kode + consent lokal + persetujuan Parent) | Ada, teruji |
| Antrean command + ACK + expiry + sweeper | Ada, teruji |
| Snapshot status (null/unknown, stale) | Ada, teruji |
| Audit | Ada |
| Simulator Companion (`tools/device-simulator`) | Ada, berlabel `SIMULATOR` |
| Source APK GChild Companion (`apps/companion-android`) | Ada (Kotlin + Compose, SDK 37, minSdk 28) |
| APK debug Companion | **Terbangun di CI** (artifact terverifikasi, URL server tertanam); pairing di perangkat fisik belum selesai diuji |
| APK GChild Parent | **Tidak direncanakan** pada tahap ini (lihat ADR-001) |
| Workflow build APK (`.github/workflows/android.yml`) | Berjalan; signing release opsional lewat secret |
| Pemasangan VPS (`infra/install.sh`, systemd) | Disiapkan, belum dijalankan di VPS mana pun |
| `contracts/openapi.yaml` | Diperbarui untuk endpoint yang benar-benar ada; belum divalidasi otomatis |

Keputusan mengganti kanal Parent dari APK menjadi bot Telegram dicatat di
[`docs/DECISIONS.md`](docs/DECISIONS.md) (ADR-001). Blueprint pengguna tidak diubah.

## Arsitektur singkat

```text
Bot Telegram (Parent) --long polling--> gchild-server (Fastify + SQLite)
                                              ^
                                              | HTTPS + Device credential
                                              |
                                   GChild Companion (belum ada APK)
```

Server adalah sumber kebenaran: command, ACK, status, dan audit disimpan di SQLite.
Bot Telegram tidak menyimpan policy sendiri.

## Menjalankan

Prasyarat: Node.js >= 22.12 (diuji pada 22.20.0) dan npm.

```bash
npm ci
cp .env.example .env      # isi PAIRING_CODE_PEPPER >= 32 karakter acak
npm run migrate
npm run admin:create -w apps/backend -- --telegram-id=<id Telegram> --family-name="Keluarga"
npm run dev
```

`.env` dimuat otomatis oleh script npm lewat `--env-file-if-exists=../../.env` (Node 22),
jadi tidak perlu `dotenv`. `TELEGRAM_BOT_TOKEN` boleh kosong: kanal bot nonaktif dan
server tetap jalan.

Buat bot lewat @BotFather, lalu isi `TELEGRAM_BOT_TOKEN` di `.env`. Jangan pernah
menaruh token di repo, APK, screenshot, atau log.

## Pemasangan di VPS

Backend bisa dipasang di VPS Ubuntu/Debian tanpa scp/copy manual:

```bash
ssh root@<IP-VPS> 'apt-get update -y && apt-get install -y git && rm -rf /tmp/gchild && git clone https://github.com/anprar/GChild.git /tmp/gchild && bash /tmp/gchild/infra/install.sh'
```

Installer memasang Node 22, clone/pull kode, membuat `.env` (pepper acak), `npm ci`,
migrasi, dan service systemd `gchild`. Detail, update, HTTPS, dan backup ada di
[`infra/README.md`](infra/README.md).

Kirim `/start` ke bot dari akun Telegram yang terdaftar. Perintah yang tersedia:

| Perintah | Fungsi |
|---|---|
| `/start`, `/perangkat` | Daftar perangkat dan status terakhir terlihat |
| `/pasangkan` | Buat kode pairing 8 digit (berlaku 10 menit) |
| `/menunggu` | Pairing aktif + kode verifikasi perangkat |
| `/setujui <id> <kode 6 digit>` | Setujui perangkat (wajib cocok dengan layar Companion) |
| `/tolak <id>` | Tolak permintaan pairing |
| `/status [nomor]` | Minta snapshot status baru (command `REQUEST_STATUS`) |
| `/cek [nomor]` | Lihat snapshot terakhir yang dilaporkan |
| `/kunci [nomor]` | Minta kunci layar (command `LOCK_SCREEN`, butuh Device Admin di perangkat) |
| `/terakhir`, `/batal <id>` | Riwayat command dan pembatalan selama masih `QUEUED` |
| `/hapus <nomor>` | Cabut akses perangkat (konfirmasi lewat tombol) |
| `/bantuan` | Ringkasan perintah |

## Android Companion

Source ada di `apps/companion-android`: satu Activity Compose dengan layar onboarding
(penjelasan data), pairing, persetujuan lokal + kode verifikasi, dan status.

Toolchain yang dipakai (diverifikasi dari metadata Maven/Google, 2026-11-03):

| Komponen | Versi |
|---|---|
| Android Gradle Plugin | 9.5.0 (maks API 37, butuh Gradle >= 9.6, JDK >= 17) |
| Gradle | 9.8.2 |
| Kotlin (built-in Kotlin AGP 9) | 2.4.21 + plugin Compose 2.4.21 |
| compileSdk / targetSdk / minSdk | 37 / 37 / 28 |
| Compose BOM | 2026.09.00 |
| OkHttp | 5.5.1 |

Build lewat GitHub Actions (`.github/workflows/android.yml`): jalankan workflow
`Android Companion` secara manual atau push yang menyentuh `apps/companion-android/**`.
Workflow memasang JDK 21, platform Android 37.2, build-tools 37.0.0, Gradle 9.8.2, lalu
menjalankan unit test JVM + `assembleDebug` dan mengunggah APK sebagai artifact.
Build debug bisa diarahkan ke backend LAN/VPS lewat repo variable `GCHILD_API_BASE_URL`
(mis. `http://192.168.1.176:3000`); nilai non-https hanya dipakai build debug.

Signing release memakai secret repo (jangan commit keystore):

- `GCHILD_KEYSTORE_BASE64` (keystore .jks dalam base64)
- `GCHILD_KEYSTORE_PASSWORD`
- `GCHILD_KEY_ALIAS`
- `GCHILD_KEY_PASSWORD`
- `GCHILD_API_BASE_URL` (repo variable, wajib `https://` untuk release)

Tanpa secret tersebut workflow tetap membangun APK release **tanpa signing**.

Belum ada wrapper Gradle binary di repo (tidak bisa dibuat tanpa Gradle lokal);
CI memakai Gradle dari `gradle/actions/setup-gradle`. Untuk build lokal, pasang
JDK 21 + Android SDK, lalu `gradle -p apps/companion-android :app:assembleDebug`.

Apa yang dilakukan aplikasi ini: pairing dua sisi (kode + persetujuan lokal + kode
verifikasi), kirim status nyata (baterai, pengisian, jaringan, layar, keyguard) dengan
`null` bila tidak dapat diamati, ambil command, dan laporkan ACK sesuai state machine.
Perintah `LOCK_SCREEN` **dilaporkan gagal** (`NOT_IMPLEMENTED_IN_COMPANION`) karena
Device Admin belum diimplementasikan; tidak ada klaim sukses palsu.

Belum ada: Device Admin/lock, WorkManager, WebSocket, usage access, jadwal, VPN,
notifikasi, onboarding izin bertahap, dan uji perangkat fisik.

## Simulator Companion (bukan Android)

```bash
export SIMULATOR_DEVICE_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
npm run simulate -- --base-url=http://127.0.0.1:3000 --code=<kode dari /pasangkan> --scenario=connect
```

Setiap baris keluaran diawali `SIMULATOR`. Simulator **tidak** memanggil
`lockNow()` dan tidak boleh dipakai sebagai bukti kontrol Android.

Skenario: `connect`, `offline`, `delay-ack`, `duplicate-ack`, `expired`, `status`.

## Verifikasi yang benar-benar dijalankan (2026-11-03)

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | exit 0 (backend + simulator) |
| `npm test` | 75 test backend (9 file) + 5 test simulator lulus |
| `npm run migrate` | menerapkan `001_init.sql`; pemanggilan kedua no-op |
| Smoke server lokal | `/v1/healthz` merespons 200 dari loopback dan IP LAN |
| CI `Android Companion` | run `41606484466` sukses: unit test JVM, `assembleDebug`, artifact `app-debug.apk` terverifikasi berisi URL server |

Cakupan test backend: migrasi, konfigurasi `.env` (token kosong), state machine command
(transisi sah/tidak sah), pairing (kode salah/expired/reuse/hijack/consent/verification
code), ownership antar keluarga, credential dicabut, antrean penuh, idempotensi ACK, ACK
final immutable, expiry, cancel race, lease timeout, status unknown/stale/out-of-order,
auth bot Telegram (allowlist + denial), notifikasi hasil, E2E, dan restart backend.

**Belum diuji:** pairing/status end-to-end di perangkat fisik (APK sudah terpasang, alur
belum selesai), perilaku Android (background, Doze, force-stop, Device Admin, lock
nyata), HTTPS/Caddy, Docker, backup/restore, VPS, rate limit terdistribusi, validasi
OpenAPI otomatis. Jangan menyebut fitur-fitur itu andal sebelum diuji.

## Batasan produk yang harus terlihat

- Tanpa FCM, tidak ada push yang membangunkan Companion. Command hanya diambil saat
  Companion aktif atau saat pekerjaan terjadwal berjalan; command bisa `EXPIRED`
  tanpa dieksekusi.
- Bot tidak pernah menampilkan "Berhasil" sebelum perangkat mengirim ACK final.
- Tidak ada pembacaan chat/OTP/notifikasi/lokasi/kamera/mikrofon/kontak/SMS, tidak ada
  root, Accessibility bypass, remote unlock, atau remote wipe.
- Akun Telegram orang tua adalah kunci kontrol. Amankan akun tersebut; GChild tidak
  menambahkan 2FA sendiri (residual risk di ADR-001).
- Rate limit saat ini in-memory per proses; restart mereset hitungan.

## Dokumen

| Dokumen | Isi |
|---|---|
| `GChild_Project_Blueprint.md` | Blueprint produk (milik pengguna; tidak diubah) |
| `AGENTS.md` | Aturan kerja agent |
| `docs/DECISIONS.md` | ADR-001: bot Telegram sebagai kanal Parent |
| `docs/PRD.md` | Masalah, pengguna, ruang lingkup |
| `docs/ARCHITECTURE.md` | Komponen, aliran, transport, data |
| `docs/ANDROID_CAPABILITIES.md` | Kemampuan Android nyata dan batasannya |
| `docs/COMMAND_STATE_MACHINE.md` | Transisi command, ACK, expiry |
| `docs/THREAT_MODEL.md` | Aset, aktor, ancaman, mitigasi |
| `docs/IMPLEMENTATION_PLAN.md` | Tahapan dan keputusan terbuka |
| `docs/TEST_PLAN.md` | Rencana test dan bukti |
| `contracts/openapi.yaml` | Kontrak endpoint Companion + health |

## Langkah berikutnya

1. Selesaikan pairing/status end-to-end di perangkat fisik dan catat hasil per OEM/API.
2. Pemasangan VPS: jalankan `infra/install.sh`, isi token bot, daftarkan owner, lalu
   build ulang APK dengan `GCHILD_API_BASE_URL` mengarah ke VPS (HTTPS untuk release).
3. Tambah sinkronisasi latar (WorkManager periodik) agar command Telegram diambil tanpa
   aplikasi terbuka; jelaskan tetap best-effort tanpa FCM.
4. Implementasikan Device Admin + `lockNow()` (Tahap 3) agar `LOCK_SCREEN` benar-benar
   dieksekusi dan dilaporkan dengan bukti.
5. Tambah validasi OpenAPI otomatis terhadap route dan contoh payload.
6. Putuskan distribusi Companion dan apakah perlu APK Parent di kemudian hari.
