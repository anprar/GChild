import type { Db } from '../db/client.js';
import { sweepCommands } from '../repositories/commands.js';
import { expirePairings } from '../repositories/pairing.js';

export interface SweeperHandle {
  stop(): void;
  runOnce(): { expired: number; failed: number; pairingsExpired: number };
}

/**
 * Sweeper in-process. Menandai command/pairing kedaluwarsa; tidak pernah
 * menjalankan ulang command dan tidak menyentuh data yang masih berlaku.
 */
export function startSweeper(
  db: Db,
  options: { intervalMs?: number; now?: () => number; onRun?: (result: ReturnType<SweeperHandle['runOnce']>) => void } = {},
): SweeperHandle {
  const now = options.now ?? (() => Date.now());
  const intervalMs = options.intervalMs ?? 30_000;

  const runOnce = () => {
    const at = now();
    const commands = sweepCommands(db, at);
    const pairingsExpired = expirePairings(db, at);
    const result = { ...commands, pairingsExpired };
    options.onRun?.(result);
    return result;
  };

  const timer = setInterval(() => {
    try {
      runOnce();
    } catch {
      // Kesalahan sweeper tidak boleh mematikan server; status akan dicoba lagi
      // pada interval berikutnya dan health/ready tetap terbaca.
    }
  }, intervalMs);
  timer.unref();

  return {
    stop: () => clearInterval(timer),
    runOnce,
  };
}
