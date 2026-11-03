import { openDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { loadDatabasePath } from '../src/db/path.js';

/**
 * Prune retensi. Default dry-run: tidak menghapus apa pun tanpa --apply.
 * Snapshot status terakhir tidak pernah dihapus, dan command aktif tidak disentuh.
 */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
}

const apply = process.argv.includes('--apply');
const days = Number(arg('days') ?? process.env.RETENTION_DAYS ?? '30');
if (!Number.isFinite(days) || days <= 0) {
  console.error('Retensi hari harus angka positif.');
  process.exit(1);
}

const cutoff = Date.now() - days * 86_400_000;
const db = openDatabase(loadDatabasePath());

try {
  migrate(db);

  const counts = {
    auditLogs: (
      db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE created_at < ?').get(cutoff) as {
        count: number;
      }
    ).count,
    finishedCommands: (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM commands
            WHERE completed_at IS NOT NULL AND completed_at < ?
              AND state IN ('SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED')`,
        )
        .get(cutoff) as { count: number }
    ).count,
    closedPairings: (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM pairing_requests
            WHERE created_at < ? AND status IN ('APPROVED', 'REJECTED', 'EXPIRED')`,
        )
        .get(cutoff) as { count: number }
    ).count,
  };

  if (!apply) {
    console.log(`Dry-run retensi ${days} hari (cutoff ${new Date(cutoff).toISOString()}):`);
    console.log(JSON.stringify(counts, null, 2));
    console.log('Tidak ada yang dihapus. Jalankan dengan --apply untuk menghapus.');
  } else {
    db.transaction(() => {
      db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(cutoff);
      db.prepare(
        `DELETE FROM command_results WHERE command_id IN (
           SELECT id FROM commands
            WHERE completed_at IS NOT NULL AND completed_at < ?
              AND state IN ('SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'))`,
      ).run(cutoff);
      db.prepare(
        `DELETE FROM commands
          WHERE completed_at IS NOT NULL AND completed_at < ?
            AND state IN ('SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED')`,
      ).run(cutoff);
      db.prepare(
        `DELETE FROM pairing_requests
          WHERE created_at < ? AND status IN ('APPROVED', 'REJECTED', 'EXPIRED')`,
      ).run(cutoff);
      db.prepare('DELETE FROM pairing_claim_attempts WHERE expires_at < ?').run(cutoff);
    })();
    console.log(`Prune diterapkan untuk data lebih lama dari ${days} hari.`);
  }
} finally {
  db.close();
}
