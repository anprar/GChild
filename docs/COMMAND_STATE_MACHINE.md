# State Machine Command — GChild

Status: usulan Tahap 0. Kontrak ini mengikat backend, simulator, dan Companion.
Tanggal: 2026-11-02.

## 1. Prinsip

1. Database server adalah sumber kebenaran; WebSocket/polling hanya transport.
2. Pengiriman bersifat **at-least-once**; eksekusi harus idempotent atau aman diulang.
3. Command yang sudah `EXPIRED` tidak boleh dieksekusi, meskipun baru diambil setelah
   reconnect.
4. Device **wajib** mendapatkan ACK `RECEIVED` yang diterima server sebelum mengeksekusi.
   Ini mencegah race dengan `CANCELLED` dan memastikan server tahu command telah diambil.
5. Hasil final tidak dapat diubah. ACK terlambat/konflik tidak menimpa hasil final.
6. Parent tidak pernah melihat `SUCCEEDED` sebelum server menerima ACK final.

## 2. State

```text
QUEUED ──ACK RECEIVED──> RECEIVED ──ACK EXECUTING──> EXECUTING
   │                        │                           │
   ├── cancel ──> CANCELLED  ├── expiry ──> EXPIRED      ├── ACK SUCCEEDED ──> SUCCEEDED
   ├── expiry ──> EXPIRED    │  (tidak dieksekusi)       ├── ACK FAILED ─────> FAILED
   └── ACK EXPIRED ─> EXPIRED└── (tidak dieksekusi)      └── timeout ────────> FAILED
```

| State | Terminal? | Arti |
|---|---|---|
| `QUEUED` | Tidak | Dibuat server, menunggu device mengambil/meng-ACK. |
| `RECEIVED` | Tidak | Device sudah meng-ACK dan berhak mengeksekusi. |
| `EXECUTING` | Tidak | Device menyatakan mulai mengeksekusi. |
| `SUCCEEDED` | Ya | Device melaporkan sukses; hasil final. |
| `FAILED` | Ya | Device melaporkan gagal, atau lease timeout. |
| `EXPIRED` | Ya | TTL habis sebelum eksekusi selesai dimulai; tidak dijalankan. |
| `CANCELLED` | Ya | Parent membatalkan sebelum device meng-ACK `RECEIVED`. |

`EXPIRED` bukan `FAILED`: bedakan “tidak pernah dijalankan karena waktu habis” dari
“dijalankan tetapi gagal”.

## 3. Transisi yang diizinkan

| Dari | Ke | Aktor | Syarat | Efek |
|---|---|---|---|---|
| — | `QUEUED` | Parent | Ownership, device aktif, tipe didukung, queue < 20 | Insert command, audit |
| `QUEUED` | `RECEIVED` | Device | Credential valid, device target cocok, belum expired, ACK diterima | `received_at`, lease mulai |
| `QUEUED` | `CANCELLED` | Parent | Masih `QUEUED` | Terminal, audit |
| `QUEUED` | `EXPIRED` | Server/device | `now >= expires_at` | Terminal, audit |
| `RECEIVED` | `EXECUTING` | Device | Masih `RECEIVED`, belum expired | `started_at`, lease eksekusi |
| `RECEIVED` | `EXPIRED` | Server/device | Expiry tercapai sebelum eksekusi | Terminal; device tidak mengeksekusi |
| `EXECUTING` | `SUCCEEDED` | Device | Hasil valid | Terminal, `completed_at`, audit |
| `EXECUTING` | `FAILED` | Device | Error terstruktur | Terminal, `completed_at`, audit |
| `EXECUTING` | `FAILED` | Server | Lease eksekusi habis | `error=TIMEOUT`, audit; tidak requeue |
| `RECEIVED`/`EXECUTING` | `EXPIRED` | Server | **Tidak diizinkan** setelah eksekusi dimulai | Gunakan `FAILED`/timeout, bukan expired |

Catatan:

- `RECEIVED` -> `EXPIRED` hanya jika belum pernah `EXECUTING`. Setelah eksekusi dimulai,
  command harus selesai dengan `SUCCEEDED`/`FAILED` atau timeout `FAILED`.
- Final state tidak boleh berubah. ACK final kedua dengan isi berbeda ditolak 409.
- `CANCELLED` hanya dari `QUEUED`. Jika device sudah meng-ACK `RECEIVED`, cancel ditolak
  409; device boleh melanjutkan.
- Tidak ada `QUEUED` -> `SUCCEEDED` langsung. Device harus melewati ACK.

## 4. Delivery

### 4.1 Fetch

`GET /v1/device-self/commands?limit=10`

- Mengembalikan command `QUEUED` yang belum expired, urut `created_at`.
- **Tidak mengubah state.** `delivery_count` dan `last_delivered_at` boleh diperbarui
  untuk observability.
- Respons menyertakan `serverTime` agar device dapat menghitung offset waktu.
- Command yang expired tidak dikembalikan; server sweeper menandainya `EXPIRED`.
- Fetch berulang mengembalikan command yang sama sampai device meng-ACK `RECEIVED`
  (at-least-once).

### 4.2 Wajib ACK sebelum eksekusi

Urutan device:

1. Fetch.
2. Untuk setiap command: cek `expires_at` dan tipe.
3. Kirim `POST /device-self/commands/:id/ack` dengan `status=RECEIVED`, `ackId` unik.
4. Hanya jika respons ACK sukses (200) dan state `RECEIVED`/`EXECUTING`, device boleh
   mengeksekusi.
5. Jika ACK gagal 409/410, jangan eksekusi; catat alasan.

Ini menutup race cancel: server hanya mengizinkan cancel saat `QUEUED`; setelah
`RECEIVED` diterima, cancel ditolak dan device berhak mengeksekusi.

### 4.3 ACK

`POST /v1/device-self/commands/:id/ack`

Body:

```json
{
  "ackId": "uuid",
  "status": "RECEIVED",
  "result": null,
  "error": null,
  "observedAt": "2026-11-02T10:00:00Z"
}
```

Aturan:

- `ackId` unik per pengiriman ACK. Retry harus memakai `ackId` yang sama.
- Server menyimpan `(command_id, ack_id)` unik.
- Duplikat `ackId`: kembalikan respons yang sama, `idempotent: true`, tanpa efek ganda.
- Status yang sama dengan state saat ini: idempotent, 200.
- Transisi yang tidak diizinkan atau final state berbeda: 409 `INVALID_STATE_TRANSITION`.
- ACK final setelah server sudah timeout `FAILED`: 409 `FINAL_STATE_ALREADY_SET`;
  hasil terlambat disimpan di audit, bukan menimpa state.
- ACK `EXPIRED` hanya berlaku jika command belum `EXECUTING`; jika sudah, 409.
- `result`/`error` divalidasi per tipe command; jangan menyimpan payload tak terbatas.

### 4.4 Lease / timeout

Server sweeper berjalan periodik (misalnya setiap 30 detik):

| Dari | Batas | Aksi |
|---|---|---|
| `QUEUED` | `expires_at` | -> `EXPIRED` |
| `RECEIVED` | `expires_at` | -> `EXPIRED` (belum dieksekusi) |
| `EXECUTING` | 30 detik sejak `started_at` (per tipe) | -> `FAILED` (`TIMEOUT_DURING_EXECUTION`) |

Nilai lease dapat dikonfigurasi per tipe. `LOCK_SCREEN` biasanya singkat; jangan
memberi lease tak terbatas. Tidak ada requeue otomatis: Parent dapat mengirim command
baru. Untuk `LOCK_SCREEN`, mengulang aman (idempotent), tetapi tetap dibuat command
baru dengan ID baru agar audit jelas.

## 5. Expiry

- `expiresAt` dihitung server saat create. Default:
  - `REQUEST_STATUS`: 60 detik.
  - `LOCK_SCREEN`: 120 detik.
- Parent tidak dapat memperpanjang TTL command yang sudah dibuat.
- Device memeriksa `expiresAt` sebelum eksekusi. Jika ragu karena clock skew, gunakan
  `serverTime` dari fetch dan elapsed time lokal; jangan memakai jam perangkat mentah.
- Command yang expired saat fetch tidak dikirim. Jika device sudah memegang command
  tetapi belum ACK dan TTL lewat, device mengirim `EXPIRED` (jika server belum) dan
  tidak mengeksekusi.
- `EXPIRED` adalah terminal. Command tidak dijalankan saat jaringan pulih.

## 6. Idempotensi per tipe

| Tipe | Idempotensi | Catatan |
|---|---|---|
| `REQUEST_STATUS` | Ya | Mengumpulkan snapshot baru; aman diulang. |
| `LOCK_SCREEN` | Praktis ya | `lockNow()` pada layar sudah terkunci adalah no-op; laporkan `alreadyLocked` jika teramati. Jangan klaim verifikasi keyguard. |
| `SET_RESTRICTIONS` (masa depan) | Harus idempotent | Terapkan policy berdasarkan revision; revision sama = no-op. |
| `TEMPORARY_ALLOW` (masa depan) | Harus idempotent | Absolute expiry; menerapkan ulang tidak memperpanjang tanpa command baru. |

Tipe command baru wajib mendokumentasikan idempotensi dan hasil yang dapat diulang
sebelum ditambahkan ke OpenAPI.

## 7. State yang terlihat Parent

| State server | Label UI Parent | Aksi UI |
|---|---|---|
| `QUEUED` | Menunggu perangkat | Boleh cancel |
| `RECEIVED` | Diterima perangkat | Tidak ada cancel |
| `EXECUTING` | Sedang dijalankan | Tidak ada cancel |
| `SUCCEEDED` | Berhasil | Tampilkan hasil + waktu |
| `FAILED` | Gagal | Tampilkan alasan terstruktur |
| `EXPIRED` | Kedaluwarsa | Tawarkan kirim ulang (command baru) |
| `CANCELLED` | Dibatalkan | — |

Jangan menampilkan “Berhasil” berdasarkan HTTP 201/202 dari create command.

## 8. Contoh urutan

### 8.1 Sukses

```text
Parent  POST /devices/d1/commands {type: LOCK_SCREEN}
Server  201 {state: QUEUED, expiresAt: T+120}
Device  GET /device-self/commands
Server  200 [{id: c1, state: QUEUED}]
Device  POST /commands/c1/ack {ackId:a1, status:RECEIVED}
Server  200 {state: RECEIVED}
Device  [lockNow()]
Device  POST /commands/c1/ack {ackId:a2, status:EXECUTING}
Server  200 {state: EXECUTING}
Device  POST /commands/c1/ack {ackId:a3, status:SUCCEEDED, result:{...}}
Server  200 {state: SUCCEEDED}
Parent  GET /devices/d1/commands -> SUCCEEDED
```

### 8.2 Expired

```text
Parent  create, expiresAt T+120
Device  offline
Sweeper T+120 -> EXPIRED
Device  reconnect T+300
Device  GET -> [] (tidak dikirim)
Parent  melihat EXPIRED
```

### 8.3 ACK hilang

```text
Device  lockNow() sukses
Device  POST ACK SUCCEEDED (response hilang)
Server  state SUCCEEDED
Device  retry ACK dengan ackId sama
Server  200 idempotent, state SUCCEEDED
```

### 8.4 Cancel race

```text
Device  fetch (state masih QUEUED)
Parent  cancel -> CANCELLED
Device  POST ACK RECEIVED -> 409
Device  tidak mengeksekusi
```

## 9. Audit

Catat minimal:

- command dibuat (actor, device, tipe, expiry);
- cancel;
- setiap transisi final (device, status, error code, ackId);
- timeout oleh sweeper;
- ACK konflik/terlambat (outcome DENIED/FAILURE);
- perubahan policy revision (Tahap 4).

Jangan mencatat payload yang mengandung secret. Command payload untuk tipe saat ini
tidak berisi data sensitif, tetapi tetap batasi ukuran dan validasi.


## 10. Hubungan dengan OpenAPI

- Enum `CommandState` dan `AckStatus` di `contracts/openapi.yaml` harus sama dengan
  dokumen ini.
- `AckRequest.status` hanya `RECEIVED`, `EXECUTING`, `SUCCEEDED`, `FAILED`, `EXPIRED`.
- `CANCELLED` dibuat server, bukan dikirim device.
- Perubahan state machine adalah perubahan kontrak; perbarui OpenAPI, test, dan
  versi API jika breaking.