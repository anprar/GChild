import { randomUUID } from 'node:crypto';
import type { DeviceClient } from './client.js';

export type SimulatorScenario =
  | 'connect'
  | 'offline'
  | 'delay-ack'
  | 'duplicate-ack'
  | 'expired'
  | 'status';

export interface CycleSummary {
  requests: number;
  fetched: number;
  acked: number;
  executed: number;
  expired: number;
  duplicateAck: boolean;
}

export interface CycleOptions {
  scenario: SimulatorScenario;
  now?: () => number;
  sequence?: number;
}

export const SIMULATOR_LABEL = 'SIMULATOR';

function emptySummary(): CycleSummary {
  return {
    requests: 0,
    fetched: 0,
    acked: 0,
    executed: 0,
    expired: 0,
    duplicateAck: false,
  };
}

function buildStatus(now: number, sequence: number): Record<string, unknown> {
  return {
    sequence,
    // Nilai ini berasal dari simulator, bukan dari Android sungguhan.
    batteryLevel: 42,
    charging: true,
    networkConnected: true,
    backendReachable: true,
    screenInteractive: true,
    keyguardLocked: false,
    observedAt: new Date(now).toISOString(),
    capabilities: { deviceAdminActive: null, lockScreen: null },
    appVersion: 'simulator',
  };
}

/**
 * Satu siklus perangkat. Tidak pernah mengklaim eksekusi Android nyata:
 * setiap hasil diberi penanda SIMULATOR.
 */
export async function runDeviceCycle(
  client: DeviceClient,
  options: CycleOptions,
): Promise<CycleSummary> {
  const now = options.now ?? (() => Date.now());
  const summary = emptySummary();

  if (options.scenario === 'offline') {
    // Tidak ada request sama sekali; command harus tetap QUEUED di server.
    return summary;
  }

  if (options.scenario === 'status') {
    summary.requests += 1;
    await client.postStatus(buildStatus(now(), options.sequence ?? 1));
    return summary;
  }

  summary.requests += 1;
  const { items } = await client.fetchCommands();
  summary.fetched = items.length;

  for (const command of items) {
    const expired = Date.parse(command.expiresAt) <= now();
    if (expired || options.scenario === 'expired') {
      // Command kedaluwarsa tidak dieksekusi; laporkan EXPIRED jika server belum.
      summary.requests += 1;
      await client.ack(command.commandId, {
        ackId: randomUUID(),
        status: 'EXPIRED',
        observedAt: new Date(now()).toISOString(),
      });
      summary.expired += 1;
      continue;
    }

    const receivedAckId = randomUUID();
    summary.requests += 1;
    await client.ack(command.commandId, {
      ackId: receivedAckId,
      status: 'RECEIVED',
      observedAt: new Date(now()).toISOString(),
    });
    summary.acked += 1;

    if (options.scenario === 'delay-ack') {
      // Berhenti setelah RECEIVED: menunjukkan command belum dieksekusi.
      continue;
    }

    summary.requests += 1;
    await client.ack(command.commandId, {
      ackId: randomUUID(),
      status: 'EXECUTING',
      observedAt: new Date(now()).toISOString(),
    });

    let result: Record<string, unknown>;
    if (command.type === 'REQUEST_STATUS') {
      summary.requests += 1;
      await client.postStatus(buildStatus(now(), options.sequence ?? 1));
      result = { source: SIMULATOR_LABEL, note: 'status sintetis simulator' };
    } else {
      result = {
        source: SIMULATOR_LABEL,
        note: 'lockNow() TIDAK dipanggil: simulator bukan perangkat Android',
        verified: false,
      };
    }
    summary.executed += 1;

    const finalAckId = randomUUID();
    summary.requests += 1;
    await client.ack(command.commandId, {
      ackId: finalAckId,
      status: 'SUCCEEDED',
      result,
      observedAt: new Date(now()).toISOString(),
    });

    if (options.scenario === 'duplicate-ack') {
      summary.requests += 1;
      const duplicate = await client.ack(command.commandId, {
        ackId: finalAckId,
        status: 'SUCCEEDED',
        result,
        observedAt: new Date(now()).toISOString(),
      });
      summary.duplicateAck = duplicate.idempotent === true;
    }
  }

  return summary;
}
