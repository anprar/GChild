# Test Plan — GChild

Status: Tahap 0. Belum ada test yang dijalankan karena belum ada implementasi.
Tanggal: 2026-11-02.

## 1. Tujuan

Memastikan GChild:

- membatasi akses per keluarga;
- membedakan state command dengan benar;
- tidak mengeksekusi command expired;
- menangani ACK duplikat/terlambat dan restart backend;
- menampilkan status unknown/stale secara jujur;
- tidak memakai izin atau background mechanism yang tidak sah;
- tidak membocorkan secret;
- tidak diklaim andal di perangkat fisik tanpa bukti.

## 2. Level test

| Level | Cakupan | Tool | Dijalankan di |
|---|---|---|---|
| Unit backend | State machine, token, validasi, expiry, pairing state | Vitest | Node lokal |
| Integration backend | Route + SQLite + transaksi + auth | Vitest + Fastify inject | Node lokal |
| Contract | OpenAPI, contoh JSON, field wajib/enum | swagger-parser + Vitest | Node lokal |
| E2E simulator | Parent -> pairing -> status -> command -> ACK | Vitest + server port 0 | Node lokal |
| Android unit | Repository, view model, state mapping, policy engine | JUnit/Kotlin test | JVM |
| Android instrumented | Room, Keystore SecretStore, WorkManager, DeviceAdmin | AndroidX Test | Emulator |
| Android physical | Background, Doze, OEM, lock, VPN, status | Manual + adb/logcat | Perangkat target |
| Security | IDOR, replay, expiry, rate limit, secret leak | Automated + manual review | Node/emulator |
| Performance/battery | Latency, memory, battery, DB growth | Manual + Android Studio profiler | Perangkat |

## 3. Prinsip bukti

- Automated test harus benar-benar dijalankan; tempel perintah dan ringkasan output.
- Emulator bukan perangkat fisik. Jangan menyebut fitur background “andal” hanya dari
  emulator.
- Setiap bug/regression memiliki test yang gagal sebelum fix.
- Test yang tidak dapat dijalankan dicatat sebagai hambatan, bukan dilewati diam-diam.
- Data test tidak boleh memakai secret produksi.
- Test fixture boleh memakai data sintetis; production path tidak boleh fallback ke
  fixture/mock.

## 4. Test data dan isolasi

- Dua keluarga: Family A (Parent A, Device A1/A2), Family B (Parent B, Device B1).
- Parent A tidak boleh melihat/mengubah B1.
- Device A1 tidak boleh meng-ACK command A2/B1.
- Token/pairing code/secret dibuat acak per test; tidak ada nilai tetap yang terlihat
  seperti secret produksi.
- Database test memakai file temporer (`mkdtemp`) atau `:memory:` untuk unit; gunakan
  file untuk restart/backup test.
- Simulator diberi label `SIMULATOR` di output.

## 5. Matriks test backend

### 5.1 Auth

| ID | Kasus | Harapan |
|---|---|---|
| AUTH-01 | Login valid | 200, access+refresh, expiry wajar |
| AUTH-02 | Password salah | 401 generik, tidak membocorkan email ada/tidak |
| AUTH-03 | Email tidak ada | 401 generik, waktu respons tidak ekstrem |
| AUTH-04 | Access token invalid/expired | 401 |
| AUTH-05 | Refresh valid | Token baru; refresh lama 401 |
| AUTH-06 | Refresh dicabut | 401 |
| AUTH-07 | Logout | Access/refresh berikutnya 401 |
| AUTH-08 | Public signup | 404 (tidak ada route) |
| AUTH-09 | Rate limit login | 429 + `Retry-After` |
| AUTH-10 | Bootstrap admin duplikat | Ditolak, tidak menimpa user |
| AUTH-11 | Password hash | Argon2id; bukan plaintext/SHA cepat |
| AUTH-12 | Log | Tidak ada password/token |

### 5.2 Devices/ownership

| ID | Kasus | Harapan |
|---|---|---|
| DEV-01 | Parent A list devices | Hanya device family A |
| DEV-02 | Parent A GET device B | 404 (tidak bocor) |
| DEV-03 | Parent A DELETE device B | 404, tidak ada perubahan |
| DEV-04 | Device A1 akses endpoint Parent | 401/403 |
| DEV-05 | Parent akses endpoint device-self | 401/403 |
| DEV-06 | Device B1 ACK command A1 | 404/403 |
| DEV-07 | Revoke device | Credential mati; queued command CANCELLED; audit |
| DEV-08 | Revoke idempotent | 204 kedua, tidak error |
| DEV-09 | Device revoked fetch/status | 401 |

### 5.3 Pairing

| ID | Kasus | Harapan |
|---|---|---|
| PAIR-01 | Create code | 8 digit, TTL 10 menit, hash di DB, audit |
| PAIR-02 | Claim valid | Device PENDING, credential inactive, claim token, verification code |
| PAIR-03 | Claim kode salah | 400/401 generik; attempt bertambah |
| PAIR-04 | Claim 5x salah | Kode mati/expired; tidak bisa dipakai |
| PAIR-05 | Claim kode expired | 410; tidak membuat device |
| PAIR-06 | Claim kode reused | Ditolak |
| PAIR-07 | Claim token salah | 401 |
| PAIR-08 | Confirm-local sebelum claim | Ditolak |
| PAIR-09 | Parent approve tanpa local | 409 |
| PAIR-10 | Parent approve kode verifikasi salah | 409 |
| PAIR-11 | Parent approve family lain | 404 |
| PAIR-12 | Parent approve valid | Device/credential ACTIVE; audit |
| PAIR-13 | Duplicate approve | Idempotent 200; tidak menggandakan |
| PAIR-14 | Reject | Device/credential revoked; Companion melihat rejected |
| PAIR-15 | Claim/approve expired | 410; tidak aktif |
| PAIR-16 | Device secret | Tidak dikembalikan API; DB hanya hash |
| PAIR-17 | Log pairing | Tidak ada kode/claim token/secret |
| PAIR-18 | Rate limit claim | 429 |
| PAIR-19 | Claim retry kode+secret sama | Idempotent; claim token baru; tidak ada device ganda |
| PAIR-20 | Claim retry secret berbeda | Ditolak; tidak mengambil alih enrollment |

### 5.4 Status

| ID | Kasus | Harapan |
|---|---|---|
| STAT-01 | Report lengkap | 200; receivedAt server; stale false |
| STAT-02 | Field tidak diketahui | null, bukan 0/false |
| STAT-03 | Sequence lebih lama | Tidak menimpa snapshot baru |
| STAT-04 | Sequence sama | Idempotent/terima sesuai aturan |
| STAT-05 | Stale | `stale=true` setelah threshold |
| STAT-06 | Parent A baca B | 404 |
| STAT-07 | Device revoked report | 401 |
| STAT-08 | Parent POST status | 401/403 |
| STAT-09 | observedAt masa depan | Diterima sebagai data perangkat; tidak dipakai expiry |
| STAT-10 | Backend reachable | Semantik jelas; tidak diklaim realtime |

### 5.5 Command/ACK

| ID | Kasus | Harapan |
|---|---|---|
| CMD-01 | Create valid | 201 `QUEUED`, expiry |
| CMD-02 | Create tipe tidak didukung | 400/422 |
| CMD-03 | Create device family lain | 404 |
| CMD-04 | Create device revoked | 409 |
| CMD-05 | Queue cap 20 | 429/409 `COMMAND_QUEUE_FULL` |
| CMD-06 | Idempotency-Key sama | Command sama, bukan duplikat |
| CMD-07 | Fetch | Hanya QUEUED belum expired; state tidak berubah |
| CMD-08 | ACK RECEIVED | QUEUED -> RECEIVED; device boleh eksekusi |
| CMD-09 | ACK tanpa RECEIVED | 409; device tidak boleh eksekusi |
| CMD-10 | Duplicate ackId | 200 idempotent; satu result |
| CMD-11 | Same status different ackId | 200 idempotent |
| CMD-12 | Conflicting final | 409; state lama tetap |
| CMD-13 | Out-of-order ACK | Ditolak/idempotent sesuai tabel |
| CMD-14 | Expired fetch | Tidak dikirim; state EXPIRED |
| CMD-15 | Expired ACK | Tidak dieksekusi; EXPIRED |
| CMD-16 | Cancel QUEUED | CANCELLED |
| CMD-17 | Cancel after RECEIVED | 409 |
| CMD-18 | Cancel race | ACK RECEIVED setelah cancel 409; no execute |
| CMD-19 | Lease timeout EXECUTING | FAILED, tidak requeue; RECEIVED lewat TTL -> EXPIRED |
| CMD-20 | Late final after timeout | 409; final lama tetap |
| CMD-21 | Cross-device ACK | 404/403 |
| CMD-22 | Parent melihat state | Label tidak “sukses” sebelum final |
| CMD-23 | Restart backend | Command/session/status tetap; sweeper tidak ganda |
| CMD-24 | Log | Tidak ada payload sensitif/token |

### 5.6 Audit, migrasi, OpenAPI

| ID | Kasus | Harapan |
|---|---|---|
| AUD-01 | Pairing/approve/revoke/command final | Audit tercatat, no secret |
| AUD-02 | Prune dry-run | Tidak menghapus; menampilkan jumlah |
| AUD-03 | Prune retention | Hanya data lama; status terakhir tetap |
| MIG-01 | Migrasi DB kosong | Semua tabel/index |
| MIG-02 | Migrasi kedua | No-op/idempotent |
| MIG-03 | Foreign key | Pelanggaran ditolak |
| MIG-04 | Backup/restore | Data utuh; hash tetap; app bisa start |
| API-01 | OpenAPI valid | swagger-parser lulus |
| API-02 | Route vs kontrak | Path/enum/field sesuai |
| API-03 | Contoh JSON | Valid terhadap schema |
| API-04 | Body oversize/malformed | 400/413; tidak crash |

## 6. Test Android

### 6.1 Unit/JVM

- Mapping DTO -> UI state.
- Repository cache/refresh/error.
- Command state mapping; tidak menampilkan sukses prematur.
- Deduplikasi command.
- Pending ACK queue idempotent.
- Policy engine (Tahap 4): schedule, timezone, expiry, reboot simulation.
- Capability -> enabled/disabled button.

### 6.2 Instrumented/emulator

- Room migration dan query.
- SecretStore: simpan/baca, key invalid -> clear, no plaintext fallback.
- WorkManager scheduling/constraints (bukan klaim realtime).
- DeviceAdminReceiver activation/deactivation (emulator bila memungkinkan).
- Keystore behavior setelah app data clear.
- Network switch Wi-Fi/cellular/airplane.
- App restart dan process death.
- Notification permission (API 33+).
- `allowBackup=false`/backup rules.

### 6.3 Physical device (wajib untuk klaim)

- Lock saat layar mati, app background, Doze.
- Device Admin aktif/nonaktif; dialog sistem.
- WorkManager setelah reboot dan OEM battery saver.
- Force-stop: tidak ada eksekusi sampai app dibuka.
- Screen/keyguard state pada OEM lock screen.
- Battery/charging reporting.
- Keandalan WebSocket foreground saat network switch/screen off.
- Credential revoke saat app background/foreground.
- Update APK tanpa kehilangan pairing.
- Uninstall/reinstall: secret hilang; harus pairing ulang.
- Time/timezone change.
- Usage access (Tahap 4).
- VPN blocking/recovery (Tahap 6).

### 6.4 Perintah adb yang direncanakan

```bash
adb shell dumpsys deviceidle force-idle
adb shell dumpsys deviceidle unforce
adb shell am set-standby-bucket com.gchild.companion rare
adb shell am get-standby-bucket com.gchild.companion
adb shell am force-stop com.gchild.companion
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED com.gchild.companion
adb shell dumpsys battery set level 15
adb shell dumpsys battery unplug
adb shell dumpsys battery reset
adb shell settings put global airplane_mode_on 1
adb shell am broadcast -a android.intent.action.AIRPLANE_MODE
```

Perintah ini belum dijalankan; hanya rencana.

## 7. Test keamanan

Wajib ada sebelum Stage 1 dianggap selesai:

1. Cross-family access untuk setiap endpoint (GET/POST/DELETE).
2. Parent/device auth scheme terpisah.
3. Access/refresh expired/revoked/logout.
4. Refresh rotation; old refresh rejected.
5. Pairing code attempt limit, TTL, reuse, brute force rate.
6. Claim token wrong/expired; local consent required.
7. Parent approval wrong family/verification code.
8. Command idempotency, duplicate ACK, conflicting final, cancel race.
9. Expired command not delivered/executed.
10. Revoked device cannot fetch/report/ACK.
11. Body size/malformed JSON/extra fields.
12. Rate limits login/pairing/command/ACK.
13. Logs/DB grep for secrets.
14. Migration/backup restore.
15. Restart backend with in-flight command.
16. Status out-of-order/stale.
17. No cleartext HTTP in release config (Stage 2).
18. Android permissions manifest review (Stage 2+).
19. No Accessibility/notification/location/camera/mic/SMS permissions.
20. UI never shows success before final ACK.

## 8. Test kontrak

- `contracts/openapi.yaml` valid OpenAPI 3.0.3.
- Setiap path yang diimplementasikan ada di kontrak; tidak ada path kontrak Stage 1
  yang belum diimplementasikan tanpa penanda `x-stage`.
- Enum `CommandState`, `AckStatus`, `PairingStatus`, `CommandType` sama dengan kode.
- Contoh `contracts/examples/*.json` valid.
- Kotlin DTO (Stage 2) dapat men-deserialize contoh; field nullable sesuai.
- Perubahan kontrak breaking menaikkan versi API.

## 9. Performance dan baterai

Backend:

- Latency p50/p95 untuk login, status, command create/fetch/ACK pada DB kecil.
- Ukuran DB setelah 1.000 command/status; prune.
- Rate limit tidak mengunci user normal.
- Memory stabil setelah restart/load.

Android:

- Dampak WorkManager periodic terhadap baterai (perangkat fisik).
- Ukuran Room setelah history/pending ACK dibatasi.
- Tidak ada wake lock terus-menerus.
- WebSocket foreground tidak bocor saat activity pause.
- Status collection tidak memblokir main thread.

Belum ada target angka sebelum pengukuran; jangan mengarang SLA.

## 10. Matriks perangkat manual

| Perangkat | OS | OEM | Status | Test |
|---|---|---|---|---|
| TBD | Android 9 (28) | TBD | Belum ada | pairing/status/basic |
| TBD | Android 11 (30) | TBD | Belum ada | background/WorkManager |
| TBD | Android 13 (33) | TBD | Belum ada | notification permission |
| TBD | Android 14 (34) | TBD | Belum ada | FGS/boot restrictions |
| TBD | Android 15 (35) | TBD | Belum ada | dataSync timeout |
| TBD | Android 16 (36) | TBD | Belum ada | target 36 behavior |
| TBD | Android 17 (37) | TBD | Belum ada | target 37 behavior |

Minimal satu perangkat fisik dengan OEM yang umum di pasar target. Emulator
melengkapi, bukan menggantikan.

## 11. Bukti dan pelaporan

Setiap laporan test mencantumkan:

- perintah/step;
- lingkungan (OS, Node, API level, perangkat/OEM);
- hasil aktual (bukan ringkasan “OK” tanpa output);
- kegagalan dan log yang sudah diredaksi;
- yang belum diuji dan alasannya;
- apakah automated, emulator, atau physical.

Format status:

```text
[PASS/FAIL/BLOCKED] ID — kasus
Environment: ...
Command: ...
Result: ...
Notes: ...
```

## 12. Exit criteria

### Stage 1

- Semua test backend wajib lulus.
- E2E simulator lulus.
- OpenAPI valid.
- Restart/migrasi/backup test lulus.
- Tidak ada secret di repo/log.
- Laporan menyebut yang belum diuji (Android, VPS).

### Stage 2

- Build APK berhasil (jika SDK tersedia).
- Pairing/status pada dua perangkat/emulator.
- Status stale/unknown benar.
- Reconnect/app restart/credential revoked.
- Belum ada klaim background andal tanpa physical test.

### Stage 3

- Lock berhasil dengan admin aktif; gagal jelas tanpa admin.
- ACK final dan UI state benar.
- Uji layar mati/background/duplicate/expired.
- Physical device target.

### Stage 4+

- Setiap fitur memiliki test sesuai `docs/ANDROID_CAPABILITIES.md` dan
  `docs/IMPLEMENTATION_PLAN.md`.

## 13. Yang belum dapat diuji sekarang

- Build/test Android: SDK/Studio/adb/emulator tidak ada.
- Perangkat fisik: belum terdaftar.
- Docker/Caddy/backup encryption: Docker/OpenSSL tidak ada.
- VPS: tidak diakses.
- Native install better-sqlite3/argon2: belum dicoba.
- Play policy review: proses eksternal.

Semua ini harus dilaporkan sebagai hambatan, bukan dilewati.