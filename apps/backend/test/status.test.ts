import { beforeEach, describe, expect, it } from 'vitest';
import { renderDeviceStatus } from '../src/telegram/messages.js';
import { getStatus } from '../src/repositories/status.js';
import { getDeviceById } from '../src/repositories/devices.js';
import {
  authHeader,
  createTestContext,
  pairDevice,
  type PairedDevice,
  type TestContext,
} from './helpers/app.js';

describe('status snapshot', () => {
  let ctx: TestContext;
  let device: PairedDevice;

  beforeEach(async () => {
    ctx = await createTestContext();
    device = await pairDevice(ctx, { telegramId: 111111, label: 'HP Anak' });
  });

  const postStatus = (payload: Record<string, unknown>) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/device-self/status',
      headers: authHeader(device.credential),
      payload,
    });

  it('STAT-01/02: nilai tidak diketahui tetap null, receivedAt dari server', async () => {
    const response = await postStatus({
      sequence: 1,
      batteryLevel: null,
      charging: null,
      networkConnected: true,
      backendReachable: null,
      screenInteractive: null,
      keyguardLocked: null,
      observedAt: new Date(ctx.clock() - 5_000).toISOString(),
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as { accepted: boolean; receivedAt: string };
    expect(body.accepted).toBe(true);
    expect(body.receivedAt).toBe(new Date(ctx.clock()).toISOString());

    const status = getStatus(ctx.db, device.deviceId);
    expect(status?.battery_level).toBeNull();
    expect(status?.charging).toBeNull();
    expect(status?.network_connected).toBe(1);
    expect(status?.keyguard_locked).toBeNull();
    expect(status?.observed_at).toBe(ctx.clock() - 5_000);
    expect(status?.received_at).toBe(ctx.clock());
  });

  it('STAT-03: sequence lebih lama tidak menimpa snapshot baru', async () => {
    await postStatus({
      sequence: 5,
      batteryLevel: 80,
      observedAt: new Date(ctx.clock()).toISOString(),
    });
    ctx.clock.advance(1_000);
    const older = await postStatus({
      sequence: 4,
      batteryLevel: 10,
      observedAt: new Date(ctx.clock()).toISOString(),
    });

    expect((older.json() as { accepted: boolean }).accepted).toBe(false);
    expect(getStatus(ctx.db, device.deviceId)?.battery_level).toBe(80);
  });

  it('STAT-05: label stale muncul setelah threshold, bukan klaim realtime', async () => {
    await postStatus({
      sequence: 1,
      batteryLevel: 55,
      observedAt: new Date(ctx.clock()).toISOString(),
    });

    ctx.clock.advance(ctx.config.statusStaleMs + 60_000);
    const status = getStatus(ctx.db, device.deviceId);
    const deviceRow = getDeviceById(ctx.db, device.deviceId);
    if (!status || !deviceRow) throw new Error('status hilang');

    const rendered = renderDeviceStatus(deviceRow, status, ctx.clock(), ctx.config.statusStaleMs);
    expect(rendered).toContain('stale');
    expect(rendered).toContain('Baterai: 55%');
    expect(rendered).toContain('bukan pemantauan realtime');
  });

  it('STAT-04: validasi menolak battery di luar 0-100 dan observedAt rusak', async () => {
    const badBattery = await postStatus({
      sequence: 1,
      batteryLevel: 130,
      observedAt: new Date(ctx.clock()).toISOString(),
    });
    expect(badBattery.statusCode).toBe(400);

    const badObservedAt = await postStatus({ sequence: 2, observedAt: 'kemarin' });
    expect(badObservedAt.statusCode).toBe(400);
  });

  it('STAT-07: perangkat dicabut tidak bisa mengirim status', async () => {
    const { revokeDeviceTx } = await import('../src/repositories/devices.js');
    revokeDeviceTx(ctx.db, {
      familyId: device.familyId,
      deviceId: device.deviceId,
      now: ctx.clock(),
    });

    const response = await postStatus({
      sequence: 1,
      observedAt: new Date(ctx.clock()).toISOString(),
    });
    expect(response.statusCode).toBe(401);
  });
});
