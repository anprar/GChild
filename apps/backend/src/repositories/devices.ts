import type { Db } from '../db/client.js';
import { newId } from '../lib/ids.js';

export type DeviceStatusValue = 'PENDING' | 'ACTIVE' | 'REVOKED';

export interface DeviceRow {
  id: string;
  family_id: string;
  label: string;
  model: string | null;
  manufacturer: string | null;
  platform: string;
  app_version: string | null;
  sdk_int: number | null;
  installation_id: string;
  status: DeviceStatusValue;
  paired_at: number | null;
  last_seen_at: number | null;
  revoked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface DeviceAuthRecord {
  deviceId: string;
  familyId: string;
  credentialId: string;
}

export function listDevicesForFamily(db: Db, familyId: string): DeviceRow[] {
  return db
    .prepare(
      `SELECT * FROM devices WHERE family_id = ? ORDER BY created_at ASC, label ASC`,
    )
    .all(familyId) as DeviceRow[];
}

export function getDeviceForFamily(db: Db, familyId: string, deviceId: string): DeviceRow | null {
  const row = db
    .prepare('SELECT * FROM devices WHERE id = ? AND family_id = ?')
    .get(deviceId, familyId) as DeviceRow | undefined;
  return row ?? null;
}

export function getDeviceById(db: Db, deviceId: string): DeviceRow | null {
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as
    | DeviceRow
    | undefined;
  return row ?? null;
}

export function createPendingDevice(
  db: Db,
  input: {
    familyId: string;
    label: string;
    model: string | null;
    manufacturer: string | null;
    appVersion: string | null;
    sdkInt: number | null;
    installationId: string;
    now: number;
  },
): DeviceRow {
  const id = newId('dev');
  db.prepare(
    `INSERT INTO devices
       (id, family_id, label, model, manufacturer, platform, app_version, sdk_int,
        installation_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'android', ?, ?, ?, 'PENDING', ?, ?)`,
  ).run(
    id,
    input.familyId,
    input.label,
    input.model,
    input.manufacturer,
    input.appVersion,
    input.sdkInt,
    input.installationId,
    input.now,
    input.now,
  );
  const device = getDeviceById(db, id);
  if (!device) throw new Error('Device gagal dibuat');
  return device;
}

export function createCredential(
  db: Db,
  input: { deviceId: string; secretHash: string; activated: boolean; now: number },
): string {
  const id = newId('cred');
  db.prepare(
    `INSERT INTO device_credentials (id, device_id, secret_hash, created_at, activated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.deviceId, input.secretHash, input.now, input.activated ? input.now : null);
  return id;
}

export function activateDeviceTx(db: Db, deviceId: string, now: number): void {
  const changed = db
    .prepare(
      `UPDATE devices SET status = 'ACTIVE', paired_at = ?, updated_at = ?
        WHERE id = ? AND status = 'PENDING'`,
    )
    .run(now, now, deviceId).changes;
  if (changed !== 1) {
    throw new Error(`Device ${deviceId} tidak berada pada status PENDING`);
  }
  db.prepare(
    `UPDATE device_credentials SET activated_at = ?
      WHERE device_id = ? AND activated_at IS NULL AND revoked_at IS NULL`,
  ).run(now, deviceId);
}

/**
 * Revocation langsung berlaku: credential dicabut dan command QUEUED dibatalkan
 * dalam satu transaksi. Idempotent bila perangkat sudah REVOKED.
 */
export function revokeDeviceTx(
  db: Db,
  input: { familyId: string; deviceId: string; now: number },
): boolean {
  return db.transaction(() => {
    const device = getDeviceForFamily(db, input.familyId, input.deviceId);
    if (!device) return false;

    db.prepare(
      `UPDATE devices SET status = 'REVOKED', revoked_at = COALESCE(revoked_at, ?), updated_at = ?
        WHERE id = ? AND family_id = ?`,
    ).run(input.now, input.now, input.deviceId, input.familyId);

    db.prepare(
      `UPDATE device_credentials SET revoked_at = ?
        WHERE device_id = ? AND revoked_at IS NULL`,
    ).run(input.now, input.deviceId);

    db.prepare(
      `UPDATE commands SET state = 'CANCELLED', completed_at = ?
        WHERE device_id = ? AND state = 'QUEUED'`,
    ).run(input.now, input.deviceId);

    return true;
  })();
}

export function findAuthByCredentialHash(db: Db, secretHash: string): DeviceAuthRecord | null {
  const row = db
    .prepare(
      `SELECT c.id AS credential_id, d.id AS device_id, d.family_id
         FROM device_credentials c
         JOIN devices d ON d.id = c.device_id
        WHERE c.secret_hash = ?
          AND c.revoked_at IS NULL
          AND c.activated_at IS NOT NULL
          AND d.status = 'ACTIVE'`,
    )
    .get(secretHash) as
    | { credential_id: string; device_id: string; family_id: string }
    | undefined;

  if (!row) return null;
  return {
    deviceId: row.device_id,
    familyId: row.family_id,
    credentialId: row.credential_id,
  };
}

export function touchDevicePresence(
  db: Db,
  input: { deviceId: string; credentialId: string; now: number },
): void {
  db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(input.now, input.deviceId);
  db.prepare('UPDATE device_credentials SET last_used_at = ? WHERE id = ?').run(
    input.now,
    input.credentialId,
  );
}

export function findActiveCredentialId(db: Db, deviceId: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM device_credentials
        WHERE device_id = ? AND activated_at IS NOT NULL AND revoked_at IS NULL`,
    )
    .get(deviceId) as { id: string } | undefined;
  return row?.id ?? null;
}
