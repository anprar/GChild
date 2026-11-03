import { openDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { loadDatabasePath } from '../src/db/path.js';
import { createFamilyWithOwner } from '../src/repositories/families.js';

/**
 * Bootstrap keluarga + owner Telegram. Tidak ada public signup dan tidak ada
 * password yang dibaca dari argv. Output sengaja tidak memuat token apa pun.
 */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
}

const telegramIdRaw = arg('telegram-id') ?? process.env.GCHILD_TELEGRAM_ID;
if (!telegramIdRaw || !/^\d+$/.test(telegramIdRaw)) {
  console.error(
    'Pemakaian: npm run admin:create -w apps/backend -- --telegram-id=<id> [--family-name="Nama"]',
  );
  process.exit(1);
}

const familyName = arg('family-name') ?? process.env.GCHILD_FAMILY_NAME ?? 'Keluarga';

const db = openDatabase(loadDatabasePath());
try {
  migrate(db);
  const { familyId } = createFamilyWithOwner(db, {
    name: familyName,
    telegramUserId: Number(telegramIdRaw),
    now: Date.now(),
  });
  console.log(`Keluarga dibuat: ${familyId}`);
  console.log(`Owner Telegram ID: ${telegramIdRaw}`);
  console.log(
    'Langkah berikutnya: jalankan server dengan TELEGRAM_BOT_TOKEN, lalu kirim /start dari akun owner.',
  );
} catch (error) {
  console.error('Gagal membuat owner:', (error as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
