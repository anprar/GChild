# GChild — Project Blueprint & AI Coding Prompts

Status: rancangan awal, bukan implementasi yang telah diuji.
Bahasa dokumentasi/UI: Indonesia. Identifier kode: Inggris.

## 1. Identitas produk

- Produk: GChild.
- APK orang tua: GChild Parent.
- APK anak: GChild Companion.
- Backend: gchild-server.
- Repository: gchild.
- Telegram opsional: GChild Bot.
- Tagline: Guide. Protect. Connect.
- Nama package sementara: com.gchild.parent dan com.gchild.companion. Verifikasi kepemilikan namespace sebelum rilis.
- Nama merek, domain, dan Play Store belum diperiksa.

## 2. Keputusan yang sudah disepakati

1. Dua APK Android terpisah: Parent dan Companion.
2. VPS menjadi pusat komunikasi tahap awal.
3. Tidak menggunakan Firebase, Cloud Functions, atau Wi-Fi Direct pada MVP.
4. Telegram hanya integrasi tambahan setelah dua APK bekerja.
5. Implementasi bertahap; jangan menghasilkan seluruh fitur sekaligus.
6. Folder proyek sudah dibuat di PC. Coding agent bekerja di folder tersebut.
7. Backend disiapkan untuk deployment VPS, tetapi jangan menyentuh server live tanpa persetujuan.
8. Aturan yang sudah diterima harus disimpan lokal di Companion.

## 3. Tujuan dan batas produk

GChild membantu orang tua mengelola perangkat anak secara transparan pada perangkat keluarga yang sah dikelola.

Tidak termasuk:
- Pengawasan diam-diam, ikon tersembunyi, atau penyamaran aplikasi.
- Pembacaan chat, OTP, password, mikrofon, kamera, atau notifikasi pribadi.
- Root, exploit, remote wipe, reset password, atau membuka PIN/pola Android dari jauh.
- Accessibility untuk mengakali pembatasan sistem.
- Klaim kontrol instan, tahan-uninstall, atau selalu-online tanpa bukti.

Jika VPS/internet tidak tersedia, command baru tidak dapat dikirim. Jadwal yang telah tersimpan tetap dievaluasi lokal sejauh proses dan izin Android memungkinkan. HP mati tidak dapat dikendalikan. Force-stop, pencabutan izin, reboot, Doze, dan pembatasan OEM wajib diuji dan dijelaskan.

## 4. Arsitektur

Parent -> HTTPS API -> VPS/database -> Companion -> ACK -> VPS -> Parent.

VPS menyimpan identitas, relasi keluarga-perangkat, policy revision, antrean command, status terakhir, dan audit.
Companion memiliki satu executor, penyimpanan deduplikasi, antrean ACK, dan mesin kebijakan lokal.
Parent tidak pernah mengasumsikan sukses sebelum hasil Companion diterima.

### 4.1 Transport tanpa Firebase

- Gunakan HTTPS REST untuk autentikasi, pairing, policy, command, status, dan hasil.
- Untuk prototipe, uji fetch command saat aplikasi aktif terlebih dahulu.
- WebSocket dapat dipakai sebagai kanal notifikasi/command ketika koneksi tersedia; bukan jaminan background selalu hidup.
- Jangan memaksakan foreground service permanen dengan service type yang tidak sah.
- Sebelum background implementation, verifikasi aturan Android terkini untuk target SDK dan use case yang benar.
- WorkManager hanya untuk pekerjaan tertunda/rekonsiliasi yang sesuai, bukan polling realtime.
- Jika tidak ada mekanisme background yang sesuai untuk target perangkat, dokumentasikan batasan atau minta keputusan perubahan arsitektur. Jangan menyembunyikannya.
- Command tetap disimpan di database dan dapat diambil ulang setelah reconnect. WebSocket bukan sumber kebenaran.
- Gunakan exponential backoff dengan jitter dan batas retry.

## 5. Tech stack usulan

| Bagian | Pilihan |
|---|---|
| Android | Kotlin, Jetpack Compose, Material 3 |
| Struktur Android | MVVM sederhana, repository, Coroutines/Flow |
| HTTP/WebSocket | OkHttp + Retrofit untuk HTTP |
| Data lokal | Room dan DataStore |
| Perlindungan key | Android Keystore dengan implementasi terverifikasi |
| Backend | Node.js LTS, TypeScript strict, Fastify |
| Validasi | Zod |
| Database MVP | SQLite, migrasi, repository layer |
| Testing backend | Vitest |
| Telegram tahap lanjut | grammY |
| Deployment | Docker Compose, Caddy, volume persisten |
| Observability | Structured logging dengan secret redaction |

Verifikasi versi stabil dan kompatibilitas dependency sebelum mengunci versinya. Jangan menebak versi Android SDK, API, permission, atau library. MinSdk dan targetSdk ditetapkan setelah audit kemampuan; jangan menurunkan target SDK untuk menghindari aturan platform.

Tidak memerlukan Kubernetes, Redis, microservices, atau API AI pada runtime MVP.

## 6. Matriks fitur

| Fitur | Tahap | Ketentuan |
|---|---|---|
| Login orang tua | MVP | Pendaftaran awal dibatasi; tanpa public signup pada awal |
| Pairing perangkat | MVP | Kode sekali pakai, TTL, rate limit, persetujuan lokal |
| Daftar perangkat | MVP | Isolasi akses tiap keluarga |
| Baterai/charging | MVP | observedAt dan lastSeenAt |
| Status jaringan | MVP | Bedakan jaringan tersambung dan backend terjangkau |
| Status layar/keyguard | MVP | Nilai terpisah, unknown jika tidak pasti |
| Kunci layar Android | MVP | Device Admin dan kebijakan force-lock yang sesuai |
| Hasil command | MVP | Antrean, diterima, eksekusi, sukses/gagal/expired |
| Usage summary | Berikutnya | Usage Access opsional dan minimisasi data |
| Jadwal lokal | Berikutnya | Persisten dan rekonsiliasi setelah reboot |
| Suspend/resume aplikasi | Managed mode | Verifikasi Device Owner dan paket yang dilindungi |
| Buka pembatasan 15/30 menit | Managed mode | Bukan membuka PIN; expiry lokal persisten |
| Tema istirahat | Berikutnya | UI yang benar-benar didukung, tanpa pesan menakutkan palsu |
| Telegram | Opsional | Backend sama, authorization sama |
| Blokir internet aplikasi | Terakhir | VpnService, persetujuan, IPv4/IPv6, jalur pemulihan |
| Firebase/P2P | Ditunda | Tidak diimplementasikan saat ini |

### 6.1 Arti kontrol

- LOCK_SCREEN: mengunci layar Android, bukan membuat sistem pembatas aplikasi.
- SET_RESTRICTIONS: menetapkan pembatasan terkelola bila capability tersedia.
- TEMPORARY_ALLOW: melepas pembatasan tertentu selama durasi, tidak membuka keyguard.
- REQUEST_STATUS: meminta observasi baru; status cached diberi label.
- Jangan menampilkan tombol seolah didukung ketika izin/mode tidak memenuhi.

## 7. Layar aplikasi

### Parent
1. Login.
2. Daftar perangkat + last seen.
3. Tambah/pair perangkat.
4. Detail perangkat dan capability.
5. Command dan status hasil.
6. Pengaturan jadwal (fase berikutnya).
7. Riwayat audit dan pengaturan akun.

### Companion
1. Penjelasan transparan mengenai fungsi dan data yang dikirim.
2. Pairing dan persetujuan lokal.
3. Checklist izin dengan alasan per izin.
4. Status koneksi dan kebijakan aktif.
5. Riwayat command.
6. Pemulihan orang tua dan penghapusan pairing yang aman.

UI sederhana, ramah anak, kontras cukup, dan tidak meniru tampilan kerusakan sistem.

## 8. Model data backend

- users: identitas, password hash, status.
- families: kelompok pengelolaan.
- family_members: user, family, role.
- devices: family, label, model, status pairing/revocation.
- pairing_requests: hash kode, expiry, attempt count, approval state.
- sessions: hash refresh token, expiry, revocation.
- device_credentials: hash credential, scopes, rotation/revocation.
- commands: type, payload, expiry, revision, requester, state.
- command_results: command, hasil, error terstruktur, timestamp.
- device_status: snapshot minimal, observedAt, receivedAt.
- device_policies: revision dan policy JSON tervalidasi.
- audit_logs: actor, target, action, outcome, timestamp.

Gunakan constraint unik, foreign key, transaksi, indeks seperlunya, serta migrasi yang dapat diuji.

## 9. Kontrak command

Contoh skema konseptual, bukan secret atau payload production:

```json
{
  "commandId": "uuid",
  "deviceId": "device-id",
  "type": "LOCK_SCREEN",
  "payload": {},
  "createdAt": "ISO-8601-UTC",
  "expiresAt": "ISO-8601-UTC",
  "requestedBy": "user-id",
  "expectedPolicyRevision": null
}
```

Status: QUEUED -> RECEIVED -> EXECUTING -> SUCCEEDED atau FAILED.
QUEUED juga dapat menjadi EXPIRED/CANCELLED. Definisikan transisi dan perilaku jika ACK hilang. Tidak ada jaminan exactly-once jaringan; gunakan delivery ulang dan eksekusi idempotent sesuai tipe command.

- Backend memeriksa ownership setiap request.
- Companion memeriksa expiry, target device, jenis command, dan deduplikasi.
- ACK tidak boleh mengubah hasil final secara sembarang.
- Command expired tidak dijalankan ketika jaringan pulih.
- Perubahan policy menggunakan revision check, bukan last-write-wins diam-diam.
- observedAt berasal dari observasi perangkat, receivedAt dari server; waktu perangkat tidak selalu tepercaya.

## 10. API awal

Semua endpoint berikut berada di bawah /v1 dan merupakan rancangan untuk diperinci dalam OpenAPI.

Parent:
- POST /auth/login
- POST /auth/refresh
- POST /auth/logout
- GET /devices
- GET /devices/:id
- POST /pairing-requests
- POST /pairing-requests/:id/approve
- POST /devices/:id/commands
- GET /devices/:id/commands
- GET /devices/:id/status
- GET /devices/:id/policy
- PUT /devices/:id/policy

Companion:
- POST /enrollment/claim
- POST /enrollment/:id/confirm-local
- GET /device-self/commands
- POST /device-self/commands/:id/ack
- POST /device-self/status
- GET /device-self/policy

Operasional:
- GET /healthz (liveness minimal, tanpa secret)
- GET /readyz (kesiapan dependency, informasi dibatasi)

Pairing harus dirancang lengkap: claim kode saja tidak cukup untuk mengambil alih perangkat. Parent memeriksa identitas perangkat dan Companion memberi persetujuan lokal sebelum credential aktif diterbitkan. Buat flow bootstrap enrollment yang aman dan diuji.

## 11. Keamanan dan privasi

- HTTPS wajib di production; HTTP hanya localhost/emulator development yang dibatasi.
- Password di-hash dengan algoritma password hashing yang sesuai dan parameter terukur.
- Access token pendek; refresh token dapat dicabut dan dirotasi.
- Credential perangkat unik, terbatas pada dirinya, disimpan hash di server.
- Tidak ada secret dalam Git, APK, screenshot, atau log.
- Gunakan .env.example dengan placeholder; file secret masuk .gitignore.
- Validasi payload, body size, rate limit login/pairing/command.
- Tes IDOR: parent A tidak bisa membaca/mengontrol perangkat keluarga B.
- Parent tidak boleh menulis ACK yang seolah berasal dari Companion.
- Semua pairing, perubahan policy, revocation, dan command penting diaudit.
- Data dikumpulkan seminimal mungkin. Default usulan retensi status/audit: 30 hari, dapat dikonfigurasi; tampilkan kebijakan kepada pengguna.
- Backup terenkripsi atau disimpan di lokasi berakses terbatas; jangan hanya mengandalkan disk VPS yang sama.
- Dokumentasikan penghapusan perangkat, pencabutan akses, dan pemulihan akun.

## 12. Offline dan pemulihan

- Simpan policy, revision, command history, dan pending ACK di Room.
- Temporary allowance memakai absolute expiry persisten dan monotonic elapsed time selama boot bila sesuai.
- Rekonsiliasi ketika app aktif, service valid berjalan, boot jika diizinkan, atau sinkronisasi pulih.
- Jangan menjanjikan timer tepat detik pada semua kondisi Android.
- Jangan memblokir aplikasi controller, telepon/darurat, atau komponen esensial.
- VPN tahap lanjut tidak boleh memutus jalur controller ke backend.
- Recovery lokal orang tua harus memiliki rate limit dan secret yang tidak disimpan plaintext.
- Jangan membuat backdoor global atau master PIN hardcoded.

## 13. Struktur repository

```text
gchild/
  AGENTS.md
  README.md
  .gitignore
  .env.example
  apps/
    parent-android/
    companion-android/
    backend/
  modules/
    shared-protocol/       # Kotlin models; bukan berbagi tipe langsung dengan TS
    policy-engine/
  contracts/
    openapi.yaml          # acuan API lintas Kotlin/TypeScript
    examples/
  tools/
    device-simulator/
  infra/
    compose.yaml
    Caddyfile
  docs/
    PRD.md
    ARCHITECTURE.md
    ANDROID_CAPABILITIES.md
    THREAT_MODEL.md
    IMPLEMENTATION_PLAN.md
    TEST_PLAN.md
    RUNBOOK.md
```

Agent boleh menyederhanakan struktur setelah memberi alasan. Jangan menambah abstraksi tanpa kebutuhan.

## 14. Tahapan dan acceptance criteria

### Tahap 0 — audit folder dan desain
- Baca isi folder tanpa menghapus/mengganti file pengguna.
- Catat OS, tool yang tersedia, dan hambatan SDK secara nyata.
- Buat dokumen arsitektur, kontrak, threat model, dan matriks kemampuan.
- Belum deploy, belum provisioning perangkat.

### Tahap 1 — backend dan simulator
- Login, pairing, ownership, command queue, status, ACK.
- Simulator diberi label jelas SIMULATOR.
- Satu alur end-to-end terbukti lewat automated test.
- Test cross-family access, token revoked, expired command, duplicate ACK, backend restart.

### Tahap 2 — dua APK dan status
- Parent login, membuat pairing, dan melihat status.
- Companion menyetujui pairing dan mengirim status aktual.
- UI memisahkan data lama, offline, dan unknown.
- Uji jaringan terputus serta reconnect; jangan klaim background selalu aktif.

### Tahap 3 — kunci layar
- Onboarding Device Admin minimal force-lock.
- Tanpa izin -> gagal dengan alasan, bukan crash.
- Dengan izin -> command dieksekusi, hasil dilaporkan.
- UI Parent membedakan dikirim dan berhasil.
- Validasi koneksi background di perangkat fisik target sebelum menyatakan fitur andal.

### Tahap 4 — policy lokal
- Jadwal persisten, revision, temporary allowance jika capability tersedia.
- Uji reboot, perubahan jam/timezone, proses mati, permission revoked.
- Managed mode/provisioning menjadi keputusan terpisah; tidak reset HP otomatis.

### Tahap 5 — Telegram
- Adapter ke service yang sama, tidak membuat database policy terpisah.
- Allowlist user ID dan ownership check.
- Token tetap di server.

### Tahap 6 — VPN blocking
- Audit API dan izin lebih dahulu.
- Blocking aplikasi terpilih, IPv4/IPv6, CPU/baterai, consent, notification.
- Recovery lokal dan controller tetap dapat terhubung.
- Tidak ada interception atau logging isi trafik.

## 15. Deployment dan operasional VPS

- Development lokal dulu; jangan hubungkan langsung ke database live.
- Build Android di PC/CI yang sesuai; VPS hanya menjalankan backend.
- Inventaris service, port, RAM, dan domain sebelum deploy ke VPS yang dipakai aplikasi lain.
- Caddy menangani TLS setelah domain/DNS dan port dipastikan tersedia.
- Backend bind internal; jangan membuka database ke internet.
- Volume database dan backup persisten.
- SQLite backup menggunakan mekanisme backup konsisten, bukan asal menyalin file aktif.
- Health check, restart policy, log rotation, disk usage alert, dan prosedur restore.
- Jangan jalankan prune, hapus volume, migrasi destruktif, ubah firewall, atau ganti reverse proxy tanpa persetujuan.
- Siapkan rollback versi aplikasi dan backup sebelum migrasi.
- Ukur konsumsi resource; jangan menjanjikan kapasitas berdasarkan spesifikasi VPS saja.

## 16. Prompt utama — tempel ke coding agent di folder proyek

```text
Anda bertindak sebagai lead Android engineer, backend engineer, dan security reviewer untuk GChild.

Baca blueprint GChild ini dan seluruh file yang sudah ada di folder saat ini.
Folder ini adalah root proyek. Jangan membuat nested project gchild/gchild.
Jangan menghapus file, menimpa konfigurasi pengguna, melakukan deploy,
atau menyentuh VPS/live environment tanpa persetujuan.

Produk: GChild Parent dan GChild Companion.
Arsitektur awal: dua APK -> backend VPS. Tidak memakai Firebase/FCM,
Cloud Functions, Wi-Fi Direct, atau Telegram pada MVP pertama.
Telegram hanya integrasi opsional pada tahap berikutnya.

Gunakan stack dan batas keamanan blueprint.
Verifikasi API/permission Android dan dependency dari dokumentasi resmi.
Jangan menebak kemampuan background atau membuka PIN Android dari jauh.
Jika stack tidak dapat memenuhi keandalan background yang diminta,
jelaskan tradeoff dan minta keputusan, bukan membuat bypass tersembunyi.

ATURAN KERJA:
1. Audit repository dan tools yang tersedia dahulu.
2. Jangan mengeluarkan semua aplikasi sekaligus.
3. Kerjakan satu tahap, sertai automated test dan manual test.
4. Jangan mengatakan build/test sukses jika tidak dijalankan.
5. Production path tidak memakai fake data; mock hanya test/simulator.
6. Semua secret memakai placeholder dan di luar version control.
7. Setiap endpoint/perintah harus memiliki authorization ownership.
8. Selalu bedakan command queued, diterima, sukses, gagal, dan expired.
9. Dokumentasikan ketergantungan VPS dan keterbatasan Android.
10. Jangan melakukan provisioning Device Owner/reset HP otomatis.

MULAI DARI TAHAP 0 SAJA:
- Inventaris file yang sudah ada.
- Buat/update AGENTS.md.
- Buat docs/PRD.md, ARCHITECTURE.md, ANDROID_CAPABILITIES.md,
  THREAT_MODEL.md, IMPLEMENTATION_PLAN.md, TEST_PLAN.md.
- Usulkan OpenAPI dan state machine command.
- Buat matriks standard/managed mode, API, izin, batasan,
  risiko background, dan metode uji.
- Jelaskan pilihan transport tanpa FCM dan keterbatasannya.
- Jangan implementasikan seluruh source aplikasi dulu.

Akhiri dengan:
ringkasan, file berubah, keputusan arsitektur,
risiko terbuka, dan langkah tahap 1 yang perlu disetujui.
```

## 17. Prompt tahap 1 — backend + simulator

```text
Baca AGENTS.md, blueprint, dan hasil tahap 0.
Implementasikan backend TypeScript/Fastify + SQLite dan simulator Companion.
Belum implementasikan UI Android atau deploy VPS.

Sediakan login bootstrap admin yang aman tanpa public signup,
relasi keluarga/perangkat, pairing dua arah, device credential,
command queue, status snapshot, ACK idempotent, audit, dan migrasi.
Buat OpenAPI sebagai acuan Kotlin/TypeScript; validasi dengan Zod.
Jangan mengasumsikan Kotlin shared module dapat dipakai langsung di TS.

Simulator harus dapat offline/reconnect, menunda ACK,
mengirim duplicate ACK, dan menolak command expired.
Jangan melabeli hasil simulator sebagai kontrol Android nyata.

Test: akses lintas keluarga, brute-force pairing, expired code,
credential revoked, duplicate command, ACK invalid,
backend restart, rollback transaksi, status stale.

Sediakan .env.example, README, seed development tanpa secret production,
serta perintah install/migrate/test/run yang benar-benar diperiksa.
Laporkan apa yang belum dapat diuji. Berhenti setelah tahap ini.
```

## 18. Prompt tahap 2 — APK dan pairing/status

```text
Baca kontrak API, blueprint, AGENTS.md, dan backend yang sudah dibuat.
Implementasikan GChild Parent dan GChild Companion dengan Kotlin/Compose.
Fokus login Parent, pairing dua arah dengan persetujuan lokal,
penyimpanan credential aman, dan status aktual Companion.

Awali komunikasi saat aplikasi aktif. Setelah itu implementasikan
transport reconnect yang sah menurut target SDK.
Jangan mengklaim WebSocket bertahan terus saat background/Doze/force-stop.
Jangan pakai foreground service type palsu atau polling WorkManager realtime.

Status minimal: baterai, charging, network, backendReachable,
screenInteractive, keyguardLocked, observedAt, lastSeenAt.
Gunakan unknown/unavailable bila tidak bisa diamati.
Simpan pending ACK/status seperlunya di Room dengan pembatasan ukuran.

Test auth expired, pairing salah, ownership, jaringan berganti,
status stale, app restart, dan credential revoked.
Build APK jika SDK tersedia. Jika tidak, laporkan hambatan tanpa mengarang hasil.
Belum menambahkan lock, VPN, Telegram, atau managed provisioning.
```

## 19. Prompt tahap 3 — lock screen

```text
Tambahkan LOCK_SCREEN end-to-end pada proyek yang sudah berjalan.
Gunakan DevicePolicyManager dan DeviceAdminReceiver dengan policy force-lock
minimal yang diperlukan dan onboarding transparan.
Tidak meminta wipe-data atau reset-password.

Parent hanya mengirim request; backend memeriksa ownership dan expiry.
Companion memeriksa capability, permission, expiry, deduplikasi,
menjalankan lock, lalu melaporkan hasil dan observasi yang tersedia.
Jika tidak dapat memverifikasi keyguard aktual, jangan mengklaim telah terverifikasi.

UI: queued, received, executing, succeeded, failed, expired.
Tidak ada fitur remote membuka PIN/pola.
Uji izin belum aktif, izin dicabut, duplicate delivery,
command expired, backend offline, reconnect, layar mati, dan background.

Bedakan automated test, emulator test, dan physical device test.
Jangan menyatakan andal sebelum pengujian fisik pada perangkat target.
```

## 20. Prompt review keamanan sebelum deployment

```text
Audit proyek tanpa deploy dan tanpa mengubah server live.
Periksa authorization/IDOR, pairing, token rotation/revocation,
password hashing, secret exposure, logging, command replay/expiry,
state transition, database migration, backup, Android permissions,
background limitations, privacy, dan recovery.

Buat temuan dengan severity, bukti file/baris, dampak, perbaikan,
dan regression test. Jangan mengarang vulnerability tanpa bukti.
Perbaiki isu kritis secara lokal dengan test.
Buat runbook deployment staging dan rollback untuk ditinjau.
```

## 21. Cara menggunakan dokumen

1. Letakkan dokumen ini di root folder proyek yang sudah dibuat.
2. Buka terminal/coding agent pada folder tersebut.
3. Tempel prompt utama dan minta agent membaca dokumen ini.
4. Review hasil tahap 0 sebelum meminta tahap 1.
5. Simpan perubahan di Git per tahap; jangan commit secret.
6. Lanjutkan berdasarkan acceptance criteria, bukan banyaknya file yang dihasilkan.

Target demonstrasi pertama: Parent meminta status -> Companion mengirim observasi aktual -> Parent menampilkan timestamp. Target berikutnya: perintah lock dengan ACK dan batasan yang jelas.
