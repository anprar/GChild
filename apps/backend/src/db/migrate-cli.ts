import { openDatabase } from './client.js';
import { loadDatabasePath } from './path.js';
import { migrate } from './migrate.js';

function main(): void {
  const path = loadDatabasePath();
  const db = openDatabase(path);
  try {
    const result = migrate(db);
    if (result.applied.length === 0) {
      console.log(`Migrasi: tidak ada yang perlu diterapkan (versi ${result.version}).`);
    } else {
      console.log(`Migrasi diterapkan: ${result.applied.join(', ')} (versi ${result.version}).`);
    }
  } finally {
    db.close();
  }
}

main();
