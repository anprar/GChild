import { describe, expect, it } from 'vitest';
import {
  ackCommand,
  createCommand,
  getCommandById,
  listRecentCommands,
} from '../src/repositories/commands.js';
import { notifyFinishedCommands } from '../src/telegram/notifier.js';
import { findMembership } from '../src/repositories/families.js';
import { createTestContext, pairDevice, tempDatabasePath, createClock, type TestContext } from './helpers/app.js';

describe('E2E: Parent (Telegram) -> antrean -> perangkat -> ACK -> hasil', () => {
  it('satu alur lengkap dengan state jujur di setiap langkah', async () => {
    const ctx: TestContext = await createTestContext();
    try {
      const device = await pairDevice(ctx, {
        telegramId: 111111,
        label: 'HP Anak',
        installationId: 'install-e2e',
      });
      const membership = findMembership(ctx.db, 111111);
      if (!membership) throw new Error('seed gagal');

      // 1. Orang tua meminta status lewat kanal Parent.
      const created = createCommand(ctx.db, {
        familyId: membership.familyId,
        deviceId: device.deviceId,
        type: 'REQUEST_STATUS',
        expiresAt: ctx.clock() + 60_000,
        requestedBy: membership.telegramUserId,
        idempotencyKey: 'tg-1-REQUEST_STATUS',
        now: ctx.clock(),
      });
      expect(created.command.state).toBe('QUEUED');

      // 2. Perangkat mengambil command.
      const fetched = await ctx.app.inject({
        method: 'GET',
        url: '/v1/device-self/commands',
        headers: { authorization: `Device ${device.credential}` },
      });
      const items = (fetched.json() as { items: { commandId: string }[] }).items;
      expect(items.map((item) => item.commandId)).toEqual([created.command.id]);

      // 3. ACK RECEIVED lalu EXECUTING.
      for (const [ackId, status] of [
        ['e2e-received-1', 'RECEIVED'],
        ['e2e-executing-1', 'EXECUTING'],
      ] as const) {
        const response = await ctx.app.inject({
          method: 'POST',
          url: `/v1/device-self/commands/${created.command.id}/ack`,
          headers: { authorization: `Device ${device.credential}` },
          payload: { ackId, status, observedAt: new Date(ctx.clock()).toISOString() },
        });
        expect(response.statusCode).toBe(200);
      }
      expect(getCommandById(ctx.db, created.command.id)?.state).toBe('EXECUTING');

      // 4. Perangkat mengirim status dan ACK final.
      const statusResponse = await ctx.app.inject({
        method: 'POST',
        url: '/v1/device-self/status',
        headers: { authorization: `Device ${device.credential}` },
        payload: {
          sequence: 1,
          batteryLevel: 77,
          charging: false,
          networkConnected: true,
          backendReachable: true,
          screenInteractive: true,
          keyguardLocked: false,
          observedAt: new Date(ctx.clock()).toISOString(),
        },
      });
      expect(statusResponse.statusCode).toBe(200);

      const finalAck = await ctx.app.inject({
        method: 'POST',
        url: `/v1/device-self/commands/${created.command.id}/ack`,
        headers: { authorization: `Device ${device.credential}` },
        payload: {
          ackId: 'e2e-succeeded-1',
          status: 'SUCCEEDED',
          result: { observedBattery: 77 },
          observedAt: new Date(ctx.clock()).toISOString(),
        },
      });
      expect(finalAck.statusCode).toBe(200);
      expect((finalAck.json() as { state: string }).state).toBe('SUCCEEDED');

      // 5. Hanya setelah ACK final, notifikasi Parent menyebut berhasil.
      const delivered: string[] = [];
      const notified = await notifyFinishedCommands({
        db: ctx.db,
        now: ctx.clock,
        send: async (_chatId, text) => {
          delivered.push(text);
        },
      });
      expect(notified).toEqual([created.command.id]);
      expect(delivered[0]).toContain('Berhasil');

      const recent = listRecentCommands(ctx.db, membership.familyId, 5);
      expect(recent[0]?.state).toBe('SUCCEEDED');

      // 6. Command final tidak bisa diubah oleh ACK terlambat.
      expect(() =>
        ackCommand(ctx.db, {
          deviceId: device.deviceId,
          commandId: created.command.id,
          ackId: 'e2e-late-1',
          status: 'FAILED',
          now: ctx.clock(),
          leaseMs: 30_000,
        }),
      ).toThrow(/sudah final/);
      expect(getCommandById(ctx.db, created.command.id)?.state).toBe('SUCCEEDED');
    } finally {
      await ctx.cleanup();
    }
  });

  it('state bertahan setelah backend restart dan sweeper tidak menggandakan', async () => {
    const temp = tempDatabasePath();
    const clock = createClock();
    const first = await createTestContext({ databasePath: temp.path, clock });
    let commandId = '';
    let deviceCredential = '';
    try {
      const device = await pairDevice(first, {
        telegramId: 111111,
        label: 'HP Anak',
        installationId: 'install-restart',
      });
      deviceCredential = device.credential;
      const membership = findMembership(first.db, 111111);
      if (!membership) throw new Error('seed gagal');
      const created = createCommand(first.db, {
        familyId: membership.familyId,
        deviceId: device.deviceId,
        type: 'LOCK_SCREEN',
        expiresAt: clock() + 120_000,
        requestedBy: 111111,
        now: clock(),
      });
      commandId = created.command.id;
    } finally {
      await first.cleanup();
    }

    const second = await createTestContext({ databasePath: temp.path, clock });
    try {
      const command = getCommandById(second.db, commandId);
      expect(command?.state).toBe('QUEUED');

      const fetched = await second.app.inject({
        method: 'GET',
        url: '/v1/device-self/commands',
        headers: { authorization: `Device ${deviceCredential}` },
      });
      expect(fetched.statusCode).toBe(200);
      expect((fetched.json() as { items: { commandId: string }[] }).items[0]?.commandId).toBe(
        commandId,
      );

      const ack = await second.app.inject({
        method: 'POST',
        url: `/v1/device-self/commands/${commandId}/ack`,
        headers: { authorization: `Device ${deviceCredential}` },
        payload: { ackId: 'restart-received-1', status: 'RECEIVED' },
      });
      expect(ack.statusCode).toBe(200);
      expect(getCommandById(second.db, commandId)?.state).toBe('RECEIVED');
    } finally {
      await second.cleanup();
      temp.cleanup();
    }
  });
});
