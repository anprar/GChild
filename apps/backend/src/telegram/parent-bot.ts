import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { shortId } from '../lib/ids.js';
import { generatePairingCode } from '../lib/pairing-code.js';
import { recordAudit } from '../repositories/audit.js';
import {
  cancelCommand,
  createCommand,
  listRecentCommands,
  type CommandType,
} from '../repositories/commands.js';
import { listDevicesForFamily, revokeDeviceTx, type DeviceRow } from '../repositories/devices.js';
import { findMembership, type Membership } from '../repositories/families.js';
import {
  approvePairing,
  createPairingRequest,
  listPendingPairings,
  rejectPairing,
  type PairingRow,
} from '../repositories/pairing.js';
import { getStatus } from '../repositories/status.js';
import {
  renderAccessDenied,
  renderCommandCreated,
  renderCommandList,
  renderDeviceList,
  renderDeviceStatus,
  renderHelp,
  renderPairingCode,
  renderPendingPairings,
} from './messages.js';

/** TTL per tipe dari docs/COMMAND_STATE_MACHINE.md §5. */
const COMMAND_TTL_MS: Record<CommandType, number> = {
  REQUEST_STATUS: 60_000,
  LOCK_SCREEN: 120_000,
};

const MAX_PENDING_PAIRINGS = 5;

type BotConfig = NonNullable<ConstructorParameters<typeof Bot>[1]>;

export interface ParentBotDeps {
  db: Db;
  config: Config;
  now?: () => number;
  /** Dipanggil saat akun Telegram tak terdaftar mencoba memakai bot (tanpa PII). */
  onDenied?: (telegramUserId: number) => void;
  /** Dipakai test untuk menyuntikkan botInfo tanpa memanggil getMe. */
  botConfig?: BotConfig;
}

export interface ParentContext extends Context {
  membership?: Membership;
}

function createIdempotencyKey(ctx: ParentContext, type: CommandType): string {
  return `tg-${ctx.update.update_id}-${type}`;
}

export function createParentBot(deps: ParentBotDeps): Bot<ParentContext> {
  const { db, config } = deps;
  const now = deps.now ?? (() => Date.now());
  const token = config.telegramBotToken;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN wajib untuk membuat bot Parent');
  }

  const bot = new Bot<ParentContext>(token, deps.botConfig);

  // ------------------------------------------------------------- authorization
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from || from.is_bot) {
      await ctx.reply(renderAccessDenied());
      return;
    }
    const membership = findMembership(db, from.id);
    const allowlisted =
      config.telegramParentIds.size === 0 || config.telegramParentIds.has(from.id);
    if (!membership || !allowlisted) {
      deps.onDenied?.(from.id);
      await ctx.reply(renderAccessDenied());
      return;
    }
    ctx.membership = membership;
    await next();
  });

  // ------------------------------------------------------------------- helpers
  const membershipOf = (ctx: ParentContext): Membership => {
    if (!ctx.membership) throw new AppError(403, 'FORBIDDEN', 'Akses ditolak.');
    return ctx.membership;
  };

  const resolveDevice = (ctx: ParentContext, arg: string | undefined): DeviceRow => {
    const membership = membershipOf(ctx);
    const devices = listDevicesForFamily(db, membership.familyId).filter(
      (device) => device.status !== 'REVOKED',
    );
    if (devices.length === 0) {
      throw badRequest('Belum ada perangkat. Jalankan /pasangkan untuk memulai pairing.');
    }

    const value = (arg ?? '').trim();
    if (value === '') {
      if (devices.length === 1) {
        const only = devices[0];
        if (only) return only;
      }
      const list = devices.map((device, index) => `${index + 1}) ${device.label}`).join('\n');
      throw badRequest(`Sebutkan nomor perangkat. Contoh: /status 1\n${list}`);
    }

    if (/^\d+$/.test(value)) {
      const device = devices[Number(value) - 1];
      if (!device) throw badRequest(`Nomor perangkat ${value} tidak ada.`);
      return device;
    }
    if (value.length < 4) {
      throw badRequest('Awalan ID perangkat minimal 4 karakter.');
    }
    const match =
      devices.find((device) => device.id === value) ??
      devices.find((device) => device.id.endsWith(value)) ??
      devices.find((device) => device.id.includes(value));
    if (!match) throw badRequest('Perangkat tidak ditemukan di keluarga ini.');
    return match;
  };

  const resolvePairing = (ctx: ParentContext, arg: string | undefined): PairingRow => {
    const membership = membershipOf(ctx);
    const value = (arg ?? '').trim();
    if (value.length < 4) {
      throw badRequest('Sebutkan ID permintaan pairing (minimal 4 karakter). Lihat /menunggu.');
    }
    const pending = listPendingPairings(db, membership.familyId);
    const match =
      pending.find((pairing) => pairing.id === value) ??
      pending.find((pairing) => pairing.id.endsWith(value)) ??
      pending.find((pairing) => pairing.id.includes(value));
    if (!match) {
      throw notFound('Permintaan pairing tidak ditemukan. Jalankan /menunggu.');
    }
    return match;
  };

  const guarded = async (ctx: ParentContext, work: () => Promise<void> | void): Promise<void> => {
    try {
      await work();
    } catch (error) {
      if (error instanceof AppError) {
        await ctx.reply(error.message);
        return;
      }
      throw error;
    }
  };

  const enqueueCommand = async (
    ctx: ParentContext,
    type: CommandType,
    arg: string | undefined,
  ): Promise<void> => {
    await guarded(ctx, async () => {
      const membership = membershipOf(ctx);
      const device = resolveDevice(ctx, arg);
      if (device.status !== 'ACTIVE') {
        throw badRequest(
          `Perangkat ${device.label} belum aktif (pairing belum selesai). Jalankan /menunggu.`,
        );
      }
      const at = now();
      const { command } = createCommand(db, {
        familyId: membership.familyId,
        deviceId: device.id,
        type,
        expiresAt: at + (COMMAND_TTL_MS[type] ?? config.commandTtlMs),
        requestedBy: membership.telegramUserId,
        idempotencyKey: createIdempotencyKey(ctx, type),
        now: at,
      });
      await ctx.reply(renderCommandCreated(command, device.label, at));
      if (type === 'LOCK_SCREEN') {
        await ctx.reply(
          'Catatan: kunci layar butuh Device Admin aktif di perangkat dan tidak membuka PIN/pola. ' +
            'Jika admin tidak aktif, perangkat akan melaporkan gagal dengan alasan.',
        );
      }
    });
  };

  // ------------------------------------------------------------------ commands
  bot.command('start', async (ctx) => {
    await guarded(ctx, async () => {
      const membership = membershipOf(ctx);
      await ctx.reply(
        `GChild — keluarga ${membership.familyName}\n\n` +
          'Saya kanal orang tua. Saya tidak menampilkan lokasi, chat, notifikasi, ' +
          'kamera, atau mikrofon — GChild tidak mengambil data itu.\n\n' +
          renderDeviceList(listDevicesForFamily(db, membership.familyId), now(), config.statusStaleMs),
      );
    });
  });

  bot.command(['perangkat', 'devices'], async (ctx) => {
    await guarded(ctx, async () => {
      const membership = membershipOf(ctx);
      await ctx.reply(
        renderDeviceList(listDevicesForFamily(db, membership.familyId), now(), config.statusStaleMs),
      );
    });
  });

  bot.command('bantuan', async (ctx) => {
    await ctx.reply(renderHelp());
  });

  bot.command('status', async (ctx) => {
    await enqueueCommand(ctx, 'REQUEST_STATUS', ctx.match);
  });

  bot.command(['cek'], async (ctx) => {
    await guarded(ctx, async () => {
      const device = resolveDevice(ctx, ctx.match);
      const status = getStatus(db, device.id);
      await ctx.reply(renderDeviceStatus(device, status, now(), config.statusStaleMs));
    });
  });

  bot.command('kunci', async (ctx) => {
    await enqueueCommand(ctx, 'LOCK_SCREEN', ctx.match);
  });

  bot.command(['terakhir', 'riwayat'], async (ctx) => {
    await guarded(ctx, async () => {
      const membership = membershipOf(ctx);
      const commands = listRecentCommands(db, membership.familyId, 5);
      const keyboard = new InlineKeyboard();
      commands
        .filter((command) => command.state === 'QUEUED')
        .forEach((command) =>
          keyboard.text(`Batalkan #${shortId(command.id)}`, `cancel:${command.id}`).row(),
        );
      await ctx.reply(renderCommandList(commands), {
        reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined,
      });
    });
  });

  bot.command('batal', async (ctx) => {
    await guarded(ctx, async () => {
      const membership = membershipOf(ctx);
      const value = (ctx.match ?? '').trim();
      if (value.length < 4) throw badRequest('Sebutkan ID command. Contoh: /batal abc123');
      const recent = listRecentCommands(db, membership.familyId, 20);
      const target =
        recent.find((command) => command.id === value) ??
        recent.find((command) => command.id.endsWith(value)) ??
        recent.find((command) => command.id.includes(value));
      if (!target) throw notFound('Command tidak ditemukan.');
      if (target.state !== 'QUEUED') {
        throw badRequest(
          `Command sudah berstatus "${target.state}" dan tidak bisa dibatalkan. ` +
            'Pembatalan hanya untuk command yang belum diterima perangkat.',
        );
      }
      cancelCommand(db, {
        familyId: membership.familyId,
        commandId: target.id,
        actorTelegramId: membership.telegramUserId,
        now: now(),
      });
      await ctx.reply(
        `Command #${shortId(target.id)} dibatalkan. Jika perangkat sudah menerimanya, ` +
          'laporan perangkat akan tetap masuk dan ditampilkan apa adanya.',
      );
    });
  });

  // ------------------------------------------------------------------- pairing
  bot.command(['pasangkan', 'pair'], async (ctx) => {
    await guarded(ctx, async () => {
      const membership = membershipOf(ctx);
      const pending = listPendingPairings(db, membership.familyId);
      if (pending.length >= MAX_PENDING_PAIRINGS) {
        throw badRequest(
          `Sudah ada ${pending.length} permintaan pairing aktif. Selesaikan atau tolak lewat /menunggu.`,
        );
      }
      const at = now();
      const { pairing, code } = createPairingRequest(db, {
        familyId: membership.familyId,
        createdBy: membership.telegramUserId,
        code: generatePairingCode(),
        pepper: config.pairingCodePepper,
        now: at,
        ttlMs: config.pairingCodeTtlMs,
      });
      await ctx.reply(
        `${renderPairingCode(code, pairing.code_expires_at)}\n\nID permintaan: #${shortId(pairing.id)}`,
      );
    });
  });

  bot.command(['menunggu', 'pending'], async (ctx) => {
    await guarded(ctx, async () => {
      const membership = membershipOf(ctx);
      await ctx.reply(renderPendingPairings(listPendingPairings(db, membership.familyId)));
    });
  });

  bot.command('setujui', async (ctx) => {
    await guarded(ctx, async () => {
      const membership = membershipOf(ctx);
      const parts = (ctx.match ?? '').trim().split(/\s+/).filter(Boolean);
      const [pairingArg, code] = parts;
      if (!pairingArg || !code || !/^\d{6}$/.test(code)) {
        throw badRequest('Format: /setujui <id> <kode verifikasi 6 digit>');
      }
      const pairing = resolvePairing(ctx, pairingArg);
      const approved = approvePairing(db, {
        pairingId: pairing.id,
        familyId: membership.familyId,
        actorTelegramId: membership.telegramUserId,
        verificationCode: code,
        now: now(),
      });
      await ctx.reply(
        `Perangkat ${approved.device_label ?? ''} diaktifkan.\n\n` +
          'Minta GChild Companion di perangkat mengirim status pertama, lalu jalankan /status.',
      );
    });
  });

  bot.command('tolak', async (ctx) => {
    await guarded(ctx, async () => {
      const membership = membershipOf(ctx);
      const pairing = resolvePairing(ctx, ctx.match);
      rejectPairing(db, {
        pairingId: pairing.id,
        familyId: membership.familyId,
        reason: 'PARENT_REJECTED',
        now: now(),
      });
      await ctx.reply('Permintaan pairing ditolak dan perangkat pending dicabut.');
    });
  });

  // ------------------------------------------------------------ device removal
  bot.command('hapus', async (ctx) => {
    await guarded(ctx, async () => {
      const device = resolveDevice(ctx, ctx.match);
      const keyboard = new InlineKeyboard()
        .text('Ya, cabut akses', `revoke:${device.id}`)
        .text('Batal', 'revoke:cancel');
      await ctx.reply(
        `Cabut akses perangkat ${device.label}?\n` +
          'Credential perangkat langsung mati dan command yang masih menunggu dibatalkan.',
        { reply_markup: keyboard },
      );
    });
  });

  // ----------------------------------------------------------------- callbacks
  bot.on('callback_query:data', async (ctx) => {
    const membership = ctx.membership;
    const data = ctx.callbackQuery.data;
    if (!membership) {
      await ctx.answerCallbackQuery({ text: 'Akses ditolak.' });
      return;
    }

    try {
      if (data === 'revoke:cancel') {
        await ctx.answerCallbackQuery({ text: 'Dibatalkan.' });
        await ctx.deleteMessage().catch(() => undefined);
        return;
      }

      if (data.startsWith('cancel:')) {
        const commandId = data.slice('cancel:'.length);
        cancelCommand(db, {
          familyId: membership.familyId,
          commandId,
          actorTelegramId: membership.telegramUserId,
          now: now(),
        });
        await ctx.answerCallbackQuery({ text: 'Command dibatalkan.' });
        await ctx.reply(`Command #${shortId(commandId)} dibatalkan.`);
        return;
      }

      if (data.startsWith('revoke:')) {
        const deviceId = data.slice('revoke:'.length);
        const devices = listDevicesForFamily(db, membership.familyId);
        const device = devices.find((item) => item.id === deviceId);
        if (!device) {
          await ctx.answerCallbackQuery({ text: 'Perangkat tidak ditemukan.' });
          return;
        }
        revokeDeviceTx(db, {
          familyId: membership.familyId,
          deviceId,
          now: now(),
        });
        recordAudit(db, {
          familyId: membership.familyId,
          actorType: 'PARENT',
          actorId: String(membership.telegramUserId),
          deviceId,
          action: 'device.revoke',
          outcome: 'SUCCESS',
          now: now(),
        });
        await ctx.answerCallbackQuery({ text: 'Akses dicabut.' });
        await ctx.reply(
          `Akses ${device.label} dicabut. Credential perangkat sudah tidak berlaku; ` +
            'Companion akan menampilkan status pairing dicabut pada sinkronisasi berikutnya.',
        );
        return;
      }

      await ctx.answerCallbackQuery({ text: 'Aksi tidak dikenal.' });
    } catch (error) {
      if (error instanceof AppError) {
        await ctx.answerCallbackQuery({ text: error.message.slice(0, 190), show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: 'Terjadi kesalahan.' });
      throw error;
    }
  });

  bot.on('message:text', async (ctx) => {
    if ((ctx.message.text ?? '').startsWith('/')) return;
    await ctx.reply(
      'Saya hanya memahami perintah. Ketik /bantuan untuk daftar perintah.\n' +
        'ID perangkat dan command bisa dilihat lewat /perangkat dan /terakhir.',
    );
  });

  bot.catch(async (botError) => {
    const { ctx, error } = botError;
    if (error instanceof AppError) {
      await ctx.reply(error.message).catch(() => undefined);
      return;
    }
    await ctx
      .reply('Terjadi kesalahan internal. Perintah tidak dianggap berhasil.')
      .catch(() => undefined);
  });

  return bot;
}
