import type { Db } from '../db/client.js';
import { conflict } from '../lib/errors.js';
import { newId } from '../lib/ids.js';

export type MemberRole = 'OWNER' | 'ADMIN';

export interface Membership {
  familyId: string;
  familyName: string;
  telegramUserId: number;
  role: MemberRole;
}

export function createFamilyWithOwner(
  db: Db,
  input: { name: string; telegramUserId: number; now: number },
): { familyId: string } {
  const existing = findMembership(db, input.telegramUserId);
  if (existing) {
    throw conflict('User Telegram ini sudah menjadi anggota keluarga lain.');
  }
  const familyId = newId('fam');
  db.transaction(() => {
    db.prepare('INSERT INTO families (id, name, created_at) VALUES (?, ?, ?)').run(
      familyId,
      input.name,
      input.now,
    );
    db.prepare(
      'INSERT INTO family_members (family_id, telegram_user_id, role, created_at) VALUES (?, ?, ?, ?)',
    ).run(familyId, input.telegramUserId, 'OWNER', input.now);
  })();
  return { familyId };
}

export function findMembership(db: Db, telegramUserId: number): Membership | null {
  const row = db
    .prepare(
      `SELECT m.family_id, m.telegram_user_id, m.role, f.name AS family_name
         FROM family_members m
         JOIN families f ON f.id = m.family_id
        WHERE m.telegram_user_id = ?`,
    )
    .get(telegramUserId) as
    | { family_id: string; telegram_user_id: number; role: MemberRole; family_name: string }
    | undefined;

  if (!row) return null;
  return {
    familyId: row.family_id,
    familyName: row.family_name,
    telegramUserId: row.telegram_user_id,
    role: row.role,
  };
}

export function countFamilies(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM families').get() as { count: number };
  return row.count;
}
