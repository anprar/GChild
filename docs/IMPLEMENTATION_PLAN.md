# Rencana Implementasi — GChild

Status: Tahap 0 selesai secara dokumen. Tahap 1 sebagian dikerjakan 2026-11-03.
Tanggal: 2026-11-02 (rencana), pembaruan 2026-11-03.

> Pembaruan 2026-11-03: sesuai ADR-001 (`docs/DECISIONS.md`), kanal Parent adalah bot
> Telegram dan APK Parent tidak dibuat. Urutan Tahap 1 backend + kanal Telegram sudah
> berjalan; Task 2 (password/auth Parent) dan endpoint Parent HTTP **tidak berlaku**.
> Tahap 2: source `apps/companion-android` sudah dibuat (Kotlin/Compose, SDK 37) beserta
> workflow build GitHub Actions, tetapi **belum pernah di-build atau diuji di perangkat**.
> Build lokal terblokir tanpa Android SDK/JDK 21; verifikasi berikutnya adalah menjalankan
> workflow tersebut dan memeriksa log/artifact-nya.

## 1. Audit awal (Tahap 0)

### 1.1 Isi folder

Saat audit, root hanya berisi:

- `GChild_Project_Blueprint.md` (473 baris, sudah dibaca seluruhnya).

Tidak ada source, konfigurasi, database, APK, atau file build. Tidak ada repository Git
(`git status` tidak relevan). Tidak ada file pengguna lain yang perlu dipertahankan.
Blueprint tidak diubah.

### 1.2 Lingkungan

| Item | Nilai | Implikasi |
|---|---|---|
| OS | Windows 11 Pro 64-bit, build 26300 | Path/shell PowerShell 5.1; script harus portable Node. |
| CPU/RAM | Intel i5-10400, 6 core/12 thread, 16 GB | Cukup untuk backend + satu emulator; bukan untuk banyak AVD bersamaan. |
| Disk | C: 30.3 GB free; D: 49.6 GB; Z: 402.2 GB | Android Studio + SDK + emulator bisa >20 GB. Instal SDK di D/Z, bukan C. |
| Node.js | 22.20.0 | LTS; cocok untuk Fastify 5/Vitest 5. |
| npm | 11.12.1 | Lockfile npm. |
| Git | 2.54.0 | Tersedia. |
| Python | 3.13.9, sqlite3 3.50.4 | Bisa inspeksi SQLite; PyYAML tidak ada. |
| Java PATH | Zulu JDK 8 (1.8.0_345) | **Salah untuk Android modern.** |
| `JAVA_HOME` | `C:\orlansoft_erp\openjdk`, release 17.0.2 | JDK 17 tersedia, tetapi patch lama. |
| Android SDK | Tidak ada (`ANDROID_HOME`/`ANDROID_SDK_ROOT` kosong) | Stage 2/3 build APK terblokir. |
| Android Studio | Tidak ada | Perlu instalasi. |
| adb/emulator/sdkmanager | Tidak ada | Tidak bisa uji perangkat/emulator sekarang. |
| Gradle | Tidak ada global | Gunakan Gradle wrapper setelah project Android dibuat. |
| Docker/Compose | Tidak ada | Jalur compose belum diverifikasi; Stage 1 pakai Node langsung. |
| SQLite CLI | Tidak ada | Gunakan better-sqlite3/Python untuk inspeksi. |
| OpenSSL | Tidak ada | Backup encryption belum bisa diuji lokal. |
| WSL | Tidak terpasang | Tidak diperlukan. |
| Web | Tersedia | Dipakai membaca dokumentasi resmi dan metadata npm. |
| VPS | Tidak diakses | Tidak ada perubahan. |

### 1.3 Versi dependency yang dicek (belum dipasang)

Dari npm registry 2026-11-02:

- Fastify `5.12.7`
- Zod `4.6.7`
- TypeScript `7.0.2` (latest), `5.9.3` (latest 5.x)
- Vitest `5.0.5` (butuh Node ^22.12)
- better-sqlite3 `13.0.3`
- @node-rs/argon2 `2.2.2`
- @fastify/rate-limit `11.2.1`
- @fastify/swagger `9.9.3`
- fastify-type-provider-zod `7.0.0` (peer Fastify ^5.5, Zod >=4.1.5)
- @apidevtools/swagger-parser `13.1.0`

Keputusan: mulai dengan TypeScript 5.9.x untuk kompatibilitas toolchain; evaluasi
TypeScript 7 setelah install/test. Jangan mengunci versi sebelum `npm install` dan
typecheck berhasil.

### 1.4 Hambatan nyata

1. **Android build tidak mungkin sekarang**: tidak ada SDK, Android Studio, adb, atau
   emulator; `java` di PATH adalah JDK 8. Stage 2 harus menunggu instalasi JDK 21 +
   Android SDK/Studio.
2. **Tidak ada perangkat fisik** yang terdaftar; klaim background/lock tidak boleh
   dibuat sebelum uji fisik.
3. **Docker tidak ada**; deployment path belum diverifikasi.
4. **C: disk tight** untuk Android SDK/emulator; gunakan D/Z.
5. **VPS belum diinventarisasi**; jangan menulis compose/Caddy final atau menyentuh
   server.
6. **Native dependency** (`better-sqlite3`, `@node-rs/argon2`) belum diuji di Windows;
   siapkan fallback yang didokumentasikan, bukan silent fallback.

## 2. Prinsip eksekusi

- Satu tahap per iterasi; berhenti dan minta persetujuan.
- TDD untuk logika non-trivial: test gagal -> implementasi -> test lulus.
- Jangan menulis seluruh aplikasi sekaligus.
- Semua endpoint punya ownership check dan test.
- Jangan deploy/VPS/provisioning pada Tahap 0-1.
- Jangan mengklaim hasil yang belum dijalankan.
- Perubahan kontrak memperbarui OpenAPI + test + dokumen.

## 3. Tahapan dan gerbang

| Tahap | Deliverable | Gerbang |
|---|---|---|
| 0 | Dokumen, audit, OpenAPI usulan, state machine | Persetujuan manusia |
| 1 | Backend Fastify/SQLite + simulator + E2E test | Semua test lulus; review keamanan dasar |
| 2 | Dua APK: login, pairing, status | Build APK + uji perangkat; belum lock |
| 3 | LOCK_SCREEN Device Admin | Uji izin, admin off/on, physical device |
| 4 | Policy lokal/jadwal/temporary allowance | Uji reboot/timezone/offline |
| 4M | Managed mode (opsional) | Keputusan terpisah; factory reset/provisioning |
| 5 | Telegram adapter | Setelah dua APK stabil; allowlist |
| 6 | VPN blocking | Audit API/izin; recovery; review Play |
| Deploy | Staging/production VPS | Inventory, backup, rollback, security review |

### Acceptance criteria Tahap 1

- `npm ci`, `npm run typecheck`, `npm test`, `npm run migrate` berhasil di Node 22.20.
- Login/bootstrap, pairing, device ownership, status, command queue, ACK, audit,
  migrasi, dan simulator bekerja.
- Test end-to-end Parent -> pairing -> status -> command -> ACK -> hasil lulus.
- Test cross-family, token revoked, expired command, duplicate ACK, restart backend,
  rollback transaksi, status stale lulus.
- Simulator berlabel `SIMULATOR`; tidak diklaim sebagai kontrol Android.
- `contracts/openapi.yaml` tervalidasi dan sesuai route.
- Tidak ada secret di repo/log; `.env.example` placeholder.
- Tidak ada deployment/VPS/Android UI.

## 4. Rencana Tahap 1 (detail)

### Global constraints

- Node.js 22.20.0; ESM; TypeScript strict.
- Fastify 5.x, Zod 4.x, better-sqlite3 13.x, Vitest 5.x.
- SQLite single file; WAL; foreign keys ON; transaksi.
- Tanpa Docker, tanpa deploy, tanpa FCM, tanpa Android.
- Tanpa public signup.
- Semua waktu server memakai epoch ms; API ISO-8601 UTC.
- Tidak ada token/password/pairing code di log.
- Semua endpoint di `/v1`; error schema konsisten.
- `Idempotency-Key` untuk create command.
- State machine mengikuti `docs/COMMAND_STATE_MACHINE.md`.

### Review focus (input yang paling mungkin merusak)

1. Request tanpa auth/skema salah ke endpoint Parent/device.
2. ID perangkat/command milik keluarga lain.
3. ACK duplikat, out-of-order, atau setelah expired/timeout.
4. Payload malformed/oversized dan angka/boolean yang tidak valid.
5. Restart backend, clock skew, dan status out-of-order.

Setiap baris memiliki test di task yang memiliki kode terkait.

---

### Task 1 — Scaffold, config, SQLite, migrasi, health

**Files:**

- Create root: `package.json`, `.nvmrc`, `apps/backend/package.json`,
  `apps/backend/tsconfig.json`, `apps/backend/vitest.config.ts`,
  `apps/backend/.env.example`.
- Create: `apps/backend/src/config.ts`, `src/db/client.ts`, `src/db/migrate.ts`,
  `src/db/migrations/001_init.sql`, `src/app.ts`, `src/server.ts`,
  `src/modules/health/routes.ts`, `src/lib/errors.ts`.
- Test: `apps/backend/test/migrations.test.ts`, `test/health.test.ts`.

**Interfaces:**

- `buildApp(opts: { db: Database; config: Config; now?: () => number }): FastifyInstance`
- `openDatabase(path: string): Database`
- `migrate(db: Database): { applied: string[]; version: string }`
- `GET /v1/healthz -> {status:"ok", version, uptimeSeconds}`
- `GET /v1/readyz -> {status:"ready", checks:{database:"ok"}}` atau 503.

**Steps:**

- [ ] Write failing migration test: empty temp DB -> migrate -> tables exist; second
      migrate is no-op; foreign_keys ON.
- [ ] Run test; expect fail.
- [ ] Implement client/migrate/001_init with tables/indices from
      `docs/ARCHITECTURE.md`; pragmas WAL, foreign_keys, busy_timeout, synchronous.
- [ ] Write failing health test: healthz 200 without secrets; readyz 200; closed DB
      readyz 503.
- [ ] Implement config (Zod env; fail fast on missing pepper in production), app,
      routes, graceful shutdown.
- [ ] `npm install`, `npm run typecheck`, `npm test`.
- [ ] Commit.

**Acceptance:** migration idempotent, health/ready works, no secret in response/log.

---

### Task 2 — Password/token primitives, bootstrap admin, auth

**Files:**

- Create: `src/auth/password.ts`, `src/auth/tokens.ts`, `src/auth/parent-auth.ts`,
  `src/repositories/users.ts`, `src/repositories/families.ts`,
  `src/repositories/sessions.ts`, `src/modules/auth/routes.ts`,
  `scripts/admin-create.ts`.
- Test: `test/auth.test.ts`, `test/tokens.test.ts`.

**Interfaces:**

- `hashPassword(password: string): Promise<string>`
- `verifyPassword(hash: string, password: string): Promise<boolean>`
- `createOpaqueToken(): { token: string; hash: string }`
- `hashToken(token: string): string`
- `requireParent(request, reply): Promise<void>` -> `request.parent = {userId, familyId, role}`
- `POST /v1/auth/login -> AuthTokens`
- `POST /v1/auth/refresh -> AuthTokens`
- `POST /v1/auth/logout -> 204`

**Steps:**

- [ ] Test Argon2id verify/reject; token hash deterministic; timing-safe compare.
- [ ] Implement password/token helpers; no secret logging.
- [ ] Test admin-create: creates owner/family once; refuses duplicate; password min 16;
      never reads password from argv.
- [ ] Implement CLI using env/stdin.
- [ ] Test login success, wrong password and unknown email produce same 401, rate limit,
      access token auth, refresh rotation, old refresh 401, logout revokes access,
      expired access (fake clock).
- [ ] Implement auth routes/repositories; no public signup route.
- [ ] Run tests/typecheck; commit.

**Acceptance:** no public signup; tokens revocable; refresh rotation; generic login error.

---

### Task 3 — Devices, membership, ownership, IDOR

**Files:**

- Create: `src/repositories/devices.ts`, `src/repositories/credentials.ts`,
  `src/modules/devices/routes.ts`, `src/auth/device-auth.ts`,
  `test/helpers/fixtures.ts`.
- Test: `test/idor.test.ts`, `test/devices.test.ts`.

**Interfaces:**

- `GET /v1/devices -> {items: DeviceSummary[], nextCursor: string|null}`
- `GET /v1/devices/:id -> DeviceDetail`
- `DELETE /v1/devices/:id -> 204` (revoke)
- `requireDevice` -> `request.device = {deviceId, familyId}`

**Steps:**

- [ ] Test: Parent A cannot GET/DELETE device B (404, not 403 leak); device A cannot
      use Parent endpoint; device B cannot ACK command A.
- [ ] Implement device repository with mandatory `familyId` scope.
- [ ] Test revoke: status REVOKED, credential revoked, queued commands CANCELLED,
      subsequent device request 401, idempotent DELETE.
- [ ] Implement revoke transaction + audit hook.
- [ ] Run tests; commit.

**Acceptance:** all cross-family access denied; revocation immediate.

---

### Task 4 — Pairing dua arah

**Files:**

- Create: `src/domain/pairing-state.ts`, `src/repositories/pairing.ts`,
  `src/modules/pairing/routes.ts`, `src/modules/device-self/enrollment.ts`,
  `src/lib/pairing-code.ts`.
- Test: `test/pairing.test.ts`.

**Interfaces:**

- `POST /v1/pairing-requests -> {id, code, expiresAt, status:"OPEN"}`
- `GET /v1/pairing-requests/:id -> PairingRequest`
- `POST /v1/pairing-requests/:id/approve {verificationCode} -> PairingRequest`
- `POST /v1/pairing-requests/:id/reject {reason?} -> PairingRequest`
- `POST /v1/enrollment/claim {code, deviceSecret, device} -> EnrollmentClaim`
- `POST /v1/enrollment/:id/confirm-local {accepted, disclosureVersion} -> EnrollmentStatus`
- `GET /v1/enrollment/:id -> EnrollmentStatus`

**Steps:**

- [ ] Unit test pairing state transitions (OPEN -> CLAIMED -> LOCAL_CONFIRMED ->
      APPROVED/REJECTED/EXPIRED; no invalid transitions).
- [ ] Test create: 8-digit code, HMAC stored (not plaintext), TTL, audit.
- [ ] Test claim: wrong code increments attempt; 5 attempts kills code; expired/reused
      code rejected; valid claim creates PENDING device + inactive credential + claim
      token; code cannot be reused.
- [ ] Test claim retry dengan kode + device secret yang sama: idempotent, claim token
      dirotasi, tidak membuat device ganda; secret berbeda ditolak.
- [ ] Test local consent required; claim token wrong/expired rejected; duplicate confirm
      idempotent.
- [ ] Test Parent approve: requires LOCAL_CONFIRMED, verification code match, same
      family; activates device/credential; duplicate approve idempotent; wrong/expired
      409; reject revokes; cross-family 404.
- [ ] Test approval does not return device secret; only hash stored; no secret in logs.
- [ ] Test transaksi rollback: jika aktivasi credential gagal, device tetap PENDING dan
      pairing tidak APPROVED; tidak ada state setengah jadi.
- [ ] Implement routes/repositories in transaction; run tests; commit.

**Acceptance:** code alone cannot activate; both approvals required; no plaintext device
secret in DB; TTL/rate limits work.

---

### Task 5 — Status snapshot

**Files:**

- Create: `src/repositories/status.ts`, `src/modules/device-self/status.ts`,
  `src/modules/devices/status.ts`, `src/domain/capabilities.ts`.
- Test: `test/status.test.ts`.

**Interfaces:**

- `POST /v1/device-self/status -> DeviceStatus`
- `GET /v1/devices/:id/status -> DeviceStatus`
- `DeviceStatusReport` fields: batteryLevel, charging, networkConnected,
  backendReachable, screenInteractive, keyguardLocked, observedAt, sequence,
  capabilities.

**Steps:**

- [ ] Test: null/unknown fields accepted and returned as null; booleans validated;
      sequence out-of-order does not overwrite newer; `receivedAt` server time;
      `stale` computed from `STATUS_STALE_SECONDS`; cross-family denied.
- [ ] Implement upsert transaction with sequence check; capabilities JSON validated.
- [ ] Test device revoked cannot report; Parent cannot POST status.
- [ ] Implement; run tests; commit.

**Acceptance:** stale/unknown honest; no guessing; lastSeenAt separate from receivedAt.

---

### Task 6 — Command queue, ACK, state machine

**Files:**

- Create: `src/domain/command-state.ts`, `src/repositories/commands.ts`,
  `src/modules/commands/routes.ts`, `src/modules/device-self/commands.ts`,
  `src/jobs/sweeper.ts`.
- Test: `test/state-machine.test.ts`, `test/commands.test.ts`.

**Interfaces:**

- `GET /v1/devices/:id/commands?limit&cursor -> CommandList`
- `POST /v1/devices/:id/commands` body `{type, payload, expectedPolicyRevision?}`,
  header `Idempotency-Key`, -> 201 Command
- `POST /v1/devices/:id/commands/:commandId/cancel -> Command`
- `GET /v1/device-self/commands?limit -> {items: DeviceCommand[], serverTime}`
- `POST /v1/device-self/commands/:id/ack` body `{ackId,status,result?,error?,observedAt?}`
- `transition(current: CommandState, event: AckEvent): CommandState` (pure)

**Steps:**

- [ ] Unit test transition table from `docs/COMMAND_STATE_MACHINE.md`, including
      invalid transitions.
- [ ] Test create: only supported types, ownership, expiry, queue cap 20, idempotency
      key returns same command, audit.
- [ ] Test fetch: QUEUED only, expired not returned, no state change, `serverTime`.
- [ ] Test ACK: must be device owner; `RECEIVED` required before execute; duplicate
      ackId 200 idempotent; same status 200; conflict 409; final immutable; expired
      ACK rules; late final after timeout 409.
- [ ] Test cancel race: cancel succeeds while QUEUED; ACK RECEIVED after cancel 409;
      cancel after RECEIVED 409.
- [ ] Test sweeper: QUEUED/RECEIVED expiry -> EXPIRED; EXECUTING lease -> FAILED;
      no requeue.
- [ ] Implement transactions and routes; run tests; commit.

**Acceptance:** no false success; expired command never executed; duplicate ACK safe;
ownership enforced.

---

### Task 7 — Simulator Companion

**Files:**

- Create: `tools/device-simulator/package.json`, `src/index.ts`, `README.md`.
- Test: `tools/device-simulator/test/simulator.test.ts`.

**Interfaces:**

- CLI: `--base-url`, `--device-secret`, `--scenario offline|delay-ack|duplicate-ack|expired|status`.
- Output always starts with `SIMULATOR`.
- `runSimulator(config, fetchImpl)` for tests.

**Steps:**

- [ ] Test offline scenario: no fetch; queued remains; reconnect fetch works.
- [ ] Test delayed ACK: state stays QUEUED until ACK; no execution claim.
- [ ] Test duplicate ACK: second ACK idempotent, no double effect.
- [ ] Test expired: command not executed; reports EXPIRED.
- [ ] Test status scenario posts battery/network/screen/keyguard with `observedAt`.
- [ ] Implement CLI + tests; run; commit.

**Acceptance:** simulator explicitly labeled; never claims to be Android control.

---

### Task 8 — Audit, retention, OpenAPI, E2E

**Files:**

- Create: `src/repositories/audit.ts`, `scripts/prune.ts`, `scripts/openapi-export.ts`,
  `test/openapi.test.ts`, `test/e2e.test.ts`, `test/restart.test.ts`.
- Update: `contracts/openapi.yaml` (reconcile with implemented routes), `README.md`,
  `docs/TEST_PLAN.md` if evidence/commands change.
- Create: `contracts/examples/*.json` (command, status, pairing).

**Steps:**

- [ ] Test audit entries for pairing/approve/reject/revoke/command final; no secrets.
- [ ] Test prune dry-run deletes only older than retention; does not delete current
      status; refuses without confirmation.
- [ ] Export OpenAPI; validate with `@apidevtools/swagger-parser`; assert paths/schemas;
      contract examples parse.
- [ ] E2E: two families; login; pairing; local confirm; approve; status; command;
      ACK; duplicate ACK; expired; cross-family; revoke; restart backend and continue.
- [ ] Run full `npm test`, `npm run typecheck`, `npm run openapi:export`, `npm run migrate`.
- [ ] Update docs with actual commands/results; commit.

**Acceptance:** E2E passes; OpenAPI valid; restart preserves state; no secrets in logs;
README commands tested.

---

### Verification commands (Stage 1)

```bash
npm ci
npm run typecheck
npm test
npm run migrate
npm run openapi:export
```

Belum dijalankan karena implementasi belum ada. Jangan menulis “lulus” sebelum output
nyata tersedia.

## 5. Tahap 2 dan seterusnya (ringkas)

### Tahap 2 — Dua APK, login, pairing, status

- Prasyarat: JDK 21 + Android SDK/Studio + emulator; persetujuan instalasi.
- Parent: login, daftar perangkat, pairing, detail/status, riwayat command.
- Companion: onboarding, pairing/consent, checklist izin, status, riwayat.
- Transport: HTTP saat aktif; WebSocket opsional foreground; WorkManager periodic.
- Status: battery, charging, network, backendReachable, screenInteractive,
  keyguardLocked, observedAt, lastSeenAt; unknown/null.
- Test: auth expired, pairing salah, ownership, jaringan berganti, status stale,
  app restart, credential revoked.
- Build APK jika SDK ada; jika tidak, laporkan hambatan.
- Belum lock/VPN/Telegram/managed.

### Tahap 3 — LOCK_SCREEN

- Device Admin minimal force-lock; onboarding transparan.
- Tanpa wipe/reset password.
- Backend cek ownership/expiry; Companion cek capability/expiry/dedup.
- ACK results; UI membedakan queued/received/executing/success/failed/expired.
- Uji admin off/on, layar mati, background, duplicate, expired, reboot.

### Tahap 4 — Policy lokal

- Persisten, revision check, jadwal, temporary allowance jika capability.
- Uji reboot, timezone, proses mati, izin dicabut.
- Exact alarm tidak dipakai; toleransi dijelaskan.
- Managed mode/provisioning keputusan terpisah.

### Tahap 4M — Managed mode (opsional)

- Device Owner/Profile Owner; factory reset/provisioning manual.
- Suspend/resume aplikasi, uninstall block; audit; jangan klaim tahan-uninstall.
- Perlu review Play/legal dan persetujuan pengguna.

### Tahap 5 — Telegram

- Adapter ke service yang sama; tidak ada database policy terpisah.
- Allowlist user ID + ownership; token di server; audit.
- Tidak dimulai sebelum dua APK stabil.

### Tahap 6 — VPN blocking

- Audit API/izin; VpnService consent; IPv4/IPv6; allow controller/backend.
- Recovery lokal; no interception/logging isi trafik.
- Uji boot/Wi-Fi/seluler/airplane/VPN conflict.

## 6. Keputusan yang menunggu persetujuan

| ID | Keputusan | Rekomendasi | Dampak jika berbeda |
|---|---|---|---|
| D-01 | Latensi background tanpa FCM | Terima best-effort untuk MVP; UI queued | Jika instan wajib: FCM/arsitektur baru |
| D-02 | Managed mode/Device Owner | Tunda; standar dulu | Butuh factory reset, provisioning, review |
| D-03 | Distribusi | Sideload/private untuk demo; Play nanti | Play review device admin/FGS/VPN/Families |
| D-04 | Perangkat target | minSdk 28, target 37; uji API 28-37 | Perlu device matrix nyata |
| D-05 | VPS/domain/backup | Inventory sebelum deploy | Tidak boleh deploy |
| D-06 | Retensi | 30 hari default | Perlu keputusan hukum |
| D-07 | Recovery akun | Tunda; tanpa backdoor | Perlu desain terpisah |
| D-08 | Histori status | Snapshot terakhir saja | Histori menambah data/retensi |
| D-09 | Telegram | Tahap 5, opsional | Tidak memengaruhi MVP |
| D-10 | Enkripsi DB | Full-disk VPS + backup terenkripsi | SQLCipher jika data-at-rest wajib |
| D-11 | Certificate pinning | Tidak untuk MVP | Pinning menambah risiko operasional |
| D-12 | Play Integrity | Tunda | Attestation menambah dependency Google |

## 7. Guardrail deployment

Jangan lakukan sampai ada persetujuan tertulis:

- membuat/mengubah `infra/compose.yaml` final;
- menghubungkan ke database live;
- membuka port, firewall, DNS, atau Caddy;
- menjalankan migrasi pada data production;
- prune/backup restore di production;
- provisioning Device Owner atau reset perangkat.

Urutan yang benar: staging lokal -> backup/restore test -> review keamanan -> staging
VPS -> observability -> production canary -> rollback test.