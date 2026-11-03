import type { Db } from '../db/client.js';
import { newId } from '../lib/ids.js';

export type AuditActor = 'PARENT' | 'DEVICE' | 'SYSTEM';
export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

export interface AuditRow {
  id: string;
  family_id: string;
  actor_type: AuditActor;
  actor_id: string | null;
  device_id: string | null;
  action: string;
  outcome: AuditOutcome;
  metadata_json: string | null;
  created_at: number;
}

const MAX_METADATA_LENGTH = 2000;

export function recordAudit(
  db: Db,
  input: {
    familyId: string;
    actorType: AuditActor;
    actorId?: string | null;
    deviceId?: string | null;
    action: string;
    outcome: AuditOutcome;
    metadata?: Record<string, unknown>;
    now: number;
  },
): void {
  let metadata: string | null = null;
  if (input.metadata) {
    const raw = JSON.stringify(input.metadata);
    // Metadata tidak boleh memuat secret; batas panjang mencegah payload liar.
    metadata = raw.length > MAX_METADATA_LENGTH ? raw.slice(0, MAX_METADATA_LENGTH) : raw;
  }

  db.prepare(
    `INSERT INTO audit_logs
       (id, family_id, actor_type, actor_id, device_id, action, outcome, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId('aud'),
    input.familyId,
    input.actorType,
    input.actorId ?? null,
    input.deviceId ?? null,
    input.action,
    input.outcome,
    metadata,
    input.now,
  );
}

export function listAudit(db: Db, familyId: string, limit = 20): AuditRow[] {
  return db
    .prepare(
      `SELECT * FROM audit_logs WHERE family_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(familyId, limit) as AuditRow[];
}
