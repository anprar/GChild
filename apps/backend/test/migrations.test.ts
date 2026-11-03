import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { tempDatabasePath } from './helpers/app.js';

describe('migrasi', () => {
  it('MIG-01/02/03: membuat tabel, idempotent, foreign key aktif', () => {
    const temp = tempDatabasePath();
    const db = openDatabase(temp.path);
    try {
      const first = migrate(db, 1_000);
      expect(first.applied).toEqual(['001_init.sql']);

      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((row) => row.name);

      for (const table of [
        'families',
        'family_members',
        'devices',
        'device_credentials',
        'pairing_requests',
        'pairing_claim_attempts',
        'commands',
        'command_results',
        'device_status',
        'audit_logs',
        'schema_migrations',
      ]) {
        expect(tables).toContain(table);
      }

      const second = migrate(db, 2_000);
      expect(second.applied).toEqual([]);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

      expect(() =>
        db
          .prepare(
            `INSERT INTO devices
               (id, family_id, label, platform, installation_id, status, created_at, updated_at)
             VALUES ('dev_x', 'fam_missing', 'X', 'android', 'install-x', 'PENDING', 1, 1)`,
          )
          .run(),
      ).toThrow();
    } finally {
      db.close();
      temp.cleanup();
    }
  });
});
