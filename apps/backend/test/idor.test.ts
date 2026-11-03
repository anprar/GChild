import { beforeEach, describe, expect, it } from 'vitest';
import { createCommand, getCommandById } from '../src/repositories/commands.js';
import { getStatus } from '../src/repositories/status.js';
import { findMembership } from '../src/repositories/families.js';
import {
  authHeader,
  createTestContext,
  pairDevice,
  type PairedDevice,
  type TestContext,
} from './helpers/app.js';

describe('isolasi antar keluarga (IDOR)', () => {
  let ctx: TestContext;
  let deviceA: PairedDevice;
  let deviceB: PairedDevice;

  beforeEach(async () => {
    ctx = await createTestContext();
    deviceA = await pairDevice(ctx, { telegramId: 111111, label: 'HP A', installationId: 'install-a1' });
    deviceB = await pairDevice(ctx, { telegramId: 222222, label: 'HP B', installationId: 'install-b1' });
  });

  it('T-01: perangkat B tidak bisa meng-ACK command perangkat A', async () => {
    const command = createCommand(ctx.db, {
      familyId: deviceA.familyId,
      deviceId: deviceA.deviceId,
      type: 'LOCK_SCREEN',
      expiresAt: ctx.clock() + 120_000,
      requestedBy: deviceA.telegramId,
      now: ctx.clock(),
    }).command;

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/device-self/commands/${command.id}/ack`,
      headers: authHeader(deviceB.credential),
      payload: { ackId: 'ack-cross-0001', status: 'RECEIVED' },
    });

    expect(response.statusCode).toBe(404);
    expect(getCommandById(ctx.db, command.id)?.state).toBe('QUEUED');
  });

  it('T-01: fetch hanya mengembalikan command perangkat sendiri', async () => {
    createCommand(ctx.db, {
      familyId: deviceA.familyId,
      deviceId: deviceA.deviceId,
      type: 'REQUEST_STATUS',
      expiresAt: ctx.clock() + 60_000,
      requestedBy: deviceA.telegramId,
      now: ctx.clock(),
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/device-self/commands',
      headers: authHeader(deviceB.credential),
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('T-01: status perangkat B tidak menulis snapshot perangkat A', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/device-self/status',
      headers: authHeader(deviceB.credential),
      payload: {
        sequence: 1,
        batteryLevel: 50,
        observedAt: new Date(ctx.clock()).toISOString(),
      },
    });
    expect(response.statusCode).toBe(200);

    expect(getStatus(ctx.db, deviceA.deviceId)).toBeNull();
    expect(getStatus(ctx.db, deviceB.deviceId)?.battery_level).toBe(50);
  });

  it('T-04: credential yang dicabut langsung ditolak 401', async () => {
    const membership = findMembership(ctx.db, 111111);
    expect(membership?.familyId).toBe(deviceA.familyId);

    const { revokeDeviceTx } = await import('../src/repositories/devices.js');
    revokeDeviceTx(ctx.db, {
      familyId: deviceA.familyId,
      deviceId: deviceA.deviceId,
      now: ctx.clock(),
    });

    const fetchResponse = await ctx.app.inject({
      method: 'GET',
      url: '/v1/device-self/commands',
      headers: authHeader(deviceA.credential),
    });
    expect(fetchResponse.statusCode).toBe(401);

    const statusResponse = await ctx.app.inject({
      method: 'POST',
      url: '/v1/device-self/status',
      headers: authHeader(deviceA.credential),
      payload: { sequence: 2, observedAt: new Date(ctx.clock()).toISOString() },
    });
    expect(statusResponse.statusCode).toBe(401);
  });

  it('T-04: credential perangkat lain tidak dapat dipalsukan', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/device-self/commands',
      headers: authHeader(`${deviceB.credential}tampered`),
    });
    expect(response.statusCode).toBe(401);
  });

  it('tidak ada endpoint Parent lewat HTTP; kanal Parent hanya Telegram', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: authHeader(deviceA.credential),
    });
    expect(response.statusCode).toBe(404);
  });

  it('perangkat tidak bisa memakai endpoint enrollment sebagai Parent', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/pairing-requests',
      headers: authHeader(deviceA.credential),
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });
});
