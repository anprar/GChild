import type { Db } from '../db/client.js';
import {
  transitionCommand,
  type AckStatus,
  type CommandState,
} from '../domain/command-state.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { recordAudit } from './audit.js';

export type CommandType = 'REQUEST_STATUS' | 'LOCK_SCREEN';

export const MAX_QUEUED_COMMANDS = 20;
const MAX_BLOB_LENGTH = 4096;

export interface CommandRow {
  id: string;
  family_id: string;
  device_id: string;
  type: CommandType;
  payload_json: string;
  state: CommandState;
  requested_by: number;
  idempotency_key: string | null;
  created_at: number;
  expires_at: number;
  received_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  delivery_count: number;
  last_delivered_at: number | null;
  lease_expires_at: number | null;
  result_json: string | null;
  error_json: string | null;
  notified_at: number | null;
}

export type CommandWithDevice = CommandRow & { device_label: string };

export function getCommandById(db: Db, commandId: string): CommandRow | null {
  const row = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId) as
    | CommandRow
    | undefined;
  return row ?? null;
}

export function getCommandForFamily(
  db: Db,
  input: { familyId: string; commandId: string },
): CommandRow | null {
  const row = db
    .prepare('SELECT * FROM commands WHERE id = ? AND family_id = ?')
    .get(input.commandId, input.familyId) as CommandRow | undefined;
  return row ?? null;
}

/**
 * Membuat command QUEUED. Termasuk batas antrean dan idempotency key.
 * Tidak ada status sukses di sini; hasil hanya dari ACK perangkat.
 */
export function createCommand(
  db: Db,
  input: {
    familyId: string;
    deviceId: string;
    type: CommandType;
    expiresAt: number;
    requestedBy: number;
    idempotencyKey?: string | null;
    payload?: Record<string, unknown>;
    now: number;
  },
): { command: CommandRow; created: boolean } {
  return db.transaction(() => {
    if (input.idempotencyKey) {
      const existing = db
        .prepare('SELECT * FROM commands WHERE requested_by = ? AND idempotency_key = ?')
        .get(input.requestedBy, input.idempotencyKey) as CommandRow | undefined;
      if (existing) return { command: existing, created: false };
    }

    // Command kedaluwarsa tidak boleh menahan slot antrean.
    db.prepare(
      `UPDATE commands SET state = 'EXPIRED', completed_at = ?
        WHERE device_id = ? AND state = 'QUEUED' AND expires_at <= ?`,
    ).run(input.now, input.deviceId, input.now);

    const queued = db
      .prepare(`SELECT COUNT(*) AS count FROM commands WHERE device_id = ? AND state = 'QUEUED'`)
      .get(input.deviceId) as { count: number };
    if (queued.count >= MAX_QUEUED_COMMANDS) {
      throw new AppError(
        409,
        'CONFLICT',
        `Antrean command perangkat penuh (maks ${MAX_QUEUED_COMMANDS}).`,
        { reason: 'COMMAND_QUEUE_FULL' },
      );
    }

    const id = newId('cmd');
    db.prepare(
      `INSERT INTO commands
         (id, family_id, device_id, type, payload_json, state, requested_by,
          idempotency_key, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)`,
    ).run(
      id,
      input.familyId,
      input.deviceId,
      input.type,
      JSON.stringify(input.payload ?? {}),
      input.requestedBy,
      input.idempotencyKey ?? null,
      input.now,
      input.expiresAt,
    );

    recordAudit(db, {
      familyId: input.familyId,
      actorType: 'PARENT',
      actorId: String(input.requestedBy),
      deviceId: input.deviceId,
      action: 'command.create',
      outcome: 'SUCCESS',
      metadata: { commandId: id, type: input.type, expiresAt: input.expiresAt },
      now: input.now,
    });

    const command = getCommandById(db, id);
    if (!command) throw new Error('Command gagal dibuat');
    return { command, created: true };
  })();
}

export function listRecentCommands(
  db: Db,
  familyId: string,
  limit = 10,
): CommandWithDevice[] {
  return db
    .prepare(
      `SELECT c.*, d.label AS device_label
         FROM commands c
         JOIN devices d ON d.id = c.device_id
        WHERE c.family_id = ?
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ?`,
    )
    .all(familyId, limit) as CommandWithDevice[];
}

/** GET tidak mengubah state; hanya delivery_count untuk observability. */
export function fetchQueuedForDevice(
  db: Db,
  input: { deviceId: string; now: number; limit: number },
): CommandRow[] {
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT * FROM commands
          WHERE device_id = ? AND state = 'QUEUED' AND expires_at > ?
          ORDER BY created_at ASC, id ASC
          LIMIT ?`,
      )
      .all(input.deviceId, input.now, input.limit) as CommandRow[];

    for (const row of rows) {
      db.prepare(
        `UPDATE commands SET delivery_count = delivery_count + 1, last_delivered_at = ?
          WHERE id = ?`,
      ).run(input.now, row.id);
    }
    return rows;
  })();
}

export interface AckInput {
  deviceId: string;
  commandId: string;
  ackId: string;
  status: AckStatus;
  result?: Record<string, unknown> | null;
  error?: { code: string; message?: string } | null;
  observedAt?: number | null;
  now: number;
  leaseMs: number;
}

/**
 * ACK idempotent per (command_id, ack_id). Final state tidak dapat diubah dan
 * ACK yang datang setelah command kedaluwarsa tidak pernah menghasilkan SUCCEEDED.
 */
export function ackCommand(
  db: Db,
  input: AckInput,
): { command: CommandRow; idempotent: boolean } {
  return db.transaction(() => {
    const command = db
      .prepare('SELECT * FROM commands WHERE id = ? AND device_id = ?')
      .get(input.commandId, input.deviceId) as CommandRow | undefined;
    if (!command) {
      throw notFound('Command tidak ditemukan untuk perangkat ini.');
    }

    const prior = db
      .prepare('SELECT status FROM command_results WHERE command_id = ? AND ack_id = ?')
      .get(input.commandId, input.ackId) as { status: string } | undefined;
    if (prior) {
      if (prior.status !== input.status) {
        throw new AppError(
          409,
          'FINAL_STATE_ALREADY_SET',
          'ackId sudah dipakai untuk status lain.',
        );
      }
      const current = getCommandById(db, command.id);
      if (!current) throw notFound('Command tidak ditemukan.');
      return { command: current, idempotent: true };
    }

    const resultJson = input.result ? JSON.stringify(input.result) : null;
    const errorJson = input.error ? JSON.stringify(input.error) : null;
    if ((resultJson?.length ?? 0) > MAX_BLOB_LENGTH || (errorJson?.length ?? 0) > MAX_BLOB_LENGTH) {
      throw badRequest('Payload ACK terlalu besar.');
    }

    const outcome = transitionCommand(command.state, { type: 'ack', status: input.status });
    let nextState: CommandState = outcome.state;

    // Perangkat meng-ACK RECEIVED setelah TTL habis: jangan pernah izinkan eksekusi.
    if (input.status === 'RECEIVED' && outcome.state === 'RECEIVED' && input.now >= command.expires_at) {
      nextState = 'EXPIRED';
    }

    switch (nextState) {
      case 'RECEIVED':
        db.prepare(
          `UPDATE commands SET state = 'RECEIVED', received_at = COALESCE(received_at, ?)
            WHERE id = ?`,
        ).run(input.now, command.id);
        break;
      case 'EXECUTING':
        db.prepare(
          `UPDATE commands SET state = 'EXECUTING', started_at = ?, lease_expires_at = ?
            WHERE id = ?`,
        ).run(input.now, input.now + input.leaseMs, command.id);
        break;
      case 'SUCCEEDED':
      case 'FAILED':
        db.prepare(
          `UPDATE commands SET state = ?, completed_at = ?,
             result_json = COALESCE(?, result_json), error_json = COALESCE(?, error_json)
            WHERE id = ?`,
        ).run(nextState, input.now, resultJson, errorJson, command.id);
        break;
      case 'EXPIRED':
        db.prepare(
          `UPDATE commands SET state = 'EXPIRED', completed_at = ? WHERE id = ?`,
        ).run(input.now, command.id);
        break;
      default:
        throw conflict('Transisi ACK tidak didukung.', 'INVALID_STATE_TRANSITION');
    }

    db.prepare(
      `INSERT INTO command_results
         (id, command_id, ack_id, status, result_json, error_json, observed_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('ack'),
      command.id,
      input.ackId,
      input.status,
      resultJson,
      errorJson,
      input.observedAt ?? null,
      input.now,
    );

    if (nextState === 'SUCCEEDED' || nextState === 'FAILED' || nextState === 'EXPIRED') {
      recordAudit(db, {
        familyId: command.family_id,
        actorType: 'DEVICE',
        actorId: command.device_id,
        deviceId: command.device_id,
        action: 'command.final',
        outcome: nextState === 'SUCCEEDED' ? 'SUCCESS' : 'FAILURE',
        metadata: { commandId: command.id, state: nextState, ackId: input.ackId },
        now: input.now,
      });
    }

    const updated = getCommandById(db, command.id);
    if (!updated) throw new Error('Command hilang setelah ACK');
    return { command: updated, idempotent: outcome.idempotent };
  })();
}

export function cancelCommand(
  db: Db,
  input: { familyId: string; commandId: string; actorTelegramId: number; now: number },
): CommandRow {
  return db.transaction(() => {
    const command = getCommandForFamily(db, {
      familyId: input.familyId,
      commandId: input.commandId,
    });
    if (!command) throw notFound('Command tidak ditemukan.');

    const outcome = transitionCommand(command.state, { type: 'cancel' });
    db.prepare(`UPDATE commands SET state = ?, completed_at = ? WHERE id = ?`).run(
      outcome.state,
      input.now,
      command.id,
    );

    recordAudit(db, {
      familyId: command.family_id,
      actorType: 'PARENT',
      actorId: String(input.actorTelegramId),
      deviceId: command.device_id,
      action: 'command.cancel',
      outcome: 'SUCCESS',
      metadata: { commandId: command.id },
      now: input.now,
    });

    const updated = getCommandById(db, command.id);
    if (!updated) throw new Error('Command hilang setelah cancel');
    return updated;
  })();
}

/**
 * Sweeper: QUEUED/RECEIVED lewat TTL menjadi EXPIRED; EXECUTING lewat lease
 * menjadi FAILED (timeout). Tidak ada requeue otomatis.
 */
export function sweepCommands(db: Db, now: number): { expired: number; failed: number } {
  return db.transaction(() => {
    const expired = db
      .prepare(
        `UPDATE commands SET state = 'EXPIRED', completed_at = ?
          WHERE state IN ('QUEUED', 'RECEIVED') AND expires_at <= ?
          RETURNING id, family_id, device_id`,
      )
      .all(now, now) as { id: string; family_id: string; device_id: string }[];

    const failed = db
      .prepare(
        `UPDATE commands SET state = 'FAILED', completed_at = ?, error_json = ?
          WHERE state = 'EXECUTING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
          RETURNING id, family_id, device_id`,
      )
      .all(now, JSON.stringify({ code: 'TIMEOUT_DURING_EXECUTION' }), now) as {
      id: string;
      family_id: string;
      device_id: string;
    }[];

    for (const row of [...expired, ...failed]) {
      recordAudit(db, {
        familyId: row.family_id,
        actorType: 'SYSTEM',
        deviceId: row.device_id,
        action: 'command.sweep',
        outcome: 'SUCCESS',
        metadata: { commandId: row.id },
        now,
      });
    }

    return { expired: expired.length, failed: failed.length };
  })();
}

export function listUnnotifiedTerminalCommands(db: Db, limit = 20): CommandWithDevice[] {
  return db
    .prepare(
      `SELECT c.*, d.label AS device_label
         FROM commands c
         JOIN devices d ON d.id = c.device_id
        WHERE c.state IN ('SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED')
          AND c.notified_at IS NULL
          AND c.completed_at IS NOT NULL
        ORDER BY c.completed_at ASC
        LIMIT ?`,
    )
    .all(limit) as CommandWithDevice[];
}

export function markCommandsNotified(db: Db, ids: string[], now: number): void {
  const statement = db.prepare('UPDATE commands SET notified_at = ? WHERE id = ?');
  db.transaction(() => {
    for (const id of ids) statement.run(now, id);
  })();
}
