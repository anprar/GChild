# Arsitektur — GChild

Status: usulan Tahap 0. Belum diimplementasikan, belum diuji, belum di-deploy.
Tanggal: 2026-11-02.

> Pembaruan 2026-11-03: ADR-001 menggantikan kanal Parent menjadi bot Telegram;
> tidak ada APK Parent, login password, atau session Parent HTTP pada tahap ini.
> Backend yang ada sekarang: `apps/backend` (lihat `docs/DECISIONS.md`).

## 1. Tujuan arsitektur

Menyediakan dua aplikasi Android dan satu backend yang:

- memisahkan akses antar keluarga;
- menyimpan command dan hasil sebagai sumber kebenaran;
- tidak mengklaim kemampuan background yang tidak dimiliki Android tanpa FCM;
- dapat dioperasikan pada satu VPS kecil tanpa Kubernetes/Redis/microservices;
- cukup sederhana untuk diuji end-to-end dan diaudit keamanannya.

## 2. Batasan yang mengikat

1. Dua APK terpisah: Parent dan Companion.
2. Tanpa Firebase/FCM, Cloud Functions, Wi-Fi Direct, atau Telegram pada MVP.
3. VPS adalah pusat komunikasi; Companion tidak dapat dihubungi langsung oleh Parent.
4. Command harus tetap tersimpan saat perangkat offline dan diambil ulang saat reconnect.
5. Tidak ada remote unlock/PIN reset, remote wipe, root, Accessibility bypass, atau
   ikon tersembunyi.
6. Android background bersifat best-effort. Tanpa FCM, tidak ada push yang membangunkan
   aplikasi yang force-stopped.
7. SQLite single-instance untuk MVP; bukan HA.
8. Backend production hanya diakses melalui HTTPS/Caddy; database tidak terbuka.
9. Target SDK/minSdk mengikuti hasil audit kemampuan, bukan ditekan untuk menghindari
   aturan platform.
10. Deployment dan provisioning perangkat adalah gerbang terpisah.

## 3. Gambaran komponen

```text
┌──────────────────┐        HTTPS/JSON         ┌──────────────────────────┐
│  GChild Parent   │  ───────────────────────> │                          │
│  Kotlin/Compose  │  <─────────────────────── │      gchild-server       │
└──────────────────┘   access/refresh token    │  Fastify + TypeScript    │
                                              │  Zod + SQLite + audit    │
┌──────────────────┐        HTTPS/JSON         │                          │
│ GChild Companion │  ───────────────────────> │  command queue           │
│  Kotlin/Compose  │  <─────────────────────── │  status snapshots        │
│  Device Admin    │   device credential       │  pairing/policy          │
└──────────────────┘                           └────────────┬─────────────┘
                                                            │
                                                   SQLite volume + backup
```

Komponen backend:

- **Caddy** (production): TLS, reverse proxy, batas request.
- **Fastify app**: HTTP API `/v1`, autentikasi, validasi, rate limit, logging.
- **SQLite**: data relasional, WAL, migrasi, transaksi.
- **Sweeper**: menandai command expired/timeout; berjalan di proses yang sama.
- **CLI admin**: membuat owner/bootstrap tanpa public signup.
- **OpenAPI export**: kontrak untuk Kotlin dan TypeScript.

Komponen Android:

- **Parent**: login, daftar perangkat, pairing, detail/status, command, hasil, audit.
- **Companion**: onboarding transparan, pairing/consent, checklist izin, status,
  executor command, deduplikasi, ACK queue, local policy engine (Tahap 4),
  Device Admin (Tahap 3), VPN (Tahap 6).
- **shared-protocol**: model Kotlin untuk DTO/state; bukan berbagi tipe langsung
  dengan TypeScript.

## 4. Alur runtime

### 4.1 Login Parent

```text
Parent -> POST /v1/auth/login {email,password}
Server -> verifikasi Argon2id, buat session
Server -> {accessToken, refreshToken, expiry}
Parent -> simpan token di Keystore-backed secret store
```

Access token 15 menit; refresh 30 hari; refresh dirotasi. Logout mencabut session;
access token langsung tidak berlaku karena server memeriksa hash session di database.

### 4.2 Pairing

Detail di bagian 8. Ringkas:

```text
Parent create code
Companion claim code + device secret
Companion local consent
Parent approve with verification code
Companion becomes ACTIVE and sends status
```

Kode pairing saja tidak pernah cukup untuk mendapatkan akses perangkat.

### 4.3 Status

```text
Parent GET /devices/:id/status
  -> snapshot terakhir + observedAt + receivedAt + stale
Parent POST /devices/:id/commands {type: REQUEST_STATUS}
  -> QUEUED
Companion GET /device-self/commands (aktif/terjadwal)
  -> ACK RECEIVED
  -> kumpulkan status
  -> POST /device-self/status
  -> ACK SUCCEEDED
Parent melihat status baru
```

### 4.4 Command dan ACK

`GET /device-self/commands` tidak mengubah state. Device harus mendapatkan ACK
`RECEIVED` yang diterima server sebelum mengeksekusi. Ini menutup race dengan cancel
dan memastikan server tahu command sudah diambil. Detail di
`docs/COMMAND_STATE_MACHINE.md`.

### 4.5 Revocation

```text
Parent DELETE /devices/:id
  -> device REVOKED, credential dicabut, QUEUED commands CANCELLED, audit
Companion request berikutnya -> 401
Companion menghapus secret lokal dan menampilkan status pairing dicabut
```

## 5. Transport tanpa FCM

### 5.1 Pilihan yang dipertimbangkan

| Mekanisme | Kelebihan | Keterbatasan | Keputusan |
|---|---|---|---|
| FCM | Dapat membangunkan app; push relatif andal | Dilarang di MVP; butuh Google Play services; data lewat Google; tambahan privasi | Tidak dipakai |
| WebSocket saat app aktif | Latensi rendah; hemat polling | Koneksi mati saat background/Doze/force-stop; bukan push | Opsional Tahap 2, hanya foreground |
| HTTP polling saat app aktif | Sederhana; mudah diuji | Boros baterai jika agresif; hanya saat app hidup | Dipakai untuk foreground |
| WorkManager periodic | API resmi untuk pekerjaan tertunda | Minimum 15 menit; dapat ditunda Doze/App Standby/OEM; bukan realtime | Dipakai untuk rekonsiliasi background |
| Foreground service `dataSync` permanen | Terlihat di notifikasi | Android 15+: total 6 jam/24 jam; tidak boleh start dari BOOT_COMPLETED; Play review; bukan untuk push | Tidak dipakai |
| Foreground service `systemExempted` | Secara teknis device admin memenuhi syarat | Ditujukan untuk integrasi sistem; review kebijakan; risiko penyalahgunaan tipe | Tidak dipakai di MVP |
| MQTT broker | Koneksi persisten | Tetap dibunuh OS; menambah broker; tidak menyelesaikan push | Tidak dipakai |

### 5.2 Keputusan

- **HTTP REST** untuk semua operasi dan sumber kebenaran.
- **WebSocket opsional hanya saat aplikasi terlihat** (Tahap 2) sebagai notifikasi
  “ada command”; server tetap menyimpan command di database. Jika WebSocket mati,
  aplikasi kembali ke polling saat aktif/WorkManager.
- **WorkManager** untuk pekerjaan tertunda: fetch command, kirim status, retry ACK.
  Bukan untuk realtime dan bukan jaminan eksekusi tepat waktu.
- **Exponential backoff + jitter** untuk reconnect/retry, dengan batas. Contoh:
  1s, 2s, 4s, 8s, 16s, 30s, 60s (maks), jitter ±20%.
- **Tidak ada klaim** bahwa WebSocket bertahan saat background, Doze, force-stop,
  reboot, atau OEM battery saver.

### 5.3 Konsekuensi produk

Jika Companion tidak aktif dan WorkManager belum dijalankan:

- command tetap `QUEUED`;
- Parent melihat “menunggu perangkat”, bukan “berhasil”;
- command dapat `EXPIRED` sebelum perangkat mengambilnya;
- status yang ditampilkan bisa stale.

Jika produk mensyaratkan lock instan saat perangkat di saku, arsitektur ini tidak
memenuhi. Perlu keputusan perubahan: FCM (keluar dari batasan MVP) atau perangkat
managed/dedicated dengan kebijakan yang berbeda.

## 6. Backend

### 6.1 Stack dan versi kandidat

Diverifikasi dari npm registry pada 2026-11-02; **belum di-install atau dikunci**:

| Komponen | Kandidat | Catatan |
|---|---|---|
| Node.js | 22.20.0 terpasang | LTS; Vitest 5 butuh >=22.12 |
| Fastify | 5.12.x | HTTP server |
| TypeScript | 5.9.x (awal) / 7.0.x | TS 7 tersedia; uji toolchain sebelum pindah |
| Zod | 4.6.x | Validasi runtime |
| fastify-type-provider-zod | 7.0.x | Peer: Fastify ^5.5, Zod >=4.1.5 |
| @fastify/swagger | 9.9.x | Generate OpenAPI |
| @fastify/rate-limit | 11.2.x | Rate limit in-memory |
| better-sqlite3 | 13.0.x | Native; verifikasi prebuilt Windows/Node 22 |
| @node-rs/argon2 | 2.2.x | Argon2id prebuilt |
| Vitest | 5.0.x | Test |
| tsx | 4.23.x | Dev runner |
| @apidevtools/swagger-parser | 13.1.x | Validasi OpenAPI di test |

Larangan:

- Jangan memakai ORM besar; repository + SQL eksplisit.
- Jangan memakai `dotenv`; Node 22 mendukung `--env-file`.
- Jangan menambah Redis/Kubernetes/microservices.
- Jangan memakai JWT untuk MVP; token opaque yang dapat dicabut lebih sederhana.

Jika `better-sqlite3` gagal terpasang di Windows, evaluasi `node:sqlite` (eksperimental
di Node 22) atau `sqlite3`, catat tradeoff, dan jangan diam-diam mengganti. Jika
`@node-rs/argon2` gagal, gunakan `node:crypto.scrypt` dengan parameter terdokumentasi
dan test; Argon2id tetap pilihan pertama.

### 6.2 Struktur modul

```text
apps/backend/
  src/
    app.ts                 # buildApp(deps) -> Fastify instance
    server.ts              # listen/start, signal handling
    config.ts              # env Zod, fail fast
    db/
      client.ts            # open SQLite, pragmas
      migrate.ts           # runner migrasi
      migrations/*.sql
    auth/
      password.ts          # Argon2id
      tokens.ts            # random, hash, timing-safe
      parent-auth.ts       # preHandler Bearer
      device-auth.ts       # preHandler Device
      rate-limit.ts
    modules/
      auth/routes.ts
      devices/routes.ts
      pairing/routes.ts
      commands/routes.ts
      device-self/routes.ts
      health/routes.ts
    domain/
      command-state.ts
      pairing-state.ts
    repositories/
      users.ts families.ts sessions.ts devices.ts credentials.ts
      pairing.ts commands.ts status.ts policies.ts audit.ts
    lib/
      errors.ts ids.ts time.ts redact.ts
    openapi.ts
  test/
    helpers/app.ts
    auth.test.ts pairing.test.ts commands.test.ts idor.test.ts
    state-machine.test.ts restart.test.ts migrations.test.ts
  scripts/
    admin-create.ts openapi-export.ts prune.ts
```

Layering: route -> zod validation -> service/domain -> repository -> SQLite. Route tidak
mengandung SQL. Repository tidak membaca header/HTTP.

### 6.3 Konfigurasi environment

Placeholder di `.env.example`; file `.env` tidak di-commit.

| Variabel | Default dev | Catatan |
|---|---|---|
| `NODE_ENV` | `development` | `production` mewajibkan HTTPS di depan |
| `HOST` | `127.0.0.1` | Jangan bind `0.0.0.0` tanpa Caddy/firewall |
| `PORT` | `3000` | Internal |
| `DATABASE_PATH` | `./data/gchild.sqlite` | Volume persisten |
| `PAIRING_CODE_PEPPER` | — | Wajib 32+ byte acak; gagal start jika kosong |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | 15 menit |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Rotasi |
| `PAIRING_CODE_TTL_SECONDS` | `600` | 10 menit |
| `ENROLLMENT_TTL_SECONDS` | `900` | 15 menit |
| `COMMAND_TTL_SECONDS` | `120` | Default per tipe |
| `STATUS_STALE_SECONDS` | `900` | Label stale |
| `RETENTION_DAYS` | `30` | Status/audit/command |
| `TRUST_PROXY` | `false` | Production: hanya proxy yang dikenal |
| `LOG_LEVEL` | `info` | Jangan `debug` token di production |

Bootstrap admin memakai env/CLI terpisah, bukan endpoint publik. Tidak ada public signup.

### 6.4 Autentikasi dan sesi

Parent:

- `POST /v1/auth/login` -> access + refresh.
- Access token: 32 byte acak, base64url; server menyimpan SHA-256 hash.
- Refresh token: 32 byte acak; hash; rotasi pada refresh.
- Session row menyimpan `family_id`, `user_id`, expiry, revocation.
- Setiap request Parent: hash access token -> cari session aktif -> cek expiry/revoked
  -> muat membership family.
- Logout mencabut session; access token langsung mati.
- Jika respons refresh hilang setelah rotasi, client harus login ulang pada MVP;
  tidak ada grace period token. Ini dicatat sebagai batasan, bukan bug tersembunyi.

Device:

- Header `Authorization: Device <credential>` (skema berbeda dari Bearer).
- Credential 32 byte acak dibuat di Companion saat claim; server hanya menyimpan hash.
- Server memetakan credential -> device -> family.
- Device hanya boleh mengakses `/device-self/*`.
- Parent tidak dapat memanggil endpoint ACK/status device; device tidak dapat memanggil
  endpoint Parent.
- Revocation langsung berlaku.

Token/hash:

- Token acak 256-bit; tidak perlu pepper karena entropi tinggi.
- Pairing code 8 digit (entropi rendah) memakai HMAC-SHA-256 dengan
  `PAIRING_CODE_PEPPER`; attempt limit + rate limit tetap wajib.
- Perbandingan hash memakai `timingSafeEqual`.
- Tidak ada token di log/URL/query.

### 6.5 Rate limit dan batas request

| Aksi | Batas usulan |
|---|---|
| Login per IP | 5/menit, 30/jam |
| Login per email | 10/jam (di samping IP) |
| Pairing create per user | 10/jam |
| Pairing claim per IP | 10/menit, 50/jam |
| Pairing claim per code | maks 5 attempt, lalu kode mati |
| Command create per device | 30/menit; maks 20 `QUEUED` |
| ACK per device | 120/menit |
| Status report per device | 60/menit |
| Body | 64 KB global; command/status 8 KB |
| Payload command | 4 KB |
| Device metadata | 2 KB |

Rate limit in-memory cukup untuk satu instance; restart mereset hitungan. Untuk
pairing code, `attempt_count` di database adalah kontrol tambahan yang persisten.
Jika nanti multi-instance, pindah ke store bersama; jangan mengklaim rate limit
terdistribusi sekarang.

### 6.6 Error dan konvensi API

Semua endpoint di `/v1`.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Payload tidak valid.",
    "requestId": "req_...",
    "details": {}
  }
}
```

- Status HTTP: 400 validasi, 401 tidak terautentikasi, 403 terlarang, 404 tidak ditemukan,
  409 konflik state/revision, 410 expired, 429 rate limit, 500 internal.
- Jangan membocorkan stack trace, SQL, token, email terdaftar, atau perbedaan
  “email tidak ada” vs “password salah” pada login.
- `X-Request-Id` dikembalikan; log memakai ID yang sama.
- Pagination: `limit` (1–100, default 20) + `cursor` opaque; response
  `{items, nextCursor}`.
- Idempotency command: header `Idempotency-Key` (8–128 karakter). Duplikat mengembalikan
  command yang sama, bukan membuat command baru.
- Timestamp ISO-8601 UTC. `observedAt` dari perangkat; `receivedAt` dari server.
- `expiresAt` command dihitung server; waktu perangkat tidak dipercaya.

### 6.7 OpenAPI dan Zod

- Zod adalah validasi runtime di batas HTTP.
- `fastify-type-provider-zod` + `@fastify/swagger` menghasilkan OpenAPI.
- `contracts/openapi.yaml` di-commit sebagai artefak kontrak; CI memeriksa bahwa hasil
  generate tidak berbeda (setelah Tahap 1).
- `contracts/examples/` (Tahap 1) memuat contoh JSON valid untuk test serialisasi Kotlin.
- Kotlin memakai model di `modules/shared-protocol`; tidak mengimpor tipe TypeScript.
- Perubahan breaking memakai versi API baru, bukan mengubah arti field lama diam-diam.

## 7. Model data

SQLite, foreign keys ON, WAL, `busy_timeout`, transaksi untuk perubahan state.
Waktu disimpan sebagai epoch milidetik; API mengonversi ke ISO-8601 UTC.

```text
users(
  id TEXT PK, email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)

families(id TEXT PK, name TEXT NOT NULL, created_at INTEGER NOT NULL)

family_members(
  family_id TEXT NOT NULL REFERENCES families(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('OWNER','ADMIN')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(family_id, user_id)
)

sessions(
  id TEXT PK, user_id TEXT NOT NULL REFERENCES users(id),
  family_id TEXT NOT NULL REFERENCES families(id),
  access_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at INTEGER NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  refresh_expires_at INTEGER NOT NULL,
  revoked_at INTEGER, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
)

devices(
  id TEXT PK, family_id TEXT NOT NULL REFERENCES families(id),
  label TEXT NOT NULL, model TEXT, manufacturer TEXT,
  platform TEXT NOT NULL DEFAULT 'android', app_version TEXT,
  installation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','REVOKED')),
  paired_at INTEGER, last_seen_at INTEGER, revoked_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(family_id, installation_id)
)

device_credentials(
  id TEXT PK, device_id TEXT NOT NULL REFERENCES devices(id),
  secret_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL DEFAULT 'device:self',
  created_at INTEGER NOT NULL, activated_at INTEGER,
  last_used_at INTEGER, revoked_at INTEGER
)
-- partial unique index: satu credential aktif per device

pairing_requests(
  id TEXT PK, family_id TEXT NOT NULL REFERENCES families(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE, code_expires_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL CHECK(status IN
    ('OPEN','CLAIMED','LOCAL_CONFIRMED','APPROVED','REJECTED','EXPIRED')),
  device_id TEXT REFERENCES devices(id),
  claim_token_hash TEXT UNIQUE, claim_token_expires_at INTEGER,
  verification_code TEXT, verification_expires_at INTEGER,
  device_label TEXT, device_model TEXT, device_manufacturer TEXT,
  app_version TEXT, sdk_int INTEGER, installation_id TEXT,
  local_confirmed_at INTEGER, approved_by TEXT REFERENCES users(id),
  approved_at INTEGER, rejected_at INTEGER, reject_reason TEXT,
  created_at INTEGER NOT NULL
)

commands(
  id TEXT PK, family_id TEXT NOT NULL, device_id TEXT NOT NULL REFERENCES devices(id),
  type TEXT NOT NULL CHECK(type IN ('REQUEST_STATUS','LOCK_SCREEN')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK(state IN
    ('QUEUED','RECEIVED','EXECUTING','SUCCEEDED','FAILED','EXPIRED','CANCELLED')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  received_at INTEGER, started_at INTEGER, completed_at INTEGER,
  expected_policy_revision INTEGER,
  delivery_count INTEGER NOT NULL DEFAULT 0, last_delivered_at INTEGER,
  lease_expires_at INTEGER,
  result_json TEXT, error_json TEXT,
  UNIQUE(requested_by, idempotency_key)
)

command_results(
  id TEXT PK, command_id TEXT NOT NULL REFERENCES commands(id),
  ack_id TEXT NOT NULL, status TEXT NOT NULL,
  result_json TEXT, error_json TEXT, observed_at INTEGER,
  recorded_at INTEGER NOT NULL,
  UNIQUE(command_id, ack_id)
)

device_status(
  device_id TEXT PK REFERENCES devices(id),
  sequence INTEGER NOT NULL,
  battery_level INTEGER, charging INTEGER, network_connected INTEGER,
  backend_reachable INTEGER, screen_interactive INTEGER, keyguard_locked INTEGER,
  observed_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
  capabilities_json TEXT, app_version TEXT
)

device_policies(
  device_id TEXT NOT NULL REFERENCES devices(id),
  revision INTEGER NOT NULL, policy_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id), created_at INTEGER NOT NULL,
  PRIMARY KEY(device_id, revision)
)

audit_logs(
  id TEXT PK, family_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('USER','DEVICE','SYSTEM')),
  actor_id TEXT, device_id TEXT,
  action TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('SUCCESS','FAILURE','DENIED')),
  metadata_json TEXT, created_at INTEGER NOT NULL
)

schema_migrations(version TEXT PK, applied_at INTEGER NOT NULL)
```

Aturan:

- Semua query Parent menyertakan `family_id` dari session; tidak ada `findById(id)` tanpa
  scope.
- Device endpoint hanya mencari credential aktif milik device sendiri.
- Foreign key + transaksi untuk pairing/approval/ACK/command creation.
- Satu credential aktif per device lewat partial unique index.
- `last_seen_at` diperbarui pada request device yang terautentikasi; status punya
  `received_at` sendiri.
- `device_status` menyimpan snapshot terakhir saja; histori status tidak disimpan pada
  MVP. Audit menyimpan kejadian penting, bukan setiap snapshot.
- Policy disimpan sebagai revisi; current = revision tertinggi. Update memakai
  `expectedRevision` dan menolak konflik (409), bukan last-write-wins.
- Retensi default 30 hari untuk audit/command/pairing; status terakhir dipertahankan.
  Prune dijalankan oleh script/CLI, bukan otomatis destruktif tanpa persetujuan.

## 8. Protokol pairing

### 8.1 Prasyarat

- Parent sudah login dan menjadi OWNER/ADMIN family.
- Companion belum memiliki credential aktif.
- Komunikasi melalui HTTPS.
- Companion menampilkan penjelasan data dan meminta persetujuan lokal.

### 8.2 Langkah

1. **Create**: `POST /v1/pairing-requests`.
   Server membuat kode 8 digit, menyimpan HMAC(code, pepper), TTL 10 menit, status
   `OPEN`. Respons berisi kode sekali; kode tidak disimpan plaintext.
2. **Claim**: `POST /v1/enrollment/claim` dengan kode, device secret 32 byte yang
   dibuat Companion, dan metadata perangkat.
   Server memeriksa status `OPEN`, expiry, attempt count, dan HMAC kode. Jika valid:
   membuat `devices` status `PENDING`, `device_credentials` belum aktif, status
   pairing `CLAIMED`, claim token acak (hash disimpan), dan kode verifikasi 6 digit.
   Kode pairing langsung tidak dapat dipakai lagi.
   Claim bersifat idempotent selama TTL: retry dengan kode + device secret yang sama
   boleh mengembalikan enrollment yang sama dengan claim token baru (token lama
   dirotasi). Ini menangani respons claim yang hilang tanpa menyimpan plaintext token.
3. **Local consent**: Companion menampilkan metadata, kode verifikasi, dan penjelasan.
   Setelah pengguna menekan setuju, `POST /v1/enrollment/:id/confirm-local` dengan
   claim token. Server mencatat `LOCAL_CONFIRMED`.
4. **Parent approval**: Parent melihat metadata + kode verifikasi + status local
   confirmed. Parent membandingkan kode dengan layar Companion, lalu
   `POST /v1/pairing-requests/:id/approve` dengan kode verifikasi. Server memeriksa
   ownership family, status, expiry, dan kode; lalu mengaktifkan device + credential.
5. **Activation**: Companion polling `GET /v1/enrollment/:id` dengan claim token
   melihat status `APPROVED`, menyimpan device secret (sudah ada di Keystore), dan
   mengirim status pertama. Parent melihat perangkat `ACTIVE`.

### 8.3 Sifat keamanan

- Kode pairing saja tidak cukup: butuh device secret + local consent + parent approval.
- Device secret dibuat di perangkat dan tidak pernah dikembalikan API; server hanya
  menyimpan hash.
- Kode verifikasi adalah kanal out-of-band manusia; server juga memeriksanya agar
  Parent tidak menyetujui perangkat yang salah karena salah ketik.
- Claim token hanya untuk status/consent enrollment; tidak dapat mengakses data
  perangkat setelah aktivasi.
- Semua langkah diaudit: create, claim, local confirm, approve, reject, expire.
- Kode/claim token/secret tidak masuk log.
- Kode expired tidak dapat diaktifkan; Parent harus membuat request baru.
- Reject/expiry menghapus/revokes credential dan device pending.

### 8.4 Residual risk

Tidak ada hardware attestation. Identitas perangkat adalah installation ID + metadata
+ kode verifikasi visual. Parent yang ceroboh bisa menyetujui perangkat yang salah.
Mitigasi: tampilkan metadata jelas, minta kode verifikasi, expiry pendek, tombol
reject, audit. Jangan mengklaim “perangkat terverifikasi secara kriptografis”.

## 9. Siklus command

Detail lengkap di `docs/COMMAND_STATE_MACHINE.md`. Ringkasan:

- State: `QUEUED` -> `RECEIVED` -> `EXECUTING` -> `SUCCEEDED`/`FAILED`.
- `QUEUED` dapat `EXPIRED`/`CANCELLED`.
- Fetch tidak mengubah state; device harus mendapatkan ACK `RECEIVED` sebelum eksekusi.
- Cancel hanya untuk `QUEUED` melalui
  `POST /v1/devices/:id/commands/:commandId/cancel`; setelah `RECEIVED`, cancel 409.
- ACK idempotent berdasarkan `(commandId, ackId)`.
- Final state tidak dapat diubah; ACK terlambat/konflik ditolak dan diaudit.
- Lease timeouts mencegah command menggantung; tidak ada requeue otomatis.
- Command expired tidak dikirim/dieksekusi setelah reconnect.
- Tipe command mendefinisikan idempotensi; `REQUEST_STATUS` dan `LOCK_SCREEN` aman
  diulang dengan hati-hati.

## 10. Android

### 10.1 Struktur Gradle

Satu Gradle build di root:

```text
settings.gradle.kts
gradle/libs.versions.toml
apps/parent-android/
apps/companion-android/
modules/shared-protocol/      # Kotlin/JVM, kotlinx.serialization
modules/policy-engine/        # Kotlin/JVM, evaluasi jadwal (Tahap 4)
```

- Dua application module menghasilkan dua APK.
- `shared-protocol` hanya berisi DTO/state/enum/kontrak; tidak berisi UI.
- Jangan berbagi kode jaringan/storage secara berlebihan antara dua app; kebutuhan
  dan lifecycle berbeda. Duplikasi kecil lebih baik daripada coupling.
- Versi Kotlin/AGP/Compose ditetapkan dari Android Studio/SDK yang terpasang pada
  Tahap 2 dan dikunci di `libs.versions.toml`. Jangan menebak sekarang.

### 10.2 Parent

- MVVM sederhana: `ui/`, `viewmodel/`, `data/`, `domain/`, `security/`.
- Login, daftar perangkat, pairing, detail/capability, status, command, hasil, audit,
  pengaturan.
- Retrofit + OkHttp; JSON converter diverifikasi pada Tahap 2.
- Room untuk cache daftar/status/command history; DataStore untuk preferensi.
- Token di `SecretStore` (Android Keystore AES-GCM), bukan plaintext SharedPreferences.
- Saat command dibuat: tampilkan `QUEUED`; polling hasil saat app aktif; jangan
  menyimpulkan sukses dari HTTP 202/201.

### 10.3 Companion

- MVVM sederhana + executor tunggal.
- Onboarding transparan; pairing; checklist izin; status; riwayat; unpair.
- `CommandExecutor`:
  - ambil command;
  - cek expiry/target/type;
  - ACK `RECEIVED` (wajib sukses sebelum eksekusi);
  - deduplikasi lokal berdasarkan command ID;
  - eksekusi;
  - ACK final;
  - simpan pending ACK jika jaringan gagal, retry idempotent.
- `StatusCollector`: battery, charging, network, screen, keyguard, capabilities.
- `SecretStore`: device credential, claim token sementara, token Parent (Parent app).
- Room: command history, pending ACK, status terakhir, dedup, policy cache.
- WorkManager: periodic reconciliation (min 15 menit) + one-shot setelah boot/app update;
  tidak untuk realtime.
- WebSocket opsional hanya saat app terlihat; bukan sumber kebenaran.
- Device Admin (Tahap 3): `DeviceAdminReceiver` minimal `force-lock`; onboarding
  menjelaskan; tanpa wipe/reset password.
- Local policy engine (Tahap 4): evaluasi jadwal offline, expiry absolut, toleransi;
  rekonsiliasi setelah reboot/timezone change.

### 10.4 Penyimpanan rahasia

- `SecretStore` membuat AES-256-GCM key di `AndroidKeyStore` (alias versi).
- Ciphertext + IV disimpan di DataStore; plaintext hanya di memori saat dibutuhkan.
- Tidak memakai `androidx.security:security-crypto` (deprecated).
- Tidak ada fallback plaintext. Jika key invalid/Keystore reset, hapus secret dan
  minta login/re-pair.
- StrongBox opsional; jangan klaim hardware-backed tanpa memeriksa `KeyInfo`.
- `allowBackup=false` untuk MVP agar token tidak ikut backup; konsekuensinya login/
  pairing ulang setelah restore. Dokumentasikan.

### 10.5 UI states

- Parent: loading, empty, stale, offline, queued, received, executing, succeeded,
  failed, expired, revoked, permission-missing.
- Companion: belum pairing, menunggu Parent, aktif, izin kurang, revoked, offline.
- Jangan menampilkan tombol aktif jika capability tidak ada; tampilkan alasan.
- Nilai tidak diketahui -> “Tidak diketahui”, bukan `false`/`0`.
- Waktu: tampilkan `observedAt` dan `lastSeenAt`; bedakan “data lama” dan “tidak ada data”.

## 11. Offline, waktu, dan pemulihan

- Command dan policy disimpan di server; Companion menyimpan history/pending ACK.
- Expiry command dihitung server. Device juga memeriksa `expiresAt`; gunakan
  `serverTime` dari fetch untuk koreksi offset, bukan jam perangkat saja.
- Temporary allowance (Tahap 4) memakai absolute expiry persisten + elapsedRealtime
  selama boot; setelah reboot, rekonsiliasi dengan waktu dinding dan tandai jika
  tidak yakin.
- Jangan menjanjikan timer tepat detik. Toleransi dan keterlambatan harus terlihat.
- Setelah reboot: WorkManager one-shot/reconcile; jangan start FGS dari boot.
- Setelah force-stop: aplikasi tidak dapat menerima apa pun sampai dibuka lagi.
- Setelah credential revoked: hapus lokal, tampilkan status, jangan retry tanpa henti.
- Recovery Parent tidak memakai master PIN/backdoor; desain ditunda.

## 12. Keamanan dan privasi

- TLS 1.2+ di production; cleartext hanya debug emulator.
- Password Argon2id (memory 19 MiB, iterations 2, parallelism 1 sebagai baseline;
  ukur dan naikkan jika hardware mengizinkan). Salt acak 16 byte; hash 32 byte.
- Token acak 256-bit; hash SHA-256 di server; access 15 menit; refresh 30 hari rotasi.
- Pairing code HMAC pepper; 8 digit; TTL; attempt limit; rate limit.
- Device credential scoped; hash; revocation.
- Ownership check di repository/route; test IDOR.
- Zod validation, body limit, rate limit, error generik.
- Log redaction untuk Authorization, token, password, pairing code, verification code,
  claim token, device secret.
- Audit pairing/policy/revocation/command final.
- Retensi 30 hari; data minimal; tanpa iklan/analytics pihak ketiga.
- Backup terenkripsi, offline/off-host; restore diuji.
- VPS: backend bind loopback; DB tidak terbuka; SSH key; firewall; update.
- Play policy: transparansi, consent, deklarasi FGS/VPN/device admin jika dipakai.
- Tidak memakai Accessibility API, root, overlay, notification listener, atau
  pengambilan data sensitif.

## 13. Deployment (usulan, belum dieksekusi)

Topologi production yang diusulkan:

```text
Internet -> Caddy :443 (TLS) -> 127.0.0.1:3000 Fastify
                                      |
                               /data/gchild.sqlite (volume)
                                      |
                               backup terenkripsi (off-host)
```

- Docker Compose + Caddy setelah inventory VPS; Docker belum terpasang di PC ini.
- Backend tidak diekspos langsung; port database tidak dibuka.
- Volume persisten; backup memakai SQLite backup API/`VACUUM INTO`, bukan copy file
  aktif; enkripsi sebelum keluar VPS.
- Health check `/v1/healthz` (liveness minimal) dan `/v1/readyz` (DB siap).
- Restart policy, log rotation, disk usage alert, dan prosedur restore.
- Rollback versi backend + backup sebelum migrasi.
- **Belum ada perubahan VPS.** Domain, DNS, port, RAM, service lain, dan backup target
  belum diinventarisasi.
- Jangan menjalankan prune/hapus volume/migrasi destruktif/ubah firewall tanpa
  persetujuan.

## 14. Observability dan retensi

- Log JSON (pino) dengan `requestId`, route, status, durasi; tanpa body sensitif.
- Error 5xx dicatat dengan stack di server, tetapi respons ke client generik.
- Audit log terpisah dari log aplikasi; akses dibatasi.
- Health/ready; belum perlu Prometheus/Grafana pada MVP.
- Retensi default 30 hari; script prune harus mendukung dry-run dan konfirmasi.
- Backup/restore diuji pada Tahap 1 (database kosong + data contoh).

## 15. Alternatif yang ditolak

| Alternatif | Alasan ditolak |
|---|---|
| FCM sebagai transport utama | Dilarang blueprint MVP; data lewat Google; perlu Play services. |
| WebSocket sebagai sumber kebenaran | Koneksi bisa mati; command bisa hilang; DB harus tetap sumber kebenaran. |
| WorkManager untuk realtime | Minimum 15 menit dan dapat ditunda; bukan realtime. |
| Foreground service permanen | Batas Android 15/16, Play policy, notifikasi; tidak menyelesaikan force-stop. |
| Device Owner otomatis | Butuh factory reset/provisioning; berisiko; keputusan terpisah. |
| Accessibility untuk kontrol | Dilarang produk dan berisiko kebijakan. |
| Root/exploit | Dilarang; tidak dapat dipertahankan. |
| JWT access token | Revocation kompleks; token opaque + DB lookup cukup untuk skala MVP. |
| Redis/Postgres | Belum perlu untuk satu VPS/satu instance; SQLite cukup. |
| ORM | Menambah abstraksi; SQL eksplisit lebih mudah diaudit. |

## 16. Keputusan arsitektur (ADR ringkas)

| ID | Keputusan | Alasan | Konsekuensi |
|---|---|---|---|
| AD-01 | Dua APK terpisah | Isolasi peran/izin; blueprint | Dua build, dua lifecycle, shared-protocol |
| AD-02 | REST + DB queue, tanpa FCM | Batasan MVP | Background best-effort; UI harus jujur |
| AD-03 | WebSocket hanya foreground (opsional) | Latensi saat aktif | Tidak menyelesaikan background |
| AD-04 | WorkManager untuk rekonsiliasi | API resmi | Minimum 15 menit; bisa ditunda |
| AD-05 | SQLite + repository + migrasi | Sederhana, satu VPS | Single instance; backup disiplin |
| AD-06 | Token opaque + hash | Revocation mudah | DB lookup setiap request |
| AD-07 | Device secret dibuat di perangkat | Server tidak menyimpan plaintext | Perlu claim token + aktivasi |
| AD-08 | Pairing dua arah + kode verifikasi | Mencegah claim takeover | UX lebih panjang; butuh dua perangkat |
| AD-09 | Keystore langsung, bukan security-crypto | Library deprecated | Implementasi + test sendiri |
| AD-10 | Tidak ada remote unlock/wipe/Accessibility | Batas produk/legal | Fitur lebih sedikit, klaim jujur |
| AD-11 | targetSdk 37, minSdk 28 (usulan) | API 37 stable; Play min 36; Android 9+ | Perlu uji API 28–37 dan perangkat fisik |
| AD-12 | Tanpa public signup | Mengurangi penyalahgunaan | Bootstrap admin/CLI; recovery ditunda |

## 17. Keputusan terbuka

1. **Latensi background**: terima best-effort atau ubah arsitektur (FCM/managed).
2. **Managed mode**: apakah produk akan menyediakan Device Owner? Butuh factory reset
   dan provisioning manual; bukan default.
3. **Distribusi**: Play vs private/sideload; memengaruhi kebijakan device admin,
   FGS, VPN, dan Families.
4. **Perangkat target**: minSdk 28 dan daftar OEM/OS untuk uji fisik.
5. **VPS**: inventory, domain, TLS, port, RAM/disk, backup target.
6. **Recovery akun Parent**: desain tanpa backdoor.
7. **Retensi**: 30 hari default; konfirmasi kebutuhan hukum.
8. **Histori status**: snapshot terakhir cukup atau perlu histori?
9. **Telegram**: dilanjutkan atau tidak setelah dua APK stabil.
10. **Versi Android toolchain**: kunci setelah SDK terpasang dan build pertama berhasil.