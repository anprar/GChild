import { beforeEach, describe, expect, it } from 'vitest';
import { ackCommand, cancelCommand, createCommand, fetchQueuedForDevice, getCommandById, sweepCommands } from '../src/repositories/commands.js';
import { authHeader, createTestContext, pairDevice, type PairedDevice, type TestContext } from './helpers/app.js';

interface AckBody {
  ackId: string;
  status: 'RECEIVED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
  result?: Record<string, unknown>;
  error?: { code: string };
}

describe('command queue dan ACK', () => {
  let ctx: TestContext;
  let device: PairedDevice;

  beforeEach(async () => {
    ctx = await createTestContext();
    device = await pairDevice(ctx, { telegramId: 111111, label: 'HP Anak' });
  });

  const create = (expiresInMs = 60_000) =>
    createCommand(ctx.db, {
      familyId: device.familyId,
      deviceId: device.deviceId,
      type: 'REQUEST_STATUS',
      expiresAt: ctx.clock() + expiresInMs,
      requestedBy: device.telegramId,
      now: ctx.clock(),
    }).command;

  const ackHttp = (commandId: string, body: AckBody) =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/device-self/commands/${commandId}/ack`,
      headers: authHeader(device.credential),
      payload: body,
    });

  it('CMD-01/07: create QUEUED, fetch tidak mengubah state', async () => {
    const command = create();
    expect(command.state).toBe('QUEUED');

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/device-self/commands',
      headers: authHeader(device.credential),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: { commandId: string }[]; serverTime: string };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.commandId).toBe(command.id);
    expect(typeof body.serverTime).toBe('string');
    expect(getCommandById(ctx.db, command.id)?.state).toBe('QUEUED');
  });

  it('CMD-08/09: ACK RECEIVED wajib sebelum eksekusi', async () => {
    const command = create();

    const skipped = await ackHttp(command.id, { ackId: 'ack-skip-0001', status: 'SUCCEEDED' });
    expect(skipped.statusCode).toBe(409);

    const received = await ackHttp(command.id, { ackId: 'ack-recv-0001', status: 'RECEIVED' });
    expect(received.statusCode).toBe(200);
    expect((received.json() as { state: string }).state).toBe('RECEIVED');
    expect(getCommandById(ctx.db, command.id)?.received_at).not.toBeNull();
  });

  it('CMD-10/11: duplicate ackId dan status sama bersifat idempotent', async () => {
    const command = create();
    await ackHttp(command.id, { ackId: 'ack-1-000001', status: 'RECEIVED' });
    await ackHttp(command.id, { ackId: 'ack-2-000001', status: 'EXECUTING' });

    const first = await ackHttp(command.id, {
      ackId: 'ack-3-000001',
      status: 'SUCCEEDED',
      result: { locked: true },
    });
    expect(first.statusCode).toBe(200);

    const duplicate = await ackHttp(command.id, {
      ackId: 'ack-3-000001',
      status: 'SUCCEEDED',
      result: { locked: true },
    });
    expect(duplicate.statusCode).toBe(200);
    expect((duplicate.json() as { idempotent: boolean }).idempotent).toBe(true);

    const sameStatusNewAck = await ackHttp(command.id, {
      ackId: 'ack-4-000001',
      status: 'SUCCEEDED',
    });
    expect(sameStatusNewAck.statusCode).toBe(200);

    const ackRows = ctx.db
      .prepare('SELECT COUNT(*) AS count FROM command_results WHERE command_id = ?')
      .get(command.id) as { count: number };
    expect(ackRows.count).toBe(4);
  });

  it('CMD-12: ACK final berbeda tidak menimpa hasil', async () => {
    const command = create();
    await ackHttp(command.id, { ackId: 'ack-a-000001', status: 'RECEIVED' });
    await ackHttp(command.id, { ackId: 'ack-b-000001', status: 'EXECUTING' });
    await ackHttp(command.id, {
      ackId: 'ack-c-000001',
      status: 'SUCCEEDED',
    });

    const conflictResponse = await ackHttp(command.id, {
      ackId: 'ack-d-000001',
      status: 'FAILED',
      error: { code: 'LATE' },
    });
    expect(conflictResponse.statusCode).toBe(409);
    expect((conflictResponse.json() as { error: { code: string } }).error.code).toBe(
      'FINAL_STATE_ALREADY_SET',
    );
    expect(getCommandById(ctx.db, command.id)?.state).toBe('SUCCEEDED');
  });

  it('CMD-14/15: command kedaluwarsa tidak dikirim dan ACK RECEIVED menjadi EXPIRED', async () => {
    const command = create(1_000);
    ctx.clock.advance(2_000);

    const fetched = await ctx.app.inject({
      method: 'GET',
      url: '/v1/device-self/commands',
      headers: authHeader(device.credential),
    });
    expect((fetched.json() as { items: unknown[] }).items).toHaveLength(0);

    const lateAck = await ackHttp(command.id, { ackId: 'ack-late-0001', status: 'RECEIVED' });
    expect(lateAck.statusCode).toBe(200);
    expect((lateAck.json() as { state: string }).state).toBe('EXPIRED');
    expect(getCommandById(ctx.db, command.id)?.state).toBe('EXPIRED');
  });

  it('CMD-16/17/18: cancel hanya untuk QUEUED dan menutup race', async () => {
    const command = create();
    cancelCommand(ctx.db, {
      familyId: device.familyId,
      commandId: command.id,
      actorTelegramId: device.telegramId,
      now: ctx.clock(),
    });
    expect(getCommandById(ctx.db, command.id)?.state).toBe('CANCELLED');

    const ackAfterCancel = await ackHttp(command.id, {
      ackId: 'ack-cancel-001',
      status: 'RECEIVED',
    });
    expect(ackAfterCancel.statusCode).toBe(409);

    const second = create();
    await ackHttp(second.id, { ackId: 'ack-recv-0002', status: 'RECEIVED' });
    expect(() =>
      cancelCommand(ctx.db, {
        familyId: device.familyId,
        commandId: second.id,
        actorTelegramId: device.telegramId,
        now: ctx.clock(),
      }),
    ).toThrow(/tidak diizinkan/);
  });

  it('CMD-05: batas antrean 20 per perangkat', () => {
    for (let index = 0; index < 20; index += 1) {
      create();
    }
    expect(() => create()).toThrow(/penuh/);
  });

  it('CMD-06: idempotency key mengembalikan command yang sama', () => {
    const first = createCommand(ctx.db, {
      familyId: device.familyId,
      deviceId: device.deviceId,
      type: 'LOCK_SCREEN',
      expiresAt: ctx.clock() + 60_000,
      requestedBy: device.telegramId,
      idempotencyKey: 'tg-1-LOCK_SCREEN',
      now: ctx.clock(),
    });
    const second = createCommand(ctx.db, {
      familyId: device.familyId,
      deviceId: device.deviceId,
      type: 'LOCK_SCREEN',
      expiresAt: ctx.clock() + 60_000,
      requestedBy: device.telegramId,
      idempotencyKey: 'tg-1-LOCK_SCREEN',
      now: ctx.clock(),
    });

    expect(first.command.id).toBe(second.command.id);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it('CMD-19: lease EXECUTING yang habis menjadi FAILED tanpa requeue', async () => {
    const command = create(600_000);
    await ackHttp(command.id, { ackId: 'ack-r-0000001', status: 'RECEIVED' });
    await ackHttp(command.id, { ackId: 'ack-e-0000001', status: 'EXECUTING' });

    const executing = getCommandById(ctx.db, command.id);
    expect(executing?.state).toBe('EXECUTING');
    expect(executing?.lease_expires_at).not.toBeNull();

    ctx.clock.advance(ctx.config.commandLeaseMs + 1_000);
    const swept = sweepCommands(ctx.db, ctx.clock());
    expect(swept.failed).toBe(1);

    const failed = getCommandById(ctx.db, command.id);
    expect(failed?.state).toBe('FAILED');
    expect(failed?.error_json).toContain('TIMEOUT_DURING_EXECUTION');

    // Tidak ada requeue: fetch berikutnya tidak mengembalikan command ini.
    const queued = fetchQueuedForDevice(ctx.db, {
      deviceId: device.deviceId,
      now: ctx.clock(),
      limit: 10,
    });
    expect(queued).toHaveLength(0);
  });

  it('sweeper menandai QUEUED/RECEIVED yang lewat TTL menjadi EXPIRED', async () => {
    const command = create(1_000);
    await ackHttp(command.id, { ackId: 'ack-sweep-001', status: 'RECEIVED' });
    ctx.clock.advance(2_000);

    const swept = sweepCommands(ctx.db, ctx.clock());
    expect(swept.expired).toBe(1);
    expect(getCommandById(ctx.db, command.id)?.state).toBe('EXPIRED');
  });

  it('ackCommand menolak command milik perangkat lain', async () => {
    const command = create();
    expect(() =>
      ackCommand(ctx.db, {
        deviceId: 'dev_lain',
        commandId: command.id,
        ackId: 'ack-other-0001',
        status: 'RECEIVED',
        now: ctx.clock(),
        leaseMs: 30_000,
      }),
    ).toThrow(/tidak ditemukan/);
  });
});
