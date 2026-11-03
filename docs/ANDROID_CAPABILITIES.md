# Matriks Kemampuan Android — GChild

Status: riset dokumentasi Tahap 0. **Belum diuji di perangkat.**
Tanggal akses sumber: 2026-11-02.

Dokumen ini menjawab: fitur mana yang benar-benar dapat dilakukan GChild Companion,
dalam mode standar (aplikasi biasa + Device Admin) dan mode managed (Device Owner /
Profile Owner), serta apa yang harus diuji sebelum fitur disebut andal.

## 1. Keputusan platform yang diusulkan

| Item | Usulan | Alasan |
|---|---|---|
| `compileSdk` | 37 (Android 17), verifikasi ketersediaan di SDK Manager | SDK stabil terbaru saat audit; diperlukan untuk kompatibilitas API 37. Jika belum tersedia, tunda build, jangan menebak. |
| `targetSdk` | 37 | Android 17 stable; Play mewajibkan API 36+ untuk app baru/update mulai 31 Agustus 2026 (ekstensi 1 November 2026). Target 37 memberi aturan keamanan terbaru. |
| `minSdk` | 28 (Android 9) | Device Admin/force-lock, Keystore modern, `setPackagesSuspended` (24+), WorkManager, Compose; mengurangi perangkat tanpa update keamanan. |
| JDK build | 21 (disarankan) | JDK 17.0.2 ada, tetapi versi patch lama; toolchain Android terbaru mungkin meminta JDK 21. Verifikasi saat Stage 2. |
| Kotlin/Compose/AGP | belum dikunci | Tidak ada Android SDK di mesin ini; jangan menebak versi. Kunci setelah build pertama. |

CatatanPlay: kebijakan target API menyatakan mulai 31 Agustus 2026 aplikasi baru/update
harus menargetkan Android 16 (API 36) atau lebih tinggi; ekstensi sampai 1 November 2026.
Target 37 memenuhi. Jangan menurunkan target untuk menghindari aturan platform.

Sumber:

- https://developer.android.com/google/play/requirements/target-sdk
- https://developer.android.com/about/versions/17/behavior-changes-17
- https://developer.android.com/about/versions/17/behavior-changes-all

## 2. Matriks fitur

Kolom “Standar” = aplikasi biasa, dapat memakai Device Admin dengan persetujuan pengguna.
Kolom “Managed” = Device Owner/Profile Owner setelah provisioning (bukan default MVP).
“Tahap” mengacu ke `docs/IMPLEMENTATION_PLAN.md`.

| Kemampuan | Standar | Managed (DO/PO) | API / izin | Batasan penting | Metode uji | Tahap |
|---|---|---|---|---|---|---|
| Login/HTTPS API | Ya | Ya | `INTERNET`, TLS | Tidak ada cleartext di release; backend harus reachable | Emulator + perangkat, jaringan mati | 2 |
| Pairing + consent lokal | Ya | Ya | Tidak ada izin khusus | Butuh dua perangkat dan kode verifikasi | Dua perangkat, kode salah/expired | 2 |
| Status baterai/charging | Ya | Ya | `BatteryManager`, sticky `ACTION_BATTERY_CHANGED` | Nilai bisa tidak tersedia; bukan realtime | Perangkat, charging on/off | 2 |
| Status jaringan | Ya | Ya | `ACCESS_NETWORK_STATE`, `ConnectivityManager` | “Tersambung” ≠ “backend terjangkau” | Wi-Fi/seluler/airplane | 2 |
| Status layar/keyguard | Ya | Ya | `PowerManager.isInteractive`, `KeyguardManager.isKeyguardLocked/isDeviceLocked` | Race saat layar berubah; tidak bisa saat proses mati | Perangkat, lock/unlock | 2 |
| Backend reachable | Ya | Ya | HTTP client | Hanya diketahui saat app mencoba; tidak bisa saat mati | Matikan backend, reconnect | 2 |
| Capability report | Ya | Ya | DevicePolicyManager, PackageManager, Settings | Harus nullable/unknown; berubah saat izin dicabut | Cabut izin, restart | 2 |
| Command queue + ACK | Ya | Ya | HTTPS | Tanpa FCM, pengambilan bergantung app aktif/WorkManager | Simulator + perangkat | 1-2 |
| WorkManager periodic | Ya | Ya | `androidx.work` | Minimum 15 menit; dapat ditunda Doze/App Standby/OEM | `adb` Doze/standby, reboot | 2 |
| WebSocket foreground | Ya | Ya | OkHttp WebSocket | Hanya saat proses/app hidup; bukan push | Background/force-stop | 2 (opsional) |
| Lock layar | Ya (Device Admin) | Ya (DO/PO) | `DevicePolicyManager.lockNow()`, `BIND_DEVICE_ADMIN`, `<force-lock/>` | Admin harus aktif; tidak membuka PIN; tidak menjamin verifikasi keyguard; deprecated untuk enterprise tetapi force-lock tetap tersedia | Perangkat, admin off/on, layar mati | 3 |
| Device Admin aktif | Ya | Ya | `ACTION_ADD_DEVICE_ADMIN`, `isAdminActive` | Pengguna dapat menonaktifkan; app tidak dapat mencegahnya | Onboarding, disable admin | 3 |
| Cegah uninstall | Tidak | Terbatas | DO/PO dapat membatasi uninstall paket terkelola | Factory reset tetap mungkin; jangan klaim tahan-uninstall | Perangkat managed | di luar MVP |
| Usage summary | Ya, dengan izin khusus | Ya | `UsageStatsManager`, `PACKAGE_USAGE_STATS` | User harus memberi via Settings; data bisa tertunda; bukan realtime; minimisasi | Settings usage access, query | 4 |
| Jadwal lokal/downtime | Ya (best-effort) | Ya | WorkManager, AlarmManager inexact | Timer bisa terlambat; tidak boleh exact alarm tanpa kebutuhan; reboot/timezone | Reboot, ubah jam/timezone, Doze | 4 |
| Temporary allowance | Ya (lokal) | Ya | Penyimpanan lokal + expiry absolut | Tidak membuka keyguard; harus persisten; bukan PIN bypass | Restart, reboot, ubah jam | 4 |
| Suspend aplikasi | Tidak | Ya | `DevicePolicyManager.setPackagesSuspended` (API 24+) | Butuh DO/PO; paket sistem/terlindungi dapat ditolak; UI sistem menampilkan suspended | Perangkat managed | managed, terpisah |
| Sembunyikan aplikasi | Tidak | Ya | `setApplicationHidden` | Kurang transparan; jangan dipakai untuk menyembunyikan GChild; hanya kebijakan eksplisit | Perangkat managed | managed, terpisah |
| Blokir internet per aplikasi | Ya, dengan consent | Ya | `VpnService`, `BIND_VPN_SERVICE`, consent | Satu VPN aktif; IPv4/IPv6; controller harus tetap reachable; recovery | Perangkat, Wi-Fi/seluler, reboot | 6 |
| Kiosk/lock task | Tidak | Ya | `setLockTaskPackages` | Mengubah UX besar; bukan fitur MVP | Perangkat managed | tidak direncanakan |
| Device Owner provisioning | Tidak | Ya | QR/ADB/NFC; factory reset | Tidak otomatis; menghapus data; keputusan pengguna | Perangkat uji khusus | keputusan terpisah |
| Remote unlock/PIN reset | Tidak | Tidak | — | Dilarang produk dan platform | — | tidak |
| Remote wipe | Tidak | Ya secara teknis | `wipeData` | Dilarang produk; tidak diimplementasikan | — | tidak |
| Accessibility untuk kontrol | Tidak | Tidak | `AccessibilityService` | Dilarang produk; berisiko kebijakan | — | tidak |
| Baca notifikasi/chat/OTP | Tidak | Tidak | Notification listener | Dilarang produk/privasi | — | tidak |
| Kamera/mikrofon/lokasi/kontak/SMS | Tidak | Tidak | izin sensitif | Dilarang produk; tidak diminta | — | tidak |
| Exact alarm | Hindari | Hindari | `SCHEDULE_EXACT_ALARM` | Tidak pre-grant untuk banyak app baru; Play membatasi; jangan untuk jadwal biasa | `canScheduleExactAlarms` | tidak |
| Battery optimization exemption | Hindari | Hindari | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Play membatasi; jangan bypass power management | — | tidak |
| Foreground service permanen | Tidak | Tidak | `FOREGROUND_SERVICE`, tipe | `dataSync` 6 jam/24 jam (target 15+); boot restrictions; Play review | — | tidak |
| FGS `systemExempted` | Tidak dipakai | Secara teknis device admin memenuhi | `FOREGROUND_SERVICE_SYSTEM_EXEMPTED` | Ditujukan integrasi sistem; review kebijakan; jangan menyalahgunakan tipe | — | tidak |
| Boot reconciliation | Ya | Ya | `RECEIVE_BOOT_COMPLETED`, WorkManager | Tidak boleh start `dataSync` FGS dari boot; kerja bisa tertunda | Reboot perangkat | 2 |
| Force-stop recovery | Tidak | Tidak | — | Setelah force-stop app tidak berjalan sampai dibuka pengguna | `adb shell am force-stop` | 2 |
| OEM battery saver | Tidak dapat dilawan | Tidak dapat dilawan | — | Perilaku OEM berbeda; jangan bypass | Uji OEM target | 2-3 |

## 3. Izin dan deklarasi

| Izin/API | Jenis | Dipakai untuk | Catatan |
|---|---|---|---|
| `INTERNET` | Normal | Semua koneksi | Wajib. |
| `ACCESS_NETWORK_STATE` | Normal | Status jaringan | Tidak memberi akses isi trafik. |
| `RECEIVE_BOOT_COMPLETED` | Normal | Menjadwalkan rekonsiliasi setelah boot | Bukan jaminan app langsung berjalan. |
| `POST_NOTIFICATIONS` | Runtime (API 33+) | Notifikasi hasil/status jika diperlukan | Jangan isi notifikasi dengan data sensitif. |
| `BIND_DEVICE_ADMIN` | Signature/protected | DeviceAdminReceiver | Hanya sistem yang dapat memberikannya; deklarasi di receiver. |
| `PACKAGE_USAGE_STATS` | Special app access | Usage summary (Tahap 4) | User harus mengaktifkan di Settings; bukan runtime dialog biasa. |
| `FOREGROUND_SERVICE` + tipe | Normal + deklarasi | Tidak dipakai MVP | Jika nanti dipakai, tipe harus sah dan dideklarasikan ke Play. |
| `SCHEDULE_EXACT_ALARM` | Special | Tidak dipakai | Tidak pre-grant; Play membatasi. |
| `QUERY_ALL_PACKAGES` | Normal (Play-restricted) | Tidak dipakai | Hindari; gunakan LauncherApps/`<queries>` spesifik untuk Tahap 5. |
| `ACCESS_LOCAL_NETWORK` | Runtime (API 37+) | Tidak dipakai | GChild hanya koneksi internet, bukan LAN. |
| Lokasi/kamera/mikrofon/kontak/SMS/kalender | Sensitif | Tidak dipakai | Jangan ditambahkan tanpa persetujuan produk baru. |

Catatan package visibility: untuk menampilkan daftar aplikasi yang dapat dibatasi pada
managed mode, gunakan API launcher/package yang sesuai dan minimalkan daftar. Jangan
meminta `QUERY_ALL_PACKAGES` hanya untuk kenyamanan.

## 4. Device Admin dan lock layar

Fakta dari dokumentasi resmi:

- Device Administration API menyediakan `DevicePolicyManager.lockNow()` untuk mengunci
  perangkat segera.
- `USES_POLICY_FORCE_LOCK` dan `USES_POLICY_WIPE_DATA` tetap tersedia untuk kasus
  konsumen “lock and wipe lost device”; kebijakan password/camera/keyguard tertentu
  dideprecasi untuk device admin sejak Android 9/10.
- Device admin adalah pendekatan legacy untuk enterprise; Device Owner/Profile Owner
  adalah mode yang direkomendasikan untuk managed device.
- Untuk mengaktifkan admin, pengguna harus menyetujui layar sistem
  `ACTION_ADD_DEVICE_ADMIN`; aplikasi tidak dapat menyetujuinya sendiri.
- Aplikasi tidak dapat mencegah pengguna menonaktifkan admin atau meng-uninstall
  dengan andal pada mode standar. `onDisableRequested` hanya dapat menampilkan
  peringatan, bukan mengunci/menghalangi.
- `lockNow()` mengunci layar; tidak membuka PIN/pola dan tidak menghapus password.
- Setelah `lockNow()`, aplikasi tidak dapat memverifikasi secara kriptografis bahwa
  keyguard benar-benar aktif. Laporkan `verified: false` dan observasi
  `keyguardLocked` jika tersedia.

Risiko:

- Kebijakan Play dan OEM dapat membatasi/menolak penggunaan device admin.
- Beberapa OEM membunuh proses atau menunda WorkManager, sehingga command lock baru
  dieksekusi saat app aktif.
- Jika admin dicabut, command harus gagal dengan alasan `ADMIN_INACTIVE`, bukan crash.

Sumber:

- https://developer.android.com/guide/topics/admin/device-admin
- https://developers.google.com/android/work/device-admin-deprecation
- https://developer.android.com/reference/android/app/admin/DevicePolicyManager#lockNow()

## 5. Managed mode (Device Owner/Profile Owner)

Managed mode memberi kemampuan yang tidak ada di mode standar, tetapi bukan default
MVP dan bukan provisioning otomatis.

| Kemampuan | DO | Profile Owner | Catatan |
|---|---|---|---|
| `setPackagesSuspended` | Ya | Ya | API 24+; paket sistem/terlindungi dapat ditolak; UI sistem terlihat. |
| `setApplicationHidden` | Ya | Ya | Tidak transparan untuk anak; jangan dipakai untuk menyembunyikan GChild. |
| `setUninstallBlocked` | Ya (paket terkelola) | Ya (paket terkelola) | Bukan jaminan anti-factory-reset; jangan diklaim sebagai tahan-uninstall. |
| Lock task/kiosk | Ya | Terbatas | Mengubah UX; di luar MVP. |
| `lockNow` | Ya | Ya | Sama seperti device admin; tidak membuka PIN. |
| Policy global perangkat | Ya | Tidak (hanya profil) | Profile Owner tidak mengontrol seluruh perangkat pribadi. |
| Provisioning | QR/ADB/NFC | Managed profile | Butuh factory reset untuk DO pada perangkat yang sudah dipakai; keputusan pengguna. |

Kesimpulan: jangan menjanjikan suspend/resume aplikasi sebagai fitur MVP. Jika produk
membutuhkan kontrol aplikasi tingkat sistem, keputusan managed mode harus dibuat
terpisah, termasuk factory reset, distribusi, dan kebijakan Play.

Sumber:

- https://developer.android.com/work/dpc/build-dpc
- https://developer.android.com/reference/android/app/admin/DevicePolicyManager
- https://developer.android.com/work/device-admin

## 6. Background dan transport

### 6.1 Fakta yang membatasi

- Sejak Android 12 (target 31+), app di background tidak dapat memulai foreground
  service kecuali pengecualian tertentu.
- Android 15 (target 35+) membatasi `dataSync` FGS total 6 jam per 24 jam; `BOOT_COMPLETED`
  tidak boleh memulai `dataSync`, `camera`, `mediaPlayback`, `phoneCall`,
  `mediaProjection`, atau `microphone` FGS.
- WorkManager periodic minimum 15 menit; eksekusi bergantung constraints, Doze,
  App Standby, dan OEM.
- Force-stop menghentikan app sampai pengguna membukanya lagi.
- Doze membatasi network/job/alarm.
- Android 16 mengubah kuota JobScheduler/WorkManager; Android 17 menambah batas memori
  aplikasi dan perilaku background audio (tidak relevan untuk GChild).
- Tidak ada mekanisme push pihak ketiga yang dapat menggantikan FCM tanpa koneksi
  persisten; koneksi persisten di background juga dapat dimatikan OS.

### 6.2 Konsekuensi untuk GChild

| Skenario | Perilaku yang boleh diklaim |
|---|---|
| Companion terlihat, jaringan ada | Fetch command/polling/WebSocket; ACK dan status relatif cepat. |
| Companion background, WorkManager diizinkan | Fetch command saat worker dijalankan; bisa terlambat 15+ menit atau lebih. |
| Companion di Doze/App Standby | Bisa tertunda sampai jendela maintenance. |
| Companion force-stopped | Tidak ada eksekusi sampai pengguna membuka app. |
| Perangkat mati/reboot | Tidak ada kontrol; setelah boot, rekonsiliasi jika diizinkan. |
| Command TTL habis sebelum diambil | `EXPIRED`; tidak dieksekusi saat reconnect. |
| Parent menutup app | Command tetap di server; Parent melihat state saat membuka lagi. |

### 6.3 Yang ditolak

- Foreground service permanen dengan tipe `dataSync` untuk command channel.
- `specialUse` atau `systemExempted` untuk menghindari batas background.
- WorkManager sebagai polling realtime.
- Klaim “selalu terhubung” atau “langsung terkunci”.
- Meminta user menonaktifkan battery optimization sebagai syarat fitur.

## 7. Usage access, jadwal, dan VPN

### 7.1 Usage summary (Tahap 4)

- `UsageStatsManager.queryUsageStats` memerlukan `PACKAGE_USAGE_STATS`; user memberi
  melalui Settings (`ACTION_USAGE_ACCESS_SETTINGS`).
- Data dapat tertunda, tidak lengkap, dan bukan realtime.
- Rekomendasi: agregat durasi per aplikasi/hari; tanpa nama situs, isi chat, atau
  konten. Tampilkan sumber dan waktu observasi.
- Jangan memakai `QUERY_ALL_PACKAGES` tanpa kebutuhan; minimalkan data.

### 7.2 Jadwal lokal (Tahap 4)

- WorkManager periodic minimum 15 menit; alarm inexact dapat dipakai untuk
  mengingatkan, bukan menjamin detik.
- Jangan memakai exact alarm hanya untuk kenyamanan; Play membatasi dan user harus
  memberi izin khusus.
- Setelah reboot/timezone change, evaluasi ulang jadwal dan tandai jika ada
  ketidakpastian.
- Temporary allowance memakai expiry absolut yang persisten; bukan membuka keyguard.

### 7.3 VPN blocking (Tahap 6)

- `VpnService` memerlukan consent pengguna pertama kali; hanya satu VPN aktif.
- Perlu dukungan IPv4/IPv6, DNS, dan rute; controller/backend harus selalu dapat
  terhubung agar tidak mengunci diri sendiri.
- Tidak boleh melakukan interception/logging isi trafik; hanya blocking/routing.
- Play mengizinkan VpnService untuk parental control, tetapi tetap perlu deklarasi
  dan transparansi.
- Recovery: notifikasi/UI untuk mematikan VPN, dan system VPN disconnect.

## 8. Matriks pengujian perangkat

Minimal:

| Dimensi | Nilai |
|---|---|
| Android | 9 (28), 11 (30), 12 (31), 13 (33), 14 (34), 15 (35), 16 (36), 17 (37) |
| OEM | Pixel/AOSP, Samsung, Xiaomi/Redmi, Oppo/Realme, Vivo, Huawei/Honor (sesuai ketersediaan) |
| Kondisi | charging/not, Wi-Fi/seluler/airplane, screen on/off, lock/unlock, Doze, App Standby, reboot, force-stop, battery saver, low storage |
| Peran | Parent device dan Companion device terpisah (bukan dua app di satu emulator untuk klaim akhir) |

Setiap hasil harus dicatat: perangkat, OS, build, langkah, hasil, dan timestamp. Jangan
menyebut fitur “andal” hanya dari emulator.

## 9. Platform alternatives

Android 17 memiliki parental controls bawaan (daily limit, downtime, app limits,
blocked apps) dan Google Family Link. Ini adalah alternatif platform yang harus
disebut di PRD/UX:

- Bawaan platform bekerja lokal di perangkat dan tidak membutuhkan backend/VPS.
- GChild menawarkan alur Parent/Companion lintas perangkat dan backend sendiri.
- Jangan mengklaim GChild lebih baik tanpa bukti; jangan menduplikasi fitur platform
  yang sudah memadai tanpa alasan.

Sumber (contoh): https://blog.google/products-and-platforms/platforms/android/new-expanded-android-parental-controls/

## 10. Sumber resmi yang diperiksa

Diakses 2026-11-02:

- Target API Play: https://developer.android.com/google/play/requirements/target-sdk
- Android 17 behavior changes: https://developer.android.com/about/versions/17/behavior-changes-17
- Android 17 all-app changes: https://developer.android.com/about/versions/17/behavior-changes-all
- Android 16 target changes: https://developer.android.com/about/versions/16/behavior-changes-16
- Android 16 all-app changes: https://developer.android.com/about/versions/16/behavior-changes-all
- Android 15 behavior changes (dataSync timeout, boot FGS): https://developer.android.com/about/versions/15/behavior-changes-15
- FGS types: https://developer.android.com/develop/background-work/services/fgs/service-types
- FGS background start restrictions: https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- WorkManager periodic: https://developer.android.com/topic/libraries/architecture/workmanager/how-to/define-work
- Exact alarms: https://developer.android.com/about/versions/14/changes/schedule-exact-alarms
- Device admin: https://developer.android.com/guide/topics/admin/device-admin
- Device admin deprecation: https://developers.google.com/android/work/device-admin-deprecation
- DevicePolicyManager: https://developer.android.com/reference/android/app/admin/DevicePolicyManager
- KeyguardManager: https://developer.android.com/reference/android/app/KeyguardManager
- UsageStatsManager: https://developer.android.com/reference/android/app/usage/UsageStatsManager
- VpnService: https://developer.android.com/reference/android/net/VpnService
- Android Keystore: https://developer.android.com/privacy-and-security/keystore
- Security crypto deprecated: https://developer.android.com/reference/androidx/security/crypto/package-summary
- Play Spyware policy: https://support.google.com/googleplay/android-developer/answer/14745000
- Play FGS policy: https://support.google.com/googleplay/android-developer/answer/13315670
- Play VpnService policy: https://support.google.com/googleplay/android-developer/answer/12564964

## 11. Hal yang masih perlu diverifikasi di perangkat

1. `lockNow()` pada OEM target saat layar mati, Doze, dan app background.
2. Apakah Device Admin dapat diaktifkan/dinonaktifkan tanpa crash pada OEM target.
3. WorkManager periodic setelah reboot dan setelah OEM battery saver.
4. `KeyguardManager.isKeyguardLocked` vs `isDeviceLocked` pada lock screen OEM.
5. Kestabilan WebSocket foreground saat pindah Wi-Fi/seluler dan screen off.
6. Keandalan `UsageStatsManager` dan waktu delay pada OEM target.
7. Perilaku `setPackagesSuspended` pada managed device (jika dipilih).
8. Apakah VPN selalu-on/recovery dapat mempertahankan koneksi controller.
9. Dampak baterai status reporting/WorkManager.
10. Apakah targetSdk 37 menimbulkan masalah dengan library/OkHttp/Compose yang dipilih.