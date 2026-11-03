import { conflict, gone, invalidTransition } from '../lib/errors.js';

export const PAIRING_STATUSES = [
  'OPEN',
  'CLAIMED',
  'LOCAL_CONFIRMED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
] as const;
export type PairingStatus = (typeof PAIRING_STATUSES)[number];

export type PairingEvent = 'claim' | 'local-confirm' | 'approve' | 'reject' | 'expire';

const ALLOWED: Record<PairingStatus, Partial<Record<PairingEvent, PairingStatus>>> = {
  OPEN: { claim: 'CLAIMED', expire: 'EXPIRED' },
  CLAIMED: { 'local-confirm': 'LOCAL_CONFIRMED', reject: 'REJECTED', expire: 'EXPIRED' },
  LOCAL_CONFIRMED: { approve: 'APPROVED', reject: 'REJECTED', expire: 'EXPIRED' },
  APPROVED: {},
  REJECTED: {},
  EXPIRED: {},
};

export interface PairingTransitionResult {
  status: PairingStatus;
  idempotent: boolean;
}

/**
 * Pairing butuh tiga pihak: Parent (kode), Companion (consent lokal), lalu
 * persetujuan Parent dengan kode verifikasi. Tabel ini menolak lompatan tahap.
 */
export function transitionPairing(
  current: PairingStatus,
  event: PairingEvent,
): PairingTransitionResult {
  if (current === 'APPROVED' && event === 'approve') {
    return { status: current, idempotent: true };
  }
  if (current === 'REJECTED' || current === 'EXPIRED') {
    throw gone('Permintaan pairing sudah ditutup.');
  }
  const next = ALLOWED[current][event];
  if (!next) {
    throw invalidTransition(current, event);
  }
  return { status: next, idempotent: false };
}

export function assertLocalConfirmed(status: PairingStatus): void {
  if (status !== 'LOCAL_CONFIRMED') {
    throw conflict('Persetujuan lokal di perangkat belum diterima.');
  }
}
