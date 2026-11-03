# Threat Model — GChild

Status: Tahap 0, berbasis desain. Belum ada implementasi yang diaudit.
Tanggal: 2026-11-02.

## 1. Ruang lingkup dan metode

Model ini mencakup:

- GChild Parent, GChild Companion, backend Fastify/SQLite, Caddy/VPS, database,
  backup, log, dan alur pairing/command/status.
- Aktor jahat dari internet, aplikasi lain di perangkat, orang dengan akses fisik,
  anggota keluarga, operator VPS, dan supply chain dependency.
- Penyalahgunaan produk (stalkerware/coercive control).

Tidak mencakup: keamanan fisik tingkat chip, exploit kernel/Android, atau serangan
yang membutuhkan perangkat root/kompromi penuh. Jika perangkat di-root, jaminan
Keystore/sandbox berkurang dan harus dicatat sebagai residual risk.

Metode: identifikasi aset -> trust boundary -> ancaman -> mitigasi -> residual -> test.
Severity memakai dampak x kemungkinan secara kualitatif (High/Medium/Low).

## 2. Aset

| Aset | Mengapa penting |
|---|---|
| Password Parent | Akses penuh ke keluarga/perangkat. |
| Access/refresh token Parent | Sesi Parent; dapat mengirim command. |
| Device credential Companion | Dapat melapor status/ACK sebagai perangkat. |
| Pairing code, claim token, verification code | Bootstrap akses perangkat. |
| Device secret | Autentikasi perangkat; disimpan di Keystore. |
| Data keluarga/perangkat | Metadata, status, riwayat command. |
| Integritas command | Lock/policy yang salah dapat mengganggu perangkat. |
| Audit log | Investigasi dan akuntabilitas. |
| Database/backup | Seluruh data dan hash secret. |
| Availability backend/Companion | Parent tidak bisa melihat/mengirim command. |
| Reputasi/legal | Produk tidak boleh menjadi spyware. |

## 3. Aktor

| Aktor | Motivasi/kemampuan |
|---|---|
| Attacker internet | Menebak kredensial, pairing code, mengeksploitasi API. |
| Malicious app di perangkat | Mencuri token/file, membaca notifikasi, mengirim intent. |
| Pencuri perangkat | Akses fisik, mencoba membuka app/data. |
| Anggota keluarga/kerabat | Akses tidak sah ke akun Parent atau perangkat. |
| Orang tua yang abusif | Memasang pengawasan diam-diam/coercive control. |
| Anak/perangkat user | Mencoba melewati pembatasan/uninstall. |
| Operator VPS | Akses ke DB/log/backup. |
| Supply chain | Dependency/package berbahaya. |
| Pihak ketiga (Play, Caddy, CA) | Kebijakan, certificate, distribusi. |

## 4. Trust boundary

```text
[Parent app] --TLS--> [Caddy/edge] --loopback--> [Fastify] --process--> [SQLite]
      |                                                |
      | Android sandbox/Keystore                        +--> [backup storage]
      |
[Companion app] --TLS--> [Caddy/edge]                  [VPS operator]
      |
      +--> [Android DevicePolicyManager/OS]
      +--> [Room/DataStore/Keystore]
```

Boundary penting:

1. Jaringan publik ke Caddy: semua input tidak dipercaya.
2. Caddy ke Fastify: loopback; header proxy harus dikonfigurasi hati-hati.
3. Fastify ke SQLite: SQL injection/IDOR/transaksi.
4. App ke Android OS: izin, Device Admin, Keystore, background restrictions.
5. Pairing out-of-band: kode dibaca manusia; bisa salah/phyishing.
6. VPS operator/backup: akses fisik/logis ke data.
7. Build/release: APK signing, dependency, secret.

## 5. Daftar ancaman

| ID | Ancaman | Dampak | Kemungkinan | Mitigasi | Residual | Test |
|---|---|---|---|---|---|---|
| T-01 | IDOR: Parent A membaca/mengontrol device B | High | Medium | Semua query pakai `family_id` session; repository scoped; 404 generik; test cross-family | Bug implementasi | Automated cross-family untuk semua endpoint |
| T-02 | Pencurian access token Parent | High | Medium | Access 15 menit; disimpan Keystore; TLS; revoke; tidak di log; rotasi refresh | Malware dengan akses app/root | Token theft simulation, log grep |
| T-03 | Refresh token dicuri/dipakai ulang | High | Medium | Refresh 30 hari, rotasi, revoke; session hash; logout | Belum ada reuse detection keluarga | Refresh rotation test; revoked token test |
| T-04 | Device credential dicuri | High | Low-Med | Scoped ke device; hash server; Keystore; revoke; tidak bisa endpoint Parent | Root/physical compromise | Revoked credential 401; endpoint scope test |
| T-05 | Brute force pairing code | High | Medium | 8 digit, TTL 10 menit, max 5 attempt per code, rate limit IP, HMAC pepper | Serangan terdistribusi sebelum TTL | Attempt limit + rate limit test |
| T-06 | Pairing claim hijack/MITM | High | Low | TLS; claim token acak; local consent; parent approval; verification code; TTL | Parent ceroboh / CA compromise | Wrong token/expired claim test |
| T-07 | Parent menyetujui perangkat palsu | High | Low-Med | Tampilkan metadata + verification code; cocokkan dengan layar Companion; audit; reject | Tidak ada attestation | Manual two-device test |
| T-08 | Command replay/duplikasi | Medium | Medium | Command ID unik; ACK idempotent `(command, ackId)`; dedup device; final state immutable | Device bug | Duplicate ACK + duplicate delivery test |
| T-09 | Command expired dieksekusi setelah reconnect | High | Medium | Server tidak mengirim expired; device cek expiry; terminal state; test | Clock skew ekstrem | Expired reconnect test |
| T-10 | ACK palsu dari Parent/device lain | High | Low | Skema auth terpisah; ACK hanya device pemilik command; ownership check; audit | Token theft | Cross-device ACK 404/403 |
| T-11 | Command flooding/DoS | Medium | Medium | Rate limit, queue max 20, body limit, TTL; index DB | Serangan terdistribusi | Load/rate test |
| T-12 | Status palsu/stale | Medium | Medium | Device auth; `observedAt`/`receivedAt`; sequence; stale flag; UI label | Device compromised | Out-of-order sequence, stale test |
| T-13 | VPS/DB dikompromikan | High | Low-Med | Hash secret; minimisasi data; file permission; full-disk encryption; backup encryption; log redaction; no plaintext token | Operator/admin akses | Review konfigurasi; backup inspection |
| T-14 | Backup bocor | High | Low-Med | Backup terenkripsi, akses terbatas, retensi, restore test; jangan backup file DB aktif | Key backup bocor | Restore test, access review |
| T-15 | Secret di log/error | High | Medium | Redaction header/body; error generik; test log; no body logging | Bug library | Automated log grep |
| T-16 | Brute force/credential stuffing login | High | High | Argon2id; rate limit IP+email; generic error; audit; password policy | Password lemah/dipakai ulang | Rate limit + Argon2 test |
| T-17 | Session fixation/CSRF | Medium | Low | Bearer token native, tanpa cookie; tidak ada CORS wildcard; logout revoke | Implementasi web future | Header/cookie test |
| T-18 | TLS MITM/downgrade | High | Low | HTTPS wajib; cleartext disabled; TLS 1.2+; Caddy; target 37 CT/ECH; no pinning MVP | CA/device compromise | TLS config test; cleartext attempt |
| T-19 | Malware/root di perangkat | High | Medium | Keystore, sandbox, no backup secret, TLS, revoke; deteksi root tidak dijanjikan | Root mem-bypass sandbox | Physical rooted device test (document only) |
| T-20 | Stalkerware/coercive control | High | Medium | App terlihat; consent lokal; pairing dua arah; no hidden icon; no sensitive data; revocation; Play Spyware policy | Relasi abusif tetap mungkin | UX review + policy review |
| T-21 | Anak menonaktifkan/menghapus app | Medium | High | Device Admin warning; managed mode opsional; no uninstall-proof claim | Standar tidak bisa mencegah | Admin disable/uninstall test |
| T-22 | Penyalahgunaan lock | Medium | Low | Hanya Parent family; audit; expiry; no unlock/wipe; UI konfirmasi | Parent abusif | Command auth + audit test |
| T-23 | VPN lockout | High | Medium | Allow controller; recovery UI; IPv4/IPv6; system disconnect; no intercept; test | Bug rute/DNS | Airplane/VPN/reboot test |
| T-24 | Supply chain dependency | High | Low-Med | Lockfile, versi terverifikasi, npm audit, minimal deps, review | Zero-day | `npm audit` + review |
| T-25 | Secret di Git/APK | High | Low-Med | `.gitignore`, no BuildConfig secret, env, secret scan, review | Human error | `git grep`/scan |
| T-26 | VPS terbuka (DB/port) | High | Medium | Bind loopback; firewall; Caddy; no DB port; SSH key; update | Misconfig | Inventory/review sebelum deploy |
| T-27 | DB corruption/restart | Medium | Medium | WAL, transaction, migrasi, backup, idempotent ACK, restart test | Disk failure | Restart + restore test |
| T-28 | Manipulasi jam/timezone | Medium | Medium | Expiry server; `serverTime`; elapsedRealtime; toleransi; UI label | Device clock salah | Time/timezone test |
| T-29 | Kebocoran notifikasi/layar | Medium | Medium | No sensitive notification content; FLAG_SECURE pada layar sensitif; no notification listener | Shoulder surfing | UI review |
| T-30 | Recovery/account takeover | High | Medium | No public recovery MVP; admin CLI; no master PIN; rate limit; audit | Proses support | Recovery design review |
| T-31 | Play policy rejection (spyware/FGS/VPN/admin) | High | Medium | Transparansi, consent, deklarasi, no hidden behavior, privacy policy | Kebijakan berubah | Pre-submission review |
| T-32 | Data anak/privasi hukum | High | Medium | Minimisasi, retention, consent, no ads/analytics, legal review | Yurisdiksi berbeda | Privacy review |
| T-33 | Pairing code phishing/social engineering | High | Medium | Edukasi UI, expiry, verification code, parent melihat metadata, revoke | Parent tertipu | UX/manual test |
| T-34 | DoS pada pairing/status | Medium | Medium | Rate limit, body limit, queue cap, index; monitoring | Resource VPS kecil | Load test |
| T-35 | Dependency/OS background berubah | Medium | High | Dokumentasi batasan; test matrix; no overclaim | Perubahan OS/OEM | Regression per API |

## 6. Privacy dan penyalahgunaan

### 6.1 Prinsip

- Data minimal: hanya status perangkat, metadata, command, dan audit.
- Tidak ada lokasi, kontak, SMS, chat, OTP, kamera, mikrofon, notifikasi pribadi,
  atau riwayat browsing.
- Tidak ada iklan, analytics pihak ketiga, atau penjualan data.
- Pengguna perangkat harus melihat aplikasi, penjelasan data, dan consent lokal.
- Tidak ada ikon tersembunyi atau penyamaran.
- Retensi default 30 hari; dapat dikonfigurasi; tampilkan kebijakan.
- Penghapusan/revocation harus jelas: apa yang dihapus, apa yang disimpan untuk audit.

### 6.2 Stalkerware/coercive control

GChild dapat disalahgunakan untuk mengontrol orang lain. Mitigasi:

- Pairing membutuhkan akses fisik ke Companion + persetujuan lokal + Parent approval.
- Aplikasi terlihat di launcher dan pengaturan; tidak ada penyamaran.
- Tidak ada remote install, remote unlock, remote wipe, atau pembacaan konten.
- Companion dapat memutuskan pairing; Parent mendapat audit.
- UI menjelaskan data yang dikirim dan cara mencabut.
- Kebijakan Play Spyware dipatuhi: consent, transparansi, data sesuai fungsi.
- Jika ada indikasi penggunaan tanpa consent, produk tidak boleh membantu.

Residual: orang dengan akses legal/fisik tetap dapat memaksa consent. Ini masalah sosial/
hukum, bukan sesuatu yang bisa diselesaikan aplikasi. Jangan mengklaim sebaliknya.

### 6.3 Anak dan data

- Data anak adalah data sensitif; minimisasi dan retensi ketat.
- Tidak ada profiling/iklan.
- Consent orang tua/wali dan persetujuan pengguna perangkat sesuai hukum setempat.
- Kebijakan privasi dan data safety Play harus akurat.
- Legal review diperlukan sebelum rilis; bukan tanggung jawab coding agent.

## 7. Persyaratan keamanan yang harus diuji

1. Cross-family access ditolak untuk semua endpoint (GET/POST/DELETE).
2. Parent tidak bisa memakai endpoint device; device tidak bisa memakai endpoint Parent.
3. Access/refresh token expired/revoked ditolak; logout langsung berlaku.
4. Duplicate/out-of-order ACK tidak mengubah final state.
5. Expired command tidak dieksekusi setelah reconnect.
6. Pairing code expired/attempt limit/reuse ditolak.
7. Claim token salah/expired ditolak; local consent wajib.
8. Parent approval tanpa verification code/other family ditolak.
9. Rate limit login/pairing/command/ACK berfungsi.
10. Body size/validation menolak payload berlebihan/malformed.
11. Log tidak memuat Authorization, password, token, pairing code, device secret.
12. Database hanya menyimpan hash token/password/device secret (kecuali verification
    code short-lived yang memang dibutuhkan Parent).
13. Backup dapat direstore dan tidak meninggalkan secret plaintext di lokasi publik.
14. Migrasi dari kosong dan dari versi sebelumnya berhasil; tidak ada kehilangan data.
15. Restart backend mempertahankan session/command/status; sweeper tidak menggandakan.
16. Status stale/out-of-order tidak menimpa snapshot lebih baru.
17. Revocation langsung berlaku pada request berikutnya.
18. Tidak ada cleartext HTTP di release Android.
19. Izin Android yang diminta sesuai fitur; tidak ada izin sensitif tersembunyi.
20. UI tidak menampilkan sukses tanpa ACK final.

## 8. Residual risk register

| Risiko | Tingkat | Kenapa belum tertutup | Rencana |
|---|---|---|---|
| Background latency tanpa FCM | High (produk) | Batasan arsitektur | Keputusan pengguna; UI queued; dokumentasi |
| Tidak ada hardware attestation | Medium | Kompleksitas; belum perlu | Verification code visual; evaluasi Play Integrity nanti |
| Device Admin deprecated/OEM | Medium | Platform | Uji perangkat; managed mode terpisah |
| Play policy rejection | High | Kebijakan eksternal | Review sebelum rilis; deklarasi transparan |
| VPS single point | Medium | MVP | Backup/restore; monitoring; bukan HA |
| SQLite tidak terenkripsi level aplikasi | Medium | Kompleksitas | Full-disk encryption VPS; backup encryption; data minimal |
| Operator VPS dapat membaca data | Medium | Akses admin | Kebijakan akses, log, enkripsi backup; bukan solusi penuh |
| Recovery akun belum ada | Medium | Belum didesain | Desain terpisah tanpa backdoor |
| Root/physical compromise | High | Di luar kendali app | Keystore, revoke, dokumentasi |
| Dependency zero-day | Medium | Eksternal | Lockfile, audit, update |

## 9. Keputusan keamanan yang perlu persetujuan

1. Apakah data status perlu histori? Histori menambah data sensitif dan retensi.
2. Apakah perlu enkripsi database level aplikasi (SQLCipher) atau cukup full-disk VPS?
3. Apakah certificate pinning diperlukan? Pinning menambah risiko operasional.
4. Apakah akan memakai Play Integrity/attestation? Menambah dependency Google.
5. Apakah managed mode/Device Owner akan ditawarkan? Mengubah threat model dan UX.
6. Siapa yang boleh mengakses audit/backup? Prosedur operator.
7. Bagaimana recovery akun Parent tanpa master PIN/backdoor?
8. Apakah notifikasi Parent boleh memuat nama perangkat/status? Default: minimal.

## 10. Sumber kebijakan

- Google Play Spyware: https://support.google.com/googleplay/android-developer/answer/14745000
- Google Play User Data: https://support.google.com/googleplay/android-developer/answer/10144311
- Google Play FGS: https://support.google.com/googleplay/android-developer/answer/13315670
- Google Play VpnService: https://support.google.com/googleplay/android-developer/answer/12564964
- Google Play Families: https://support.google.com/googleplay/android-developer/answer/9893335
- Android security best practices: https://developer.android.com/privacy-and-security/security-best-practices
- Android Keystore: https://developer.android.com/privacy-and-security/keystore