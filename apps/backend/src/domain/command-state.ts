import { invalidTransition, finalStateSet } from '../lib/errors.js';

export const COMMAND_STATES = [
  'QUEUED',
  'RECEIVED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type CommandState = (typeof COMMAND_STATES)[number];

export const ACK_STATUSES = ['RECEIVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'EXPIRED'] as const;
export type AckStatus = (typeof ACK_STATUSES)[number];

const TERMINAL_STATES: ReadonlySet<CommandState> = new Set<CommandState>([
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
]);

export function isTerminal(state: CommandState): boolean {
  return TERMINAL_STATES.has(state);
}

export type CommandEvent =
  | { type: 'ack'; status: AckStatus }
  | { type: 'cancel' }
  | { type: 'expire' }
  | { type: 'timeout' };

export interface TransitionResult {
  state: CommandState;
  idempotent: boolean;
}

/**
 * Tabel transisi tunggal dari docs/COMMAND_STATE_MACHINE.md.
 *
 * Aturan yang ditegakkan:
 * - device wajib ACK RECEIVED sebelum EXECUTING;
 * - tidak ada lompatan QUEUED -> SUCCEEDED;
 * - CANCELLED hanya dari QUEUED;
 * - setelah EXECUTING, expiry tidak boleh dipakai: gunakan FAILED/timeout;
 * - final state tidak berubah.
 */
export function transitionCommand(current: CommandState, event: CommandEvent): TransitionResult {
  if (event.type === 'ack' && event.status === current) {
    return { state: current, idempotent: true };
  }
  if (isTerminal(current)) {
    throw finalStateSet(current);
  }

  switch (current) {
    case 'QUEUED':
      if (event.type === 'ack') {
        if (event.status === 'RECEIVED') return { state: 'RECEIVED', idempotent: false };
        if (event.status === 'EXPIRED') return { state: 'EXPIRED', idempotent: false };
        throw invalidTransition(current, event.status);
      }
      if (event.type === 'cancel') return { state: 'CANCELLED', idempotent: false };
      if (event.type === 'expire') return { state: 'EXPIRED', idempotent: false };
      throw invalidTransition(current, event.type);

    case 'RECEIVED':
      if (event.type === 'ack') {
        if (event.status === 'EXECUTING') return { state: 'EXECUTING', idempotent: false };
        if (event.status === 'EXPIRED') return { state: 'EXPIRED', idempotent: false };
        throw invalidTransition(current, event.status);
      }
      if (event.type === 'expire') return { state: 'EXPIRED', idempotent: false };
      // Cancel ditolak setelah perangkat menerima command.
      throw invalidTransition(current, event.type);

    case 'EXECUTING':
      if (event.type === 'ack') {
        if (event.status === 'SUCCEEDED') return { state: 'SUCCEEDED', idempotent: false };
        if (event.status === 'FAILED') return { state: 'FAILED', idempotent: false };
        throw invalidTransition(current, event.status);
      }
      if (event.type === 'timeout') return { state: 'FAILED', idempotent: false };
      // Expiry setelah eksekusi dimulai harus menjadi FAILED, bukan EXPIRED.
      throw invalidTransition(current, event.type);

    default:
      throw finalStateSet(current);
  }
}

/** Label UI Parent (bot Telegram). Tidak pernah "berhasil" sebelum final ACK. */
export const COMMAND_STATE_LABEL: Record<CommandState, string> = {
  QUEUED: 'Menunggu perangkat',
  RECEIVED: 'Diterima perangkat',
  EXECUTING: 'Sedang dijalankan',
  SUCCEEDED: 'Berhasil',
  FAILED: 'Gagal',
  EXPIRED: 'Kedaluwarsa',
  CANCELLED: 'Dibatalkan',
};
