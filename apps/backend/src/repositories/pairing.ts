import type { Db } from '../db/client.js';
import { transitionPairing, type PairingStatus } from '../domain/pairing-state.js';
import { hmacSha256Hex, randomToken, safeEqualHex, sha256Hex } from '../lib/crypto.js';
import { badRequest, conflict, gone, notFound, rateLimited, unauthorized } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { generateVerificationCode } from '../lib/pairing-code.js';
import { recordAudit } from './audit.js';
import { createCredential, createPendingDevice, revokeDeviceTx } from './devices.js';

export const MAX_CLAIM_ATTEMPTS = 5;

export interface PairingRow {
  id: string;
  family_id: string;
  created_by: number;
  code_hash: string;
  code_expires_at: number;
  attempt_count: number;
  max_attempts: number;
  verification_attempts: number;
  status: PairingStatus;
  device_id: string | null;
  claim_token_hash: string | null;
  claim_token_expires_at: number | null;
  claim_secret_hash: string | null;
  verification_code: string | null;
  verification_expires_at: number | null;
  device_label: string | null;
  device_model: string | null;
  device_manufacturer: string | null;
  app_version: string | null;
  sdk_int: number | null;
  installation_id: string | null;
  local_confirmed_at: number | null;
  approved_at: number | null;
  rejected_at: number | null;
  reject_reason: string | null;
  created_at: number;
}

export interface ClaimMetadata {
  label: string;
  installationId: string;
  model: string | null;
  manufacturer: string | null;
  appVersion: string | null;
  sdkInt: number | null;
}

export function getPairingById(db: Db, pairingId: string): PairingRow | null {
  const row = db.prepare('SELECT * FROM pairing_requests WHERE id = ?').get(pairingId) as
    | PairingRow
    | undefined;
  return row ?? null;
}

export function getPairingForFamily(
  db: Db,
  pairingId: string,
  familyId: string,
): PairingRow | null {
  const row = db
    .prepare('SELECT * FROM pairing_requests WHERE id = ? AND family_id = ?')
    .get(pairingId, familyId) as PairingRow | undefined;
  return row ?? null;
}

export function createPairingRequest(
  db: Db,
  input: {
    familyId: string;
    createdBy: number;
    code: string;
    pepper: string;
    now: number;
    ttlMs: number;
  },
): { pairing: PairingRow; code: string } {
  const id = newId('pair');
  const codeHash = hmacSha256Hex(input.pepper, input.code);
  db.prepare(
    `INSERT INTO pairing_requests
       (id, family_id, created_by, code_hash, code_expires_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'OPEN', ?)`,
  ).run(id, input.familyId, input.createdBy, codeHash, input.now + input.ttlMs, input.now);

  recordAudit(db, {
    familyId: input.familyId,
    actorType: 'PARENT',
    actorId: String(input.createdBy),
    action: 'pairing.create',
    outcome: 'SUCCESS',
    metadata: { pairingId: id, expiresAt: input.now + input.ttlMs },
    now: input.now,
  });

  const pairing = getPairingById(db, id);
  if (!pairing) throw new Error('Pairing gagal dibuat');
  return { pairing, code: input.code };
}

export function listPendingPairings(db: Db, familyId: string): PairingRow[] {
  return db
    .prepare(
      `SELECT * FROM pairing_requests
        WHERE family_id = ? AND status IN ('OPEN', 'CLAIMED', 'LOCAL_CONFIRMED')
        ORDER BY created_at DESC`,
    )
    .all(familyId) as PairingRow[];
}

export function countOpenPairings(db: Db, familyId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM pairing_requests
        WHERE family_id = ? AND status IN ('OPEN', 'CLAIMED', 'LOCAL_CONFIRMED')`,
    )
    .get(familyId) as { count: number };
  return row.count;
}

function markPairingExpired(db: Db, pairing: PairingRow, now: number): void {
  db.transaction(() => {
    db.prepare(`UPDATE pairing_requests SET status = 'EXPIRED' WHERE id = ? AND status IN
      ('OPEN', 'CLAIMED', 'LOCAL_CONFIRMED')`).run(pairing.id);
    if (pairing.device_id) {
      revokeDeviceTx(db, { familyId: pairing.family_id, deviceId: pairing.device_id, now });
    }
    recordAudit(db, {
      familyId: pairing.family_id,
      actorType: 'SYSTEM',
      deviceId: pairing.device_id,
      action: 'pairing.expire',
      outcome: 'SUCCESS',
      metadata: { pairingId: pairing.id },
      now,
    });
  })();
}

/**
 * Claim kedua arah, langkah 2. Kode pairing (entropi rendah) diabsen lewat HMAC +
 * attempt limit persisten; device secret dibuat Companion dan hanya hash-nya disimpan.
 */
export function claimPairing(
  db: Db,
  input: {
    code: string;
    pepper: string;
    deviceSecret: string;
    metadata: ClaimMetadata;
    now: number;
    codeTtlMs: number;
    claimTtlMs: number;
  },
): {
  pairing: PairingRow;
  deviceId: string;
  claimToken: string;
  claimExpiresAt: number;
  verificationCode: string;
} {
  const codeHash = hmacSha256Hex(input.pepper, input.code);

  const attempts = db
    .prepare('SELECT attempt_count, expires_at FROM pairing_claim_attempts WHERE code_hash = ?')
    .get(codeHash) as { attempt_count: number; expires_at: number } | undefined;
  const previous = attempts && attempts.expires_at > input.now ? attempts.attempt_count : 0;
  if (previous >= MAX_CLAIM_ATTEMPTS) {
    throw rateLimited('Kode pairing dikunci sementara karena terlalu banyak percobaan.');
  }
  db.prepare(
    `INSERT INTO pairing_claim_attempts (code_hash, attempt_count, expires_at)
     VALUES (?, 1, ?)
     ON CONFLICT(code_hash) DO UPDATE SET
       attempt_count = attempt_count + 1,
       expires_at = excluded.expires_at`,
  ).run(codeHash, input.now + input.codeTtlMs);

  const pairing = db
    .prepare('SELECT * FROM pairing_requests WHERE code_hash = ?')
    .get(codeHash) as PairingRow | undefined;

  if (!pairing) {
    // Pesan generik: tidak membedakan kode salah dan kode tidak ada.
    throw badRequest('Kode pairing tidak valid atau sudah kedaluwarsa.');
  }

  if (pairing.status === 'EXPIRED' || pairing.status === 'REJECTED') {
    throw gone('Kode pairing sudah ditutup.');
  }
  if (pairing.code_expires_at <= input.now) {
    markPairingExpired(db, pairing, input.now);
    throw gone('Kode pairing sudah kedaluwarsa.');
  }

  const secretHash = sha256Hex(input.deviceSecret);

  if (pairing.status !== 'OPEN') {
    // Retry claim yang responsnya hilang: hanya boleh dengan device secret yang sama.
    if (pairing.claim_secret_hash && safeEqualHex(pairing.claim_secret_hash, secretHash)) {
      const rotated = randomToken();
      const claimExpiresAt = input.now + input.claimTtlMs;
      db.prepare(
        'UPDATE pairing_requests SET claim_token_hash = ?, claim_token_expires_at = ? WHERE id = ?',
      ).run(sha256Hex(rotated), claimExpiresAt, pairing.id);
      const refreshed = getPairingById(db, pairing.id);
      if (!refreshed?.device_id) throw conflict('Enrollment tidak konsisten.');
      return {
        pairing: refreshed,
        deviceId: refreshed.device_id,
        claimToken: rotated,
        claimExpiresAt,
        verificationCode: refreshed.verification_code ?? '',
      };
    }
    throw conflict('Kode pairing sudah dipakai perangkat lain.');
  }

  const claimToken = randomToken();
  const claimExpiresAt = input.now + input.claimTtlMs;
  const verificationCode = generateVerificationCode();

  return db.transaction(() => {
    const device = createPendingDevice(db, {
      familyId: pairing.family_id,
      label: input.metadata.label,
      model: input.metadata.model,
      manufacturer: input.metadata.manufacturer,
      appVersion: input.metadata.appVersion,
      sdkInt: input.metadata.sdkInt,
      installationId: input.metadata.installationId,
      now: input.now,
    });
    createCredential(db, {
      deviceId: device.id,
      secretHash,
      activated: false,
      now: input.now,
    });

    const changed = db
      .prepare(
        `UPDATE pairing_requests SET
           status = 'CLAIMED',
           device_id = ?,
           claim_token_hash = ?,
           claim_token_expires_at = ?,
           claim_secret_hash = ?,
           verification_code = ?,
           verification_expires_at = ?,
           device_label = ?,
           device_model = ?,
           device_manufacturer = ?,
           app_version = ?,
           sdk_int = ?,
           installation_id = ?,
           attempt_count = attempt_count + 1
         WHERE id = ? AND status = 'OPEN'`,
      )
      .run(
        device.id,
        sha256Hex(claimToken),
        claimExpiresAt,
        secretHash,
        verificationCode,
        input.now + input.claimTtlMs,
        input.metadata.label,
        input.metadata.model,
        input.metadata.manufacturer,
        input.metadata.appVersion,
        input.metadata.sdkInt,
        input.metadata.installationId,
        pairing.id,
      ).changes;

    if (changed !== 1) {
      throw conflict('Kode pairing sudah dipakai perangkat lain.');
    }

    recordAudit(db, {
      familyId: pairing.family_id,
      actorType: 'DEVICE',
      actorId: device.id,
      deviceId: device.id,
      action: 'pairing.claim',
      outcome: 'SUCCESS',
      metadata: { pairingId: pairing.id },
      now: input.now,
    });

    const claimed = getPairingById(db, pairing.id);
    if (!claimed) throw new Error('Pairing hilang setelah claim');
    return {
      pairing: claimed,
      deviceId: device.id,
      claimToken,
      claimExpiresAt,
      verificationCode,
    };
  })();
}

function assertClaimToken(pairing: PairingRow, claimToken: string): void {
  if (!pairing.claim_token_hash || !safeEqualHex(pairing.claim_token_hash, sha256Hex(claimToken))) {
    throw unauthorized('Token enrollment tidak valid.');
  }
}

export function confirmLocal(
  db: Db,
  input: { pairingId: string; claimToken: string; accepted: boolean; now: number },
): PairingRow {
  return db.transaction(() => {
    const pairing = getPairingById(db, input.pairingId);
    if (!pairing) throw notFound('Enrollment tidak ditemukan.');
    assertClaimToken(pairing, input.claimToken);

    if (pairing.status === 'APPROVED') return pairing;
    if (pairing.status === 'REJECTED') throw conflict('Permintaan pairing sudah ditolak.');
    if (pairing.status === 'EXPIRED') throw gone('Permintaan pairing sudah kedaluwarsa.');
    if ((pairing.claim_token_expires_at ?? 0) <= input.now) {
      markPairingExpired(db, pairing, input.now);
      throw gone('Permintaan pairing sudah kedaluwarsa.');
    }

    if (!input.accepted) {
      transitionPairing(pairing.status, 'reject');
      db.prepare(`UPDATE pairing_requests SET status = 'REJECTED', rejected_at = ?,
        reject_reason = 'LOCAL_CONSENT_DENIED' WHERE id = ?`).run(input.now, pairing.id);
      if (pairing.device_id) {
        revokeDeviceTx(db, {
          familyId: pairing.family_id,
          deviceId: pairing.device_id,
          now: input.now,
        });
      }
      recordAudit(db, {
        familyId: pairing.family_id,
        actorType: 'DEVICE',
        actorId: pairing.device_id,
        deviceId: pairing.device_id,
        action: 'pairing.local_denied',
        outcome: 'SUCCESS',
        metadata: { pairingId: pairing.id },
        now: input.now,
      });
      const rejected = getPairingById(db, pairing.id);
      if (!rejected) throw new Error('Pairing hilang setelah penolakan');
      return rejected;
    }

    if (pairing.status === 'LOCAL_CONFIRMED') return pairing;

    const outcome = transitionPairing(pairing.status, 'local-confirm');
    db.prepare(
      'UPDATE pairing_requests SET status = ?, local_confirmed_at = ? WHERE id = ?',
    ).run(outcome.status, input.now, pairing.id);

    recordAudit(db, {
      familyId: pairing.family_id,
      actorType: 'DEVICE',
      actorId: pairing.device_id,
      deviceId: pairing.device_id,
      action: 'pairing.local_confirm',
      outcome: 'SUCCESS',
      metadata: { pairingId: pairing.id },
      now: input.now,
    });

    const confirmed = getPairingById(db, pairing.id);
    if (!confirmed) throw new Error('Pairing hilang setelah persetujuan lokal');
    return confirmed;
  })();
}

export function getEnrollment(
  db: Db,
  input: { pairingId: string; claimToken: string },
): PairingRow {
  const pairing = getPairingById(db, input.pairingId);
  if (!pairing) throw notFound('Enrollment tidak ditemukan.');
  assertClaimToken(pairing, input.claimToken);
  return pairing;
}

export function approvePairing(
  db: Db,
  input: {
    pairingId: string;
    familyId: string;
    actorTelegramId: number;
    verificationCode: string;
    now: number;
  },
): PairingRow {
  return db.transaction(() => {
    const pairing = getPairingForFamily(db, input.pairingId, input.familyId);
    if (!pairing) throw notFound('Permintaan pairing tidak ditemukan.');

    if (pairing.status === 'APPROVED') return pairing;
    if (pairing.status === 'REJECTED') throw conflict('Permintaan pairing sudah ditolak.');
    if (pairing.status === 'EXPIRED') throw gone('Permintaan pairing sudah kedaluwarsa.');
    if ((pairing.verification_expires_at ?? 0) <= input.now) {
      markPairingExpired(db, pairing, input.now);
      throw gone('Kode verifikasi sudah kedaluwarsa.');
    }
    if (pairing.status !== 'LOCAL_CONFIRMED') {
      throw conflict('Persetujuan lokal di perangkat belum diterima.');
    }
    if (!pairing.device_id) {
      throw conflict('Perangkat belum terdaftar pada permintaan pairing ini.');
    }
    if (pairing.verification_code !== input.verificationCode) {
      db.prepare(
        'UPDATE pairing_requests SET verification_attempts = verification_attempts + 1 WHERE id = ?',
      ).run(pairing.id);
      recordAudit(db, {
        familyId: pairing.family_id,
        actorType: 'PARENT',
        actorId: String(input.actorTelegramId),
        deviceId: pairing.device_id,
        action: 'pairing.approve',
        outcome: 'DENIED',
        metadata: { pairingId: pairing.id, reason: 'VERIFICATION_CODE_MISMATCH' },
        now: input.now,
      });
      throw conflict('Kode verifikasi tidak cocok.');
    }

    const outcome = transitionPairing(pairing.status, 'approve');
    db.prepare(
      `UPDATE pairing_requests SET status = ?, approved_at = ? WHERE id = ?`,
    ).run(outcome.status, input.now, pairing.id);

    db.prepare(
      `UPDATE devices SET status = 'ACTIVE', paired_at = ?, updated_at = ?
        WHERE id = ? AND family_id = ? AND status = 'PENDING'`,
    ).run(input.now, input.now, pairing.device_id, pairing.family_id);

    db.prepare(
      `UPDATE device_credentials SET activated_at = ?
        WHERE device_id = ? AND activated_at IS NULL AND revoked_at IS NULL`,
    ).run(input.now, pairing.device_id);

    recordAudit(db, {
      familyId: pairing.family_id,
      actorType: 'PARENT',
      actorId: String(input.actorTelegramId),
      deviceId: pairing.device_id,
      action: 'pairing.approve',
      outcome: 'SUCCESS',
      metadata: { pairingId: pairing.id },
      now: input.now,
    });

    const approved = getPairingById(db, pairing.id);
    if (!approved) throw new Error('Pairing hilang setelah persetujuan');
    return approved;
  })();
}

export function rejectPairing(
  db: Db,
  input: { pairingId: string; familyId: string; reason: string; now: number },
): PairingRow {
  return db.transaction(() => {
    const pairing = getPairingForFamily(db, input.pairingId, input.familyId);
    if (!pairing) throw notFound('Permintaan pairing tidak ditemukan.');
    if (pairing.status === 'REJECTED') return pairing;
    if (pairing.status === 'APPROVED') throw conflict('Pairing sudah disetujui.');

    transitionPairing(pairing.status, 'reject');
    db.prepare(
      `UPDATE pairing_requests SET status = 'REJECTED', rejected_at = ?, reject_reason = ?
        WHERE id = ?`,
    ).run(input.now, input.reason, pairing.id);

    if (pairing.device_id) {
      revokeDeviceTx(db, { familyId: pairing.family_id, deviceId: pairing.device_id, now: input.now });
    }

    recordAudit(db, {
      familyId: pairing.family_id,
      actorType: 'PARENT',
      deviceId: pairing.device_id,
      action: 'pairing.reject',
      outcome: 'SUCCESS',
      metadata: { pairingId: pairing.id },
      now: input.now,
    });

    const rejected = getPairingById(db, pairing.id);
    if (!rejected) throw new Error('Pairing hilang setelah penolakan');
    return rejected;
  })();
}

export function expirePairings(db: Db, now: number): number {
  const rows = db
    .prepare(
      `SELECT * FROM pairing_requests
        WHERE status IN ('OPEN', 'CLAIMED', 'LOCAL_CONFIRMED')
          AND (code_expires_at <= ?
               OR (claim_token_expires_at IS NOT NULL AND claim_token_expires_at <= ?))`,
    )
    .all(now, now) as PairingRow[];

  for (const row of rows) markPairingExpired(db, row, now);
  return rows.length;
}
