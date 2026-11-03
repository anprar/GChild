import type { CommandType } from '../repositories/commands.js';
import type { CommandRow, CommandWithDevice } from '../repositories/commands.js';
import type { DeviceRow } from '../repositories/devices.js';
import type { PairingRow } from '../repositories/pairing.js';
import type { DeviceStatusRow } from '../repositories/status.js';
import { COMMAND_STATE_LABEL } from '../domain/command-state.js';
import { shortId } from '../lib/ids.js';
import { toIso } from '../lib/time.js';

const COMMAND_TYPE_LABEL: Record<CommandType, string> = {
  REQUEST_STATUS: 'Minta status',
  LOCK_SCREEN: 'Kunci layar',
};

function fmtUtc(ms: number): string {
  return `${toIso(ms).slice(0, 16).replace('T', ' ')} UTC`;
}

function fmtBool(value: number | null, unknownLabel = 'tidak diketahui'): string {
  if (value === null) return unknownLabel;
  return value === 1 ? 'ya' : 'tidak';
}

function fmtAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

export const PAIRING_STATUS_LABEL: Record<PairingRow['status'], string> = {
  OPEN: 'Menunggu kode dimasukkan di perangkat',
  CLAIMED: 'Perangkat sudah memasukkan kode, belum menyetujui lokal',
  LOCAL_CONFIRMED: 'Perangkat sudah setuju lokal, menunggu persetujuan Anda',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  EXPIRED: 'Kedaluwarsa',
};

export function renderHelp(): string {
  return [
    'GChild — bantuan',
    '',
    'Perangkat:',
    '/perangkat — daftar perangkat keluarga',
    '/status [nomor] — minta status baru dari perangkat',
    '/cek [nomor] — lihat snapshot status terakhir yang dilaporkan',
    '/kunci [nomor] — minta kunci layar Android',
    '/terakhir — 5 command terakhir',
    '/batal <id> — batalkan command yang masih menunggu',
    '',
    'Pairing:',
    '/pasangkan — buat kode pairing (berlaku 10 menit)',
    '/menunggu — lihat pairing yang belum selesai',
    '/setujui <id> <kode verifikasi> — setujui perangkat',
    '/tolak <id> — tolak permintaan pairing',
    '',
    'Perangkat lain:',
    '/hapus <nomor> — cabut akses perangkat',
    '',
    'Catatan jujur: tanpa push notification, command hanya dieksekusi saat',
    'GChild Companion aktif atau saat pekerjaan terjadwal berjalan. "Menunggu',
    'perangkat" berarti belum dijalankan; saya hanya melaporkan hasil setelah',
    'perangkat mengirim ACK final.',
  ].join('\n');
}

export function renderDeviceList(devices: DeviceRow[], now: number, staleMs: number): string {
  if (devices.length === 0) {
    return 'Belum ada perangkat. Jalankan /pasangkan lalu masukkan kodenya di GChild Companion.';
  }
  const lines = ['Perangkat keluarga:'];
  devices.forEach((device, index) => {
    const status =
      device.status === 'ACTIVE'
        ? 'aktif'
        : device.status === 'PENDING'
          ? 'pairing belum selesai'
          : 'akses dicabut';
    const lastSeen =
      device.last_seen_at === null
        ? 'belum pernah terhubung'
        : `${fmtAge(now - device.last_seen_at)} (${fmtUtc(device.last_seen_at)})`;
    lines.push(`${index + 1}) ${device.label} — ${status}`);
    lines.push(`   model: ${device.model ?? 'tidak diketahui'} · terakhir terlihat: ${lastSeen}`);
    lines.push(`   id: ${shortId(device.id)}`);
    if (device.last_seen_at !== null && now - device.last_seen_at > staleMs) {
      lines.push('   catatan: data bisa sudah lama (stale).');
    }
  });
  return lines.join('\n');
}

export function renderDeviceStatus(
  device: DeviceRow,
  status: DeviceStatusRow | null,
  now: number,
  staleMs: number,
): string {
  if (!status) {
    return [
      `Status ${device.label}: belum ada laporan.`,
      `Gunakan /status untuk meminta perangkat mengirim observasi baru, lalu /cek lagi.`,
    ].join('\n');
  }
  const stale = now - status.received_at > staleMs;
  const lines = [
    `Status ${device.label}`,
    `Baterai: ${status.battery_level === null ? 'tidak diketahui' : `${status.battery_level}%`}`,
    `Mengisi daya: ${fmtBool(status.charging)}`,
    `Jaringan tersambung: ${fmtBool(status.network_connected)}`,
    `Backend terjangkau: ${fmtBool(status.backend_reachable)}`,
    `Layar menyala: ${fmtBool(status.screen_interactive)}`,
    `Keyguard terkunci: ${fmtBool(status.keyguard_locked)}`,
    `Diamati perangkat: ${fmtUtc(status.observed_at)} (waktu perangkat, tidak dipercaya untuk expiry)`,
    `Diterima server: ${fmtUtc(status.received_at)}`,
    'Catatan: snapshot terakhir; bukan pemantauan realtime.',
    ...(stale
      ? ['Peringatan: data ini sudah lama (stale). Nilai bisa tidak mencerminkan kondisi sekarang.']
      : []),
  ];
  if (status.capabilities_json) {
    try {
      const capabilities = JSON.parse(status.capabilities_json) as Record<string, boolean | null>;
      const rendered = Object.entries(capabilities)
        .map(([key, value]) => `${key}=${value === null ? 'unknown' : value ? 'ya' : 'tidak'}`)
        .join(', ');
      if (rendered) lines.push(`Kemampuan: ${rendered}`);
    } catch {
      lines.push('Kemampuan: tidak dapat dibaca');
    }
  }
  return lines.join('\n');
}

export function renderCommandCreated(
  command: CommandRow,
  deviceLabel: string,
  now: number,
): string {
  return [
    `Command dibuat: ${COMMAND_TYPE_LABEL[command.type]}`,
    `Perangkat: ${deviceLabel}`,
    `Status: ${COMMAND_STATE_LABEL[command.state]} (belum dijalankan)`,
    `ID: ${shortId(command.id)}`,
    `Antrean dibuat: ${fmtUtc(now)}`,
    `Kedaluwarsa: ${fmtUtc(command.expires_at)}`,
    '',
    'Saya akan mengirim pesan lain setelah perangkat melaporkan hasil (ACK final).',
    'Jika perangkat mati, force-stop, atau Doze, command bisa kedaluwarsa tanpa dijalankan.',
  ].join('\n');
}

export function renderCommandList(commands: CommandWithDevice[]): string {
  if (commands.length === 0) return 'Belum ada command.';
  const lines = ['Command terakhir (5):'];
  for (const command of commands) {
    lines.push(
      `#${shortId(command.id)} ${COMMAND_TYPE_LABEL[command.type]} · ${command.device_label}`,
    );
    lines.push(
      `   ${COMMAND_STATE_LABEL[command.state]} · dibuat ${fmtUtc(command.created_at)} · kedaluwarsa ${fmtUtc(command.expires_at)}`,
    );
  }
  return lines.join('\n');
}

export function renderCommandNotification(command: CommandWithDevice): string {
  const base = [
    `Hasil command #${shortId(command.id)} (${COMMAND_TYPE_LABEL[command.type]})`,
    `Perangkat: ${command.device_label}`,
    `Status: ${COMMAND_STATE_LABEL[command.state]}`,
  ];
  if (command.error_json) {
    try {
      const error = JSON.parse(command.error_json) as { code?: string; message?: string };
      base.push(`Alasan: ${error.code ?? 'tidak diketahui'}${error.message ? ` — ${error.message}` : ''}`);
    } catch {
      base.push('Alasan: tidak dapat dibaca');
    }
  }
  if (command.result_json) {
    try {
      const result = JSON.parse(command.result_json) as Record<string, unknown>;
      const rendered = Object.entries(result)
        .slice(0, 6)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(', ');
      if (rendered) base.push(`Hasil: ${rendered}`);
    } catch {
      base.push('Hasil: tidak dapat dibaca');
    }
  }
  if (command.completed_at) base.push(`Waktu: ${fmtUtc(command.completed_at)}`);
  if (command.state === 'EXPIRED') {
    base.push('Command tidak dijalankan. Kirim command baru jika masih diperlukan.');
  }
  return base.join('\n');
}

export function renderPairingCode(code: string, expiresAt: number): string {
  return [
    'Kode pairing dibuat.',
    `Kode: ${code}`,
    `Berlaku sampai: ${fmtUtc(expiresAt)}`,
    '',
    'Langkah berikutnya:',
    '1. Buka GChild Companion di perangkat anak.',
    '2. Masukkan kode di atas, lalu setujui penjelasan data di perangkat.',
    '3. Jalankan /menunggu untuk melihat kode verifikasi perangkat.',
    '4. Cocokkan kode verifikasi dengan layar Companion, lalu jalankan',
    '   /setujui <id> <kode verifikasi>.',
    '',
    'Kode pairing saja tidak cukup untuk mengaktifkan perangkat.',
  ].join('\n');
}

export function renderPendingPairings(pairings: PairingRow[]): string {
  if (pairings.length === 0) {
    return 'Tidak ada permintaan pairing aktif. Gunakan /pasangkan untuk membuat kode baru.';
  }
  const lines = ['Permintaan pairing aktif (5):'];
  for (const pairing of pairings) {
    lines.push(`#${shortId(pairing.id)} ${pairing.device_label ?? '(perangkat belum mengirim identitas)'}`);
    lines.push(`   ${PAIRING_STATUS_LABEL[pairing.status]}`);
    if (pairing.status !== 'OPEN') {
      lines.push(
        `   kode verifikasi: ${pairing.verification_code ?? '-'} (cocokkan dengan layar Companion)`,
      );
    }
    lines.push(`   kode berlaku sampai: ${fmtUtc(pairing.code_expires_at)}`);
  }
  lines.push('', 'Setujui: /setujui <id> <kode verifikasi> · Tolak: /tolak <id>');
  return lines.join('\n');
}

export function renderAccessDenied(): string {
  return 'Akses ditolak. Akun Telegram ini tidak terdaftar sebagai orang tua di GChild.';
}
