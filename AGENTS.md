# AGENTS.md — GChild

Dokumen ini adalah aturan kerja untuk agent yang mengubah repository ini.
Bahasa dokumentasi dan UI: Indonesia. Identifier kode: Inggris.

## Status saat ini

- Tahap: **1 selesai (backend + kanal Parent), Tahap 2 sebagian** — source APK
  Companion ada, tetapi belum pernah di-build (tidak ada Android SDK/JDK 21 lokal;
  build disiapkan lewat GitHub Actions dan belum dijalankan).
- Yang ada: backend Fastify/SQLite, pairing dua arah, antrean command + ACK, status,
  audit, bot Telegram sebagai kanal Parent, simulator Companion berlabel SIMULATOR,
  test otomatis, dan kontrak `contracts/openapi.yaml` yang sudah disesuaikan.
- Ada juga: `apps/companion-android` (Kotlin/Compose, onboarding, pairing dua sisi,
  status, ACK jujur) dan `.github/workflows/android.yml` untuk build APK.
- Belum ada: APK terbangun/teruji, Android SDK/JDK 21 di mesin ini, perangkat fisik,
  deployment/VPS, database produksi, atau provisioning perangkat.
- Perubahan keputusan (kanal Parent = Telegram, tanpa APK Parent) dicatat di
  `docs/DECISIONS.md` ADR-001; blueprint tidak diubah.
- Jangan menyatakan build/test sukses tanpa menjalankan perintahnya dan melihat hasilnya.

## Sumber kebenaran

Baca berurutan sebelum mengubah apa pun:

1. `GChild_Project_Blueprint.md` — keputusan produk dan batas yang sudah disepakati.
   Bagian yang digantikan dicatat di `docs/DECISIONS.md` (ADR-001), bukan diubah di sana.
2. `docs/DECISIONS.md` — keputusan arsitektur yang menggantikan blueprint/dokumen lama.
3. `docs/PRD.md` — ruang lingkup dan acceptance criteria.
3. `docs/ARCHITECTURE.md` — komponen, alur, transport, data, dan deployment yang diusulkan.
4. `docs/ANDROID_CAPABILITIES.md` — kemampuan Android nyata dan batasannya.
5. `docs/COMMAND_STATE_MACHINE.md` — transisi command dan aturan ACK.
6. `docs/THREAT_MODEL.md` — aset, aktor, dan mitigasi.
7. `contracts/openapi.yaml` — kontrak API yang diusulkan.
8. `docs/IMPLEMENTATION_PLAN.md` dan `docs/TEST_PLAN.md` — urutan kerja dan bukti yang diminta.

Jika dokumen bertentangan, hentikan pekerjaan dan tanyakan. Jangan memilih interpretasi
yang memperluas fitur atau melemahkan keamanan.

## Aturan kerja yang tidak boleh dilanggar

1. **Satu tahap pada satu waktu.** Jangan mengerjakan Tahap 2 sebelum Tahap 1 diterima.
2. **Jangan deploy atau menyentuh VPS/live environment** tanpa persetujuan eksplisit.
   Jangan menjalankan prune, hapus volume, migrasi destruktif, ubah firewall, atau ganti
   reverse proxy.
3. **Jangan menghapus atau menimpa file pengguna** tanpa membacanya lebih dahulu.
   Blueprint adalah file pengguna; jangan ubah tanpa izin.
4. **Jangan membuat nested project** seperti `gchild/gchild`. Root repository adalah
   folder ini.
5. **Jangan memasukkan secret** ke Git, APK, screenshot, log, fixture, atau dokumen.
   Gunakan placeholder di `.env.example`; file secret masuk `.gitignore`.
6. **Production path tidak memakai fake data.** Mock hanya untuk test dan simulator.
   Simulator wajib diberi label `SIMULATOR`.
7. **Setiap endpoint dan command wajib memeriksa ownership.** Parent A tidak boleh
   membaca atau mengontrol perangkat keluarga B. Uji IDOR.
8. **Bedakan state command**: `QUEUED`, `RECEIVED`, `EXECUTING`, `SUCCEEDED`, `FAILED`,
   `EXPIRED`, `CANCELLED`. Jangan menampilkan sukses sebelum ACK final diterima.
9. **Jangan mengarang kemampuan Android.** Jika tidak dapat diamati, gunakan
   `unknown`/`null`, bukan tebakan. Uji di perangkat fisik sebelum menyebut andal.
10. **Jangan memakai Accessibility, root, exploit, remote unlock, remote wipe, atau
    ikon tersembunyi** untuk melewati batas platform atau persetujuan pengguna.
11. **Jangan memakai foreground service type palsu** atau WorkManager untuk polling
    realtime. Baca `docs/ANDROID_CAPABILITIES.md` sebelum menambah background work.
12. **Jangan menambah dependency tanpa alasan.** Verifikasi versi stabil dan
    kompatibilitas dari sumber resmi; kunci versi di lockfile.

## Batas produk

GChild membantu orang tua mengelola perangkat keluarga yang sah dan diketahui anak.
Yang dilarang:

- Pengawasan diam-diam, ikon tersembunyi, penyamaran aplikasi.
- Membaca chat, OTP, password, mikrofon, kamera, notifikasi pribadi, kontak, SMS,
  atau lokasi.
- Root, exploit, remote wipe, reset password, atau membuka PIN/pola Android.
- Accessibility untuk mengakali pembatasan sistem.
- Klaim tahan-uninstall, selalu-online, atau kontrol instan tanpa bukti.

Tanpa FCM, command hanya dapat diambil saat Companion aktif atau saat pekerjaan
tertunda dijalankan. Ini batasan produk yang harus terlihat di UI dan dokumentasi.

## Arsitektur singkat

```text
Bot Telegram (Parent) --long polling--> backend Fastify/SQLite <--HTTPS-- Companion app
                                              |
                                              +-- audit, command queue, status, policy revision
```

- Satu APK saat ini: `GChild Companion`. Kanal Parent adalah bot Telegram
  (`docs/DECISIONS.md` ADR-001); APK Parent tidak dibuat pada tahap ini.
- Backend: Node.js LTS, TypeScript strict, Fastify, Zod, SQLite, Vitest.
- Android: Kotlin, Jetpack Compose, Material 3, MVVM sederhana, Room/DataStore,
  OkHttp/Retrofit, Android Keystore.
- OpenAPI adalah kontrak; Zod adalah validasi runtime backend. Jangan mengasumsikan
  tipe TypeScript dapat dipakai langsung oleh Kotlin.
- WebSocket opsional hanya saat aplikasi aktif; database adalah sumber kebenaran.

## Rencana struktur repository

```text
AGENTS.md
README.md
.gitignore
.env.example                  # dibuat pada Tahap 1
apps/
  backend/
  parent-android/
  companion-android/
modules/
  shared-protocol/             # model Kotlin, bukan share tipe dengan TS
  policy-engine/
contracts/openapi.yaml
tools/device-simulator/
infra/                         # belum dibuat; hanya setelah inventory VPS
docs/
```

Jangan membuat folder kosong yang tidak dipakai. Struktur boleh disederhanakan
dengan alasan yang dicatat.

## Konvensi

- Dokumen dan string UI: Indonesia. Nama variabel/kelas/fungsi/endpoint: Inggris.
- Backend: ESM, TypeScript strict, Zod di batas trust, repository layer, migrasi SQL
  eksplisit, transaksi untuk perubahan state.
- Android: MVVM sederhana, repository, Coroutines/Flow, Compose, tanpa Hilt pada MVP
  kecuali ada alasan kuat. Nilai yang tidak pasti harus nullable/unknown.
- API: prefix `/v1`, error terstruktur, request ID, rate limit, body limit.
- Waktu: ISO-8601 UTC di API; `observedAt` berasal dari perangkat, `receivedAt` dari
  server. Waktu perangkat tidak dipercaya untuk expiry/otorisasi.
- Log: JSON terstruktur, redaksi header `Authorization`, token, password, pairing code,
  device secret, dan claim token.

## Perintah backend (Tahap 1 — berlaku)

Jalankan dari root repository. Jangan menulis klaim sukses tanpa output nyata.

```bash
npm ci
npm run typecheck
npm test
npm run migrate
npm run dev                 # butuh .env dengan PAIRING_CODE_PEPPER (>=32 char)
npm run admin:create -w apps/backend -- --telegram-id=<id> --family-name="Nama"
npm run simulate -- --base-url=http://127.0.0.1:3000 --code=<kode 8 digit>
```

`openapi:export` belum ada: kontrak ditulis tangan dan belum divalidasi otomatis
terhadap route. Jangan mengklaim kontrak tervalidasi sampai test itu dibuat.

Android: build dilakukan di GitHub Actions (JDK 21 + SDK 37 disediakan runner),
memakai Gradle 9.8.2 tanpa wrapper binary di repo:

```bash
gradle -p apps/companion-android :app:testDebugUnitTest :app:assembleDebug
gradle -p apps/companion-android :app:assembleRelease   # butuh -Pgchild.apiBaseUrl=https://...
```

Jangan mengklaim APK berhasil dibangun sampai log workflow atau build lokal benar-benar
diperiksa. APK Parent tidak dibuat (ADR-001).

## Verifikasi sebelum selesai

- Jalankan test yang relevan dan tempel hasil ringkasnya.
- Sebutkan apa yang otomatis, apa yang emulator, dan apa yang perangkat fisik.
- Sebutkan yang belum diuji. Jangan mengisi kekosongan dengan asumsi.
- Periksa `git diff`/file yang berubah; jangan tinggalkan secret atau file build.
- Jika build tidak bisa dijalankan karena SDK/tool tidak ada, laporkan hambatannya.

## Definition of done per tahap

- Acceptance criteria tahap terpenuhi.
- Test otomatis dan manual yang dijanjikan dijalankan.
- Tidak ada secret atau data produksi di repository.
- Dokumentasi diperbarui jika keputusan berubah.
- Agent berhenti dan meminta persetujuan sebelum tahap berikutnya.

## Keputusan terbuka

Lihat `docs/IMPLEMENTATION_PLAN.md` bagian “Keputusan yang menunggu persetujuan”.
Yang paling penting: ekspektasi latensi background tanpa FCM, mode managed/Device
Owner, distribusi Play vs sideload, perangkat target, dan inventory VPS.