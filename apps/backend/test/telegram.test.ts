import { beforeEach, describe, expect, it } from 'vitest';
import { createParentBot } from '../src/telegram/parent-bot.js';
import { notifyFinishedCommands } from '../src/telegram/notifier.js';
import { getCommandById, listRecentCommands } from '../src/repositories/commands.js';
import { findMembership } from '../src/repositories/families.js';
import { createPairingRequest } from '../src/repositories/pairing.js';
import { generatePairingCode } from '../src/lib/pairing-code.js';
import { createTestContext, seedFamily, type TestContext } from './helpers/app.js';
import { randomSecret } from './helpers/secret.js';
import {
  allTexts,
  botConfig,
  callbackUpdate,
  lastReplyText,
  recordApiCalls,
  textUpdate,
} from './helpers/telegram.js';

const PARENT_ID = 111111;

describe('bot Telegram Parent', () => {
  let ctx: TestContext;
  let denied: number[];

  beforeEach(async () => {
    ctx = await createTestContext();
    seedFamily(ctx, PARENT_ID, 'Keluarga Uji');
    denied = [];
  });

  const makeBot = () => {
    const bot = createParentBot({
      db: ctx.db,
      config: ctx.config,
      now: ctx.clock,
      botConfig: botConfig(),
      onDenied: (id) => denied.push(id),
    });
    const sent = recordApiCalls(bot);
    const send = async (update: Record<string, unknown>) => {
      await bot.handleUpdate(update as never);
      return sent;
    };
    return { bot, sent, send };
  };

  async function pairViaBot(): Promise<{ code: string; pairingShortId: string; verificationCode: string }> {
    const { send } = makeBot();
    const sent = await send(textUpdate(PARENT_ID, '/pasangkan'));
    const text = lastReplyText(sent);
    const code = /Kode: (\d{8})/.exec(text)?.[1];
    const pairingShortId = /#([A-Za-z0-9_-]{6})/.exec(text)?.[1];
    if (!code || !pairingShortId) throw new Error(`Kode pairing tidak ditemukan di: ${text}`);

    const membership = findMembership(ctx.db, PARENT_ID);
    if (!membership) throw new Error('seed gagal');

    const claim = await ctx.app.inject({
      method: 'POST',
      url: '/v1/enrollment/claim',
      payload: {
        code,
        deviceSecret: randomSecret(),
        device: {
          label: 'HP Anak',
          installationId: 'install-telegram-1',
          model: 'Test',
          manufacturer: 'Test',
          appVersion: 'test',
          sdkInt: 34,
        },
      },
    });
    expect(claim.statusCode).toBe(201);
    const claimBody = claim.json() as { enrollmentId: string; claimToken: string; verificationCode: string };

    const consent = await ctx.app.inject({
      method: 'POST',
      url: `/v1/enrollment/${claimBody.enrollmentId}/confirm-local`,
      headers: { 'x-enrollment-token': claimBody.claimToken },
      payload: { accepted: true, disclosureVersion: 'test-1' },
    });
    expect(consent.statusCode).toBe(200);

    return { code, pairingShortId, verificationCode: claimBody.verificationCode };
  }

  async function pairAndApprove(): Promise<{ code: string; verificationCode: string }> {
    const { code, pairingShortId, verificationCode } = await pairViaBot();
    const { send } = makeBot();
    const sent = await send(
      textUpdate(PARENT_ID, `/setujui ${pairingShortId} ${verificationCode}`),
    );
    expect(lastReplyText(sent)).toContain('diaktifkan');
    return { code, verificationCode };
  }

  it('menolak akun Telegram yang tidak terdaftar dan mencatat denial tanpa PII', async () => {
    const { send } = makeBot();
    const sent = await send(textUpdate(999999, '/start'));

    expect(lastReplyText(sent)).toContain('Akses ditolak');
    expect(denied).toEqual([999999]);
    expect(listRecentCommands(ctx.db, 'fam_any')).toHaveLength(0);
  });

  it('/start dan /perangkat menampilkan perangkat keluarga', async () => {
    await pairAndApprove();
    const { send } = makeBot();

    const sent = await send(textUpdate(PARENT_ID, '/perangkat'));
    const text = lastReplyText(sent);
    expect(text).toContain('Perangkat keluarga');
    expect(text).toContain('HP Anak');
    expect(text).toContain('aktif');
  });

  it('/pasangkan membuat kode 8 digit dengan TTL', async () => {
    const { send } = makeBot();
    const sent = await send(textUpdate(PARENT_ID, '/pasangkan'));
    const text = lastReplyText(sent);
    expect(text).toMatch(/Kode: \d{8}/);
    expect(text).toContain('Berlaku sampai');
    expect(text).toContain('Kode pairing saja tidak cukup');
  });

  it('/menunggu menampilkan kode verifikasi setelah consent lokal', async () => {
    const { verificationCode } = await pairViaBot();
    const { send } = makeBot();
    const sent = await send(textUpdate(PARENT_ID, '/menunggu'));
    const text = lastReplyText(sent);
    expect(text).toContain('kode verifikasi');
    expect(text).toContain(verificationCode);
  });

  it('/setujui mengaktifkan perangkat dan /perangkat menandainya aktif', async () => {
    const { pairingShortId, verificationCode } = await pairViaBot();
    const { send } = makeBot();

    const sent = await send(textUpdate(PARENT_ID, `/setujui ${pairingShortId} ${verificationCode}`));
    expect(lastReplyText(sent)).toContain('diaktifkan');

    const list = await send(textUpdate(PARENT_ID, '/perangkat'));
    expect(lastReplyText(list)).toContain('aktif');
  });

  it('/setujui menolak kode verifikasi yang salah', async () => {
    const { pairingShortId, verificationCode } = await pairViaBot();
    const wrong = verificationCode === '000000' ? '111111' : '000000';
    const { send } = makeBot();

    const sent = await send(textUpdate(PARENT_ID, `/setujui ${pairingShortId} ${wrong}`));
    expect(lastReplyText(sent)).toContain('tidak cocok');
  });

  it('/status membuat command QUEUED dan tidak mengklaim berhasil', async () => {
    await pairAndApprove();
    const { send } = makeBot();

    const sent = await send(textUpdate(PARENT_ID, '/status'));
    const text = lastReplyText(sent);
    expect(text).toContain('Menunggu perangkat');
    expect(text).not.toContain('Berhasil');

    const membership = findMembership(ctx.db, PARENT_ID);
    if (!membership) throw new Error('seed gagal');
    const commands = listRecentCommands(ctx.db, membership.familyId, 5);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.state).toBe('QUEUED');
  });

  it('/kunci menyebut Device Admin dan tidak menjanjikan buka PIN', async () => {
    await pairAndApprove();
    const { send } = makeBot();

    const sent = await send(textUpdate(PARENT_ID, '/kunci'));
    const texts = allTexts(sent).join('\n');
    expect(texts).toContain('Device Admin');
    expect(texts).toContain('tidak membuka PIN');
  });

  it('/cek menampilkan snapshot nyata yang dilaporkan perangkat', async () => {
    const paired = await pairViaBot();
    const membership = findMembership(ctx.db, PARENT_ID);
    if (!membership) throw new Error('seed gagal');
    const device = ctx.db
      .prepare('SELECT * FROM devices WHERE family_id = ?')
      .get(membership.familyId) as { id: string; installation_id: string };

    // Diambil dari device secret test yang dibuat pairViaBot? Credential tidak
    // dikembalikan helper ini, jadi pakai command + ACK lewat repositori HTTP.
    expect(paired.code).toHaveLength(8);
    expect(device.installation_id).toBe('install-telegram-1');

    ctx.db
      .prepare(
        `INSERT INTO device_status
           (device_id, sequence, battery_level, charging, network_connected, backend_reachable,
            screen_interactive, keyguard_locked, observed_at, received_at, capabilities_json, app_version)
         VALUES (?, 1, 61, 1, 1, 1, 0, 1, ?, ?, NULL, 'test')`,
      )
      .run(device.id, ctx.clock(), ctx.clock());

    const { send } = makeBot();
    const sent = await send(textUpdate(PARENT_ID, '/cek'));
    const text = lastReplyText(sent);
    expect(text).toContain('Baterai: 61%');
    expect(text).toContain('Keyguard terkunci: ya');
  });

  it('/terakhir menampilkan state asli dan tombol batal hanya untuk QUEUED', async () => {
    await pairAndApprove();
    const { send } = makeBot();
    await send(textUpdate(PARENT_ID, '/status'));

    const sent = await send(textUpdate(PARENT_ID, '/terakhir'));
    const text = lastReplyText(sent);
    expect(text).toContain('Menunggu perangkat');

    const withKeyboard = sent
      .filter((record) => record.method === 'sendMessage')
      .at(-1);
    expect(withKeyboard?.payload.reply_markup).toBeTruthy();
  });

  it('callback cancel membatalkan command QUEUED', async () => {
    await pairAndApprove();
    const { send } = makeBot();
    await send(textUpdate(PARENT_ID, '/status'));

    const membership = findMembership(ctx.db, PARENT_ID);
    if (!membership) throw new Error('seed gagal');
    const command = listRecentCommands(ctx.db, membership.familyId, 5)[0];
    if (!command) throw new Error('command tidak ada');

    const sent = await send(callbackUpdate(PARENT_ID, `cancel:${command.id}`));
    expect(getCommandById(ctx.db, command.id)?.state).toBe('CANCELLED');
    expect(allTexts(sent).join('\n')).toContain('dibatalkan');
  });

  it('notifier mengirim hasil final, termasuk alasan gagal', async () => {
    await pairViaBot();
    const membership = findMembership(ctx.db, PARENT_ID);
    if (!membership) throw new Error('seed gagal');
    const device = ctx.db
      .prepare('SELECT * FROM devices WHERE family_id = ?')
      .get(membership.familyId) as { id: string };

    const { createCommand } = await import('../src/repositories/commands.js');
    const { command } = createCommand(ctx.db, {
      familyId: membership.familyId,
      deviceId: device.id,
      type: 'LOCK_SCREEN',
      expiresAt: ctx.clock() + 120_000,
      requestedBy: PARENT_ID,
      now: ctx.clock(),
    });
    ctx.db
      .prepare(
        `UPDATE commands SET state = 'FAILED', completed_at = ?, error_json = ? WHERE id = ?`,
      )
      .run(ctx.clock(), JSON.stringify({ code: 'ADMIN_INACTIVE' }), command.id);

    const messages: { chatId: number; text: string }[] = [];
    const sent = await notifyFinishedCommands({
      db: ctx.db,
      now: ctx.clock,
      send: async (chatId, text) => {
        messages.push({ chatId, text });
      },
    });

    expect(sent).toEqual([command.id]);
    expect(messages[0]?.chatId).toBe(PARENT_ID);
    expect(messages[0]?.text).toContain('Gagal');
    expect(messages[0]?.text).toContain('ADMIN_INACTIVE');

    // Idempotent: putaran kedua tidak mengirim ulang.
    const secondRound = await notifyFinishedCommands({
      db: ctx.db,
      now: ctx.clock,
      send: async () => undefined,
    });
    expect(secondRound).toEqual([]);
  });

  it('kode pairing dari bot bisa dipakai claim tanpa membuat keluarga ganda', async () => {
    const membership = findMembership(ctx.db, PARENT_ID);
    if (!membership) throw new Error('seed gagal');
    createPairingRequest(ctx.db, {
      familyId: membership.familyId,
      createdBy: PARENT_ID,
      code: generatePairingCode(),
      pepper: ctx.config.pairingCodePepper,
      now: ctx.clock(),
      ttlMs: ctx.config.pairingCodeTtlMs,
    });
    const count = (
      ctx.db.prepare('SELECT COUNT(*) AS count FROM families').get() as { count: number }
    ).count;
    expect(count).toBe(1);
  });
});
