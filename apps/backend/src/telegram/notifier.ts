import type { Db } from '../db/client.js';
import {
  listUnnotifiedTerminalCommands,
  markCommandsNotified,
} from '../repositories/commands.js';
import { renderCommandNotification } from './messages.js';

export type NotifySender = (chatId: number, text: string) => Promise<void>;

export interface NotifierDeps {
  db: Db;
  send: NotifySender;
  now?: () => number;
  onError?: (error: unknown) => void;
}

/**
 * Mengirim hasil ACK final ke orang tua. Pesan tidak pernah menyatakan sukses
 * sebelum state final ada di database, dan command yang gagal dikirim tetap
 * belum ditandai agar dicoba lagi pada putaran berikutnya.
 */
export async function notifyFinishedCommands(deps: NotifierDeps): Promise<string[]> {
  const now = deps.now?.() ?? Date.now();
  const pending = listUnnotifiedTerminalCommands(deps.db, 20);
  const sent: string[] = [];

  for (const command of pending) {
    try {
      await deps.send(command.requested_by, renderCommandNotification(command));
      sent.push(command.id);
    } catch (error) {
      deps.onError?.(error);
    }
  }

  if (sent.length > 0) {
    markCommandsNotified(deps.db, sent, now);
  }
  return sent;
}

export interface NotifierHandle {
  stop(): void;
  runOnce(): Promise<string[]>;
}

export function startNotifier(deps: NotifierDeps & { intervalMs: number }): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void notifyFinishedCommands(deps).finally(() => {
      running = false;
    });
  }, deps.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
