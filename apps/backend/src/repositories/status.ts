import type { Db } from '../db/client.js';

export interface DeviceStatusRow {
  device_id: string;
  sequence: number;
  battery_level: number | null;
  charging: number | null;
  network_connected: number | null;
  backend_reachable: number | null;
  screen_interactive: number | null;
  keyguard_locked: number | null;
  observed_at: number;
  received_at: number;
  capabilities_json: string | null;
  app_version: string | null;
}

export interface StatusInput {
  deviceId: string;
  sequence: number;
  batteryLevel: number | null;
  charging: boolean | null;
  networkConnected: boolean | null;
  backendReachable: boolean | null;
  screenInteractive: boolean | null;
  keyguardLocked: boolean | null;
  observedAt: number;
  receivedAt: number;
  capabilities?: Record<string, boolean | null>;
  appVersion?: string | null;
}

const toInt = (value: boolean | null): number | null => (value === null ? null : value ? 1 : 0);

/**
 * Snapshot terakhir saja. Sequence lebih lama tidak boleh menimpa yang lebih baru,
 * dan nilai yang tidak dapat diamati tetap null (bukan 0/false).
 */
export function upsertStatus(db: Db, input: StatusInput): { accepted: boolean } {
  const existing = db
    .prepare('SELECT sequence FROM device_status WHERE device_id = ?')
    .get(input.deviceId) as { sequence: number } | undefined;

  if (existing && existing.sequence > input.sequence) {
    return { accepted: false };
  }

  const capabilities = input.capabilities ? JSON.stringify(input.capabilities) : null;

  db.prepare(
    `INSERT INTO device_status
       (device_id, sequence, battery_level, charging, network_connected, backend_reachable,
        screen_interactive, keyguard_locked, observed_at, received_at, capabilities_json, app_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       sequence = excluded.sequence,
       battery_level = excluded.battery_level,
       charging = excluded.charging,
       network_connected = excluded.network_connected,
       backend_reachable = excluded.backend_reachable,
       screen_interactive = excluded.screen_interactive,
       keyguard_locked = excluded.keyguard_locked,
       observed_at = excluded.observed_at,
       received_at = excluded.received_at,
       capabilities_json = excluded.capabilities_json,
       app_version = excluded.app_version`,
  ).run(
    input.deviceId,
    input.sequence,
    input.batteryLevel,
    toInt(input.charging),
    toInt(input.networkConnected),
    toInt(input.backendReachable),
    toInt(input.screenInteractive),
    toInt(input.keyguardLocked),
    input.observedAt,
    input.receivedAt,
    capabilities,
    input.appVersion ?? null,
  );

  return { accepted: true };
}

export function getStatus(db: Db, deviceId: string): DeviceStatusRow | null {
  const row = db
    .prepare('SELECT * FROM device_status WHERE device_id = ?')
    .get(deviceId) as DeviceStatusRow | undefined;
  return row ?? null;
}
