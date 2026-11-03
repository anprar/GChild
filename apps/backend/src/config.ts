import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/gchild.sqlite'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  PAIRING_CODE_PEPPER: z
    .string()
    .min(32, 'PAIRING_CODE_PEPPER minimal 32 karakter acak'),

  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_PARENT_IDS: z.string().optional(),
  TELEGRAM_NOTIFIER_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),

  PAIRING_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  ENROLLMENT_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  COMMAND_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  COMMAND_LEASE_SECONDS: z.coerce.number().int().positive().default(30),
  STATUS_STALE_SECONDS: z.coerce.number().int().positive().default(900),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databasePath: string;
  logLevel: string;
  pairingCodePepper: string;
  telegramBotToken: string | null;
  telegramParentIds: ReadonlySet<number>;
  telegramNotifierIntervalMs: number;
  pairingCodeTtlMs: number;
  enrollmentTtlMs: number;
  commandTtlMs: number;
  commandLeaseMs: number;
  statusStaleMs: number;
  retentionDays: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    // Hanya nama variabel dan pesan validasi; nilai secret tidak pernah dicetak.
    throw new Error(`Konfigurasi environment tidak valid: ${detail}`);
  }
  const value = parsed.data;

  const parentIds = new Set<number>();
  for (const part of (value.TELEGRAM_PARENT_IDS ?? '').split(',').map((item) => item.trim())) {
    if (part === '') continue;
    if (!/^\d+$/.test(part)) {
      throw new Error('TELEGRAM_PARENT_IDS harus berisi daftar angka user id Telegram');
    }
    parentIds.add(Number(part));
  }

  return {
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    databasePath: value.DATABASE_PATH,
    logLevel: value.LOG_LEVEL,
    pairingCodePepper: value.PAIRING_CODE_PEPPER,
    telegramBotToken: value.TELEGRAM_BOT_TOKEN ?? null,
    telegramParentIds: parentIds,
    telegramNotifierIntervalMs: value.TELEGRAM_NOTIFIER_INTERVAL_MS,
    pairingCodeTtlMs: value.PAIRING_CODE_TTL_SECONDS * 1000,
    enrollmentTtlMs: value.ENROLLMENT_TTL_SECONDS * 1000,
    commandTtlMs: value.COMMAND_TTL_SECONDS * 1000,
    commandLeaseMs: value.COMMAND_LEASE_SECONDS * 1000,
    statusStaleMs: value.STATUS_STALE_SECONDS * 1000,
    retentionDays: value.RETENTION_DAYS,
  };
}
