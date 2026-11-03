import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';
import { startSweeper } from './jobs/sweeper.js';
import { createParentBot } from './telegram/parent-bot.js';
import { startNotifier } from './telegram/notifier.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const migration = migrate(db);

  const app = buildApp({ db, config });
  await app.listen({ host: config.host, port: config.port });

  app.log.info(
    {
      port: config.port,
      host: config.host,
      migrationsApplied: migration.applied.length,
      telegramChannel: config.telegramBotToken ? 'enabled' : 'disabled',
    },
    'GChild server berjalan',
  );

  if (!config.telegramBotToken) {
    app.log.warn(
      'TELEGRAM_BOT_TOKEN kosong. Kanal Parent (bot Telegram) tidak aktif; Companion tetap bisa enroll jika kode dibuat lewat CLI.',
    );
  }

  const sweeper = startSweeper(db, {
    onRun: (result) => {
      if (result.expired || result.failed || result.pairingsExpired) {
        app.log.info(result, 'Sweeper menandai command/pairing kedaluwarsa');
      }
    },
  });

  const bot = config.telegramBotToken ? createParentBot({ db, config }) : null;
  let stopNotifier: (() => void) | null = null;

  if (bot && config.telegramBotToken) {
    await bot.init();
    void bot.start({
      onStart: (info) => app.log.info({ username: info.username }, 'Bot Telegram aktif'),
    });
    stopNotifier = startNotifier({
      db,
      intervalMs: config.telegramNotifierIntervalMs,
      send: async (chatId, text) => {
        await bot.api.sendMessage(chatId, text);
      },
      onError: (error) => {
        app.log.warn(
          { errorName: (error as Error)?.name, errorMessage: (error as Error)?.message },
          'Notifikasi Telegram gagal dikirim; akan dicoba lagi',
        );
      },
    });
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Mematikan server');
    stopNotifier?.();
    sweeper.stop();
    if (bot) {
      try {
        await bot.stop();
      } catch (error) {
        app.log.warn({ errorMessage: (error as Error)?.message }, 'Bot gagal berhenti bersih');
      }
    }
    await app.close();
    db.close();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal).then(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  // Pesan error config tidak memuat nilai secret.
  console.error('GChild gagal start:', (error as Error)?.message ?? 'kesalahan tidak dikenal');
  process.exit(1);
});
