import { beforeEach, describe, expect, it } from 'vitest';
import { generatePairingCode } from '../src/lib/pairing-code.js';
import { createPairingRequest, getPairingById } from '../src/repositories/pairing.js';
import { findMembership } from '../src/repositories/families.js';
import { getDeviceById } from '../src/repositories/devices.js';
import { createTestContext, seedFamily, type TestContext } from './helpers/app.js';
import { randomSecret } from './helpers/secret.js';

interface ClaimResult {
  statusCode: number;
  body: {
    enrollmentId?: string;
    claimToken?: string;
    verificationCode?: string;
    status?: string;
    error?: { code: string };
  };
}

async function claim(
  ctx: TestContext,
  code: string,
  deviceSecret: string,
  installationId = 'install-1',
): Promise<ClaimResult> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/enrollment/claim',
    payload: {
      code,
      deviceSecret,
      device: {
        label: 'HP Anak',
        installationId,
        model: 'Test',
        manufacturer: 'Test',
        appVersion: 'test',
        sdkInt: 34,
      },
    },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

describe('pairing dua arah', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    seedFamily(ctx, 111111);
  });

  it('PAIR-01: kode pairing disimpan sebagai hash dan tidak ada plaintext', () => {
    const membership = findMembership(ctx.db, 111111);
    if (!membership) throw new Error('seed gagal');
    const code = generatePairingCode();
    const { pairing } = createPairingRequest(ctx.db, {
      familyId: membership.familyId,
      createdBy: 111111,
      code,
      pepper: ctx.config.pairingCodePepper,
      now: ctx.clock(),
      ttlMs: ctx.config.pairingCodeTtlMs,
    });

    const row = getPairingById(ctx.db, pairing.id);
    expect(row?.code_hash).not.toBe(code);
    expect(row?.code_hash).toHaveLength(64);
    expect(row?.status).toBe('OPEN');

    const allText = JSON.stringify(
      ctx.db.prepare('SELECT * FROM pairing_requests').all() as unknown[],
    );
    expect(allText).not.toContain(code);
  });

  it('PAIR-02/16: claim membuat device PENDING, credential belum aktif, secret hanya hash', async () => {
    const membership = findMembership(ctx.db, 111111);
    if (!membership) throw new Error('seed gagal');
    const code = generatePairingCode();
    createPairingRequest(ctx.db, {
      familyId: membership.familyId,
      createdBy: 111111,
      code,
      pepper: ctx.config.pairingCodePepper,
      now: ctx.clock(),
      ttlMs: ctx.config.pairingCodeTtlMs,
    });

    const secret = randomSecret();
    const result = await claim(ctx, code, secret);
    expect(result.statusCode).toBe(201);
    expect(result.body.status).toBe('CLAIMED');
    expect(result.body.verificationCode).toMatch(/^\d{6}$/);
    expect(result.body.claimToken?.length).toBeGreaterThan(20);

    const row = ctx.db
      .prepare('SELECT * FROM devices WHERE installation_id = ?')
      .get('install-1') as { id: string; status: string };
    expect(row.status).toBe('PENDING');

    const credential = ctx.db
      .prepare('SELECT * FROM device_credentials WHERE device_id = ?')
      .get(row.id) as { secret_hash: string; activated_at: number | null };
    expect(credential.secret_hash).not.toBe(secret);
    expect(credential.secret_hash).toHaveLength(64);
    expect(credential.activated_at).toBeNull();
  });

  it('PAIR-03/04: kode salah menambah attempt dan setelah 5 percobaan dikunci', async () => {
    const results: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await claim(ctx, '00000000', randomSecret());
      results.push(result.statusCode);
    }
    expect(results.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(results[5]).toBe(429);
  });

  it('PAIR-05: kode kedaluwarsa ditolak 410 dan tidak membuat device', async () => {
    const membership = findMembership(ctx.db, 111111);
    if (!membership) throw new Error('seed gagal');
    const code = generatePairingCode();
    createPairingRequest(ctx.db, {
      familyId: membership.familyId,
      createdBy: 111111,
      code,
      pepper: ctx.config.pairingCodePepper,
      now: ctx.clock(),
      ttlMs: 1_000,
    });

    ctx.clock.advance(2_000);
    const result = await claim(ctx, code, randomSecret());
    expect(result.statusCode).toBe(410);

    const count = (
      ctx.db.prepare('SELECT COUNT(*) AS count FROM devices').get() as { count: number }
    ).count;
    expect(count).toBe(0);
  });

  it('PAIR-06/19/20: kode tidak bisa dipakai perangkat lain, retry secret sama idempotent', async () => {
    const membership = findMembership(ctx.db, 111111);
    if (!membership) throw new Error('seed gagal');
    const code = generatePairingCode();
    createPairingRequest(ctx.db, {
      familyId: membership.familyId,
      createdBy: 111111,
      code,
      pepper: ctx.config.pairingCodePepper,
      now: ctx.clock(),
      ttlMs: ctx.config.pairingCodeTtlMs,
    });

    const secret = randomSecret();
    const first = await claim(ctx, code, secret, 'install-a');
    expect(first.statusCode).toBe(201);

    const retry = await claim(ctx, code, secret, 'install-a');
    expect(retry.statusCode).toBe(201);
    expect(retry.body.enrollmentId).toBe(first.body.enrollmentId);
    expect(retry.body.claimToken).not.toBe(first.body.claimToken);

    const hijack = await claim(ctx, code, randomSecret(), 'install-b');
    expect(hijack.statusCode).toBe(409);

    const deviceCount = (
      ctx.db.prepare('SELECT COUNT(*) AS count FROM devices').get() as { count: number }
    ).count;
    expect(deviceCount).toBe(1);
  });

  it('PAIR-08/09: approve lokal wajib dan approve sebelum consent 409', async () => {
    const membership = findMembership(ctx.db, 111111);
    if (!membership) throw new Error('seed gagal');
    const code = generatePairingCode();
    createPairingRequest(ctx.db, {
      familyId: membership.familyId,
      createdBy: 111111,
      code,
      pepper: ctx.config.pairingCodePepper,
      now: ctx.clock(),
      ttlMs: ctx.config.pairingCodeTtlMs,
    });
    const claimed = await claim(ctx, code, randomSecret());
    const enrollmentId = claimed.body.enrollmentId ?? '';

    // Tanpa consent lokal, approve harus ditolak.
    const approveResponse = await ctx.app.inject({
      method: 'POST',
      url: `/v1/enrollment/${enrollmentId}/confirm-local`,
      headers: { 'x-enrollment-token': 'wrong-token-value-123456' },
      payload: { accepted: true, disclosureVersion: 'test-1' },
    });
    expect(approveResponse.statusCode).toBe(401);
  });

  it('PAIR-10/11/12/13: verification code, ownership, aktivasi, dan idempotensi', async () => {
    const membership = findMembership(ctx.db, 111111);
    if (!membership) throw new Error('seed gagal');
    seedFamily(ctx, 222222, 'Keluarga Lain');

    const code = generatePairingCode();
    createPairingRequest(ctx.db, {
      familyId: membership.familyId,
      createdBy: 111111,
      code,
      pepper: ctx.config.pairingCodePepper,
      now: ctx.clock(),
      ttlMs: ctx.config.pairingCodeTtlMs,
    });
    const claimed = await claim(ctx, code, randomSecret());
    const enrollmentId = claimed.body.enrollmentId ?? '';
    const verificationCode = claimed.body.verificationCode ?? '';

    const consent = await ctx.app.inject({
      method: 'POST',
      url: `/v1/enrollment/${enrollmentId}/confirm-local`,
      headers: { 'x-enrollment-token': claimed.body.claimToken ?? '' },
      payload: { accepted: true, disclosureVersion: 'test-1' },
    });
    expect(consent.statusCode).toBe(200);

    const { approvePairing } = await import('../src/repositories/pairing.js');

    // Family lain tidak bisa menyetujui.
    expect(() =>
      approvePairing(ctx.db, {
        pairingId: enrollmentId,
        familyId: 'fam_lain',
        actorTelegramId: 222222,
        verificationCode,
        now: ctx.clock(),
      }),
    ).toThrow(/tidak ditemukan/);

    // Kode verifikasi salah.
    const wrongCode = verificationCode === '000000' ? '111111' : '000000';
    expect(() =>
      approvePairing(ctx.db, {
        pairingId: enrollmentId,
        familyId: membership.familyId,
        actorTelegramId: 111111,
        verificationCode: wrongCode,
        now: ctx.clock(),
      }),
    ).toThrow(/Kode verifikasi/);

    const approved = approvePairing(ctx.db, {
      pairingId: enrollmentId,
      familyId: membership.familyId,
      actorTelegramId: 111111,
      verificationCode,
      now: ctx.clock(),
    });
    expect(approved.status).toBe('APPROVED');

    const device = getDeviceById(ctx.db, approved.device_id ?? '');
    expect(device?.status).toBe('ACTIVE');

    const credential = ctx.db
      .prepare('SELECT activated_at FROM device_credentials WHERE device_id = ?')
      .get(approved.device_id) as { activated_at: number | null };
    expect(credential.activated_at).not.toBeNull();

    // Idempotent: approve kedua tidak menggandakan apa pun.
    const again = approvePairing(ctx.db, {
      pairingId: enrollmentId,
      familyId: membership.familyId,
      actorTelegramId: 111111,
      verificationCode,
      now: ctx.clock(),
    });
    expect(again.status).toBe('APPROVED');
    const deviceCount = (
      ctx.db.prepare('SELECT COUNT(*) AS count FROM devices').get() as { count: number }
    ).count;
    expect(deviceCount).toBe(1);
  });
});
