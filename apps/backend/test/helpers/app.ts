import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { openDatabase, type Db } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';
import { randomToken } from '../../src/lib/crypto.js';
import { generatePairingCode } from '../../src/lib/pairing-code.js';
import { createFamilyWithOwner, findMembership, type Membership } from '../../src/repositories/families.js';
import { approvePairing, createPairingRequest } from '../../src/repositories/pairing.js';

export const TEST_PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';
export const TEST_BOT_TOKEN = '123456789:TEST-TOKEN-NOT-A-REAL-SECRET';

export interface TestClock {
  (): number;
  set(ms: number): void;
  advance(ms: number): void;
}

export function createClock(start = Date.parse('2026-11-03T08:00:00.000Z')): TestClock {
  let current = start;
  const clock = (() => current) as TestClock;
  clock.set = (ms: number) => {
    current = ms;
  };
  clock.advance = (ms: number) => {
    current += ms;
  };
  return clock;
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    PAIRING_CODE_PEPPER: TEST_PEPPER,
    LOG_LEVEL: 'error',
    TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export interface TestContext {
  db: Db;
  config: Config;
  app: FastifyInstance;
  clock: TestClock;
  cleanup: () => Promise<void>;
}

export interface CreateContextOptions {
  /** Path file untuk test restart; default ':memory:'. */
  databasePath?: string;
  clock?: TestClock;
  configOverrides?: Record<string, string>;
}

export async function createTestContext(options: CreateContextOptions = {}): Promise<TestContext> {
  const clock = options.clock ?? createClock();
  const databasePath = options.databasePath ?? ':memory:';
  const config = testConfig({
    DATABASE_PATH: databasePath,
    ...(options.configOverrides ?? {}),
  });
  const db = openDatabase(databasePath);
  migrate(db, clock());
  const app = buildApp({ db, config, now: clock });
  await app.ready();

  return {
    db,
    config,
    app,
    clock,
    cleanup: async () => {
      await app.close();
      db.close();
    },
  };
}

export function tempDatabasePath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gchild-test-'));
  return {
    path: join(dir, 'gchild.sqlite'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function seedFamily(
  ctx: TestContext,
  telegramId = 111111,
  name = 'Keluarga Uji',
): Membership {
  createFamilyWithOwner(ctx.db, { name, telegramUserId: telegramId, now: ctx.clock() });
  const membership = findMembership(ctx.db, telegramId);
  if (!membership) throw new Error('Seed keluarga gagal');
  return membership;
}

export interface PairedDevice {
  deviceId: string;
  credential: string;
  pairingId: string;
  verificationCode: string;
  installationId: string;
  label: string;
  telegramId: number;
  familyId: string;
}

/**
 * Menjalankan pairing lengkap lewat HTTP (claim + consent lokal) dan persetujuan
 * Parent lewat repository. Tidak ada shortcut yang melewati dua persetujuan.
 */
export async function pairDevice(
  ctx: TestContext,
  options: {
    telegramId?: number;
    label?: string;
    installationId?: string;
    model?: string;
    skipLocalConsent?: boolean;
  } = {},
): Promise<PairedDevice> {
  const telegramId = options.telegramId ?? 111111;
  const membership = findMembership(ctx.db, telegramId) ?? seedFamily(ctx, telegramId);
  const label = options.label ?? 'Perangkat Uji';
  const installationId = options.installationId ?? `install-${randomToken(6)}`;

  const code = generatePairingCode();
  const { pairing } = createPairingRequest(ctx.db, {
    familyId: membership.familyId,
    createdBy: telegramId,
    code,
    pepper: ctx.config.pairingCodePepper,
    now: ctx.clock(),
    ttlMs: ctx.config.pairingCodeTtlMs,
  });

  const deviceSecret = randomToken(32);
  const claimResponse = await ctx.app.inject({
    method: 'POST',
    url: '/v1/enrollment/claim',
    payload: {
      code,
      deviceSecret,
      device: {
        label,
        installationId,
        model: options.model ?? 'Test Device',
        manufacturer: 'Test',
        appVersion: 'test',
        sdkInt: 34,
      },
    },
  });
  if (claimResponse.statusCode !== 201) {
    throw new Error(`Claim gagal: ${claimResponse.statusCode} ${claimResponse.body}`);
  }
  const claim = claimResponse.json() as {
    enrollmentId: string;
    claimToken: string;
    verificationCode: string;
  };

  if (!options.skipLocalConsent) {
    const consent = await ctx.app.inject({
      method: 'POST',
      url: `/v1/enrollment/${claim.enrollmentId}/confirm-local`,
      headers: { 'x-enrollment-token': claim.claimToken },
      payload: { accepted: true, disclosureVersion: 'test-1' },
    });
    if (consent.statusCode !== 200) {
      throw new Error(`Consent lokal gagal: ${consent.statusCode} ${consent.body}`);
    }
  }

  const approved = approvePairing(ctx.db, {
    pairingId: claim.enrollmentId,
    familyId: membership.familyId,
    actorTelegramId: telegramId,
    verificationCode: claim.verificationCode,
    now: ctx.clock(),
  });

  return {
    deviceId: approved.device_id ?? '',
    credential: deviceSecret,
    pairingId: pairing.id,
    verificationCode: claim.verificationCode,
    installationId,
    label,
    telegramId,
    familyId: membership.familyId,
  };
}

export function authHeader(credential: string): Record<string, string> {
  return { authorization: `Device ${credential}` };
}
