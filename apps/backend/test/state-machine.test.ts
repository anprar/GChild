import { describe, expect, it } from 'vitest';
import {
  transitionCommand,
  type CommandEvent,
  type CommandState,
} from '../src/domain/command-state.js';

const allowed: Array<[CommandState, CommandEvent, CommandState]> = [
  ['QUEUED', { type: 'ack', status: 'RECEIVED' }, 'RECEIVED'],
  ['QUEUED', { type: 'cancel' }, 'CANCELLED'],
  ['QUEUED', { type: 'expire' }, 'EXPIRED'],
  ['QUEUED', { type: 'ack', status: 'EXPIRED' }, 'EXPIRED'],
  ['RECEIVED', { type: 'ack', status: 'EXECUTING' }, 'EXECUTING'],
  ['RECEIVED', { type: 'expire' }, 'EXPIRED'],
  ['RECEIVED', { type: 'ack', status: 'EXPIRED' }, 'EXPIRED'],
  ['EXECUTING', { type: 'ack', status: 'SUCCEEDED' }, 'SUCCEEDED'],
  ['EXECUTING', { type: 'ack', status: 'FAILED' }, 'FAILED'],
  ['EXECUTING', { type: 'timeout' }, 'FAILED'],
];

const rejected: Array<[CommandState, CommandEvent]> = [
  ['QUEUED', { type: 'ack', status: 'EXECUTING' }],
  ['QUEUED', { type: 'ack', status: 'SUCCEEDED' }],
  ['QUEUED', { type: 'timeout' }],
  ['RECEIVED', { type: 'cancel' }],
  ['RECEIVED', { type: 'ack', status: 'SUCCEEDED' }],
  ['RECEIVED', { type: 'ack', status: 'FAILED' }],
  ['RECEIVED', { type: 'timeout' }],
  ['EXECUTING', { type: 'cancel' }],
  ['EXECUTING', { type: 'expire' }],
  ['EXECUTING', { type: 'ack', status: 'EXPIRED' }],
  ['SUCCEEDED', { type: 'ack', status: 'FAILED' }],
  ['FAILED', { type: 'cancel' }],
  ['CANCELLED', { type: 'ack', status: 'RECEIVED' }],
  ['EXPIRED', { type: 'ack', status: 'SUCCEEDED' }],
];

describe('state machine command', () => {
  it.each(allowed)('%s + %j -> %s', (current, event, expected) => {
    expect(transitionCommand(current, event).state).toBe(expected);
  });

  it.each(rejected)('menolak %s + %j', (current, event) => {
    expect(() => transitionCommand(current, event)).toThrow(/tidak diizinkan|sudah final/);
  });

  it('status yang sama bersifat idempotent, termasuk pada final state', () => {
    expect(transitionCommand('RECEIVED', { type: 'ack', status: 'RECEIVED' })).toEqual({
      state: 'RECEIVED',
      idempotent: true,
    });
    expect(transitionCommand('SUCCEEDED', { type: 'ack', status: 'SUCCEEDED' })).toEqual({
      state: 'SUCCEEDED',
      idempotent: true,
    });
    expect(transitionCommand('CANCELLED', { type: 'ack', status: 'CANCELLED' as never })).toEqual({
      state: 'CANCELLED',
      idempotent: true,
    });
  });

  it('tidak ada jalan langsung QUEUED -> SUCCEEDED', () => {
    expect(() => transitionCommand('QUEUED', { type: 'ack', status: 'SUCCEEDED' })).toThrow();
  });
});
