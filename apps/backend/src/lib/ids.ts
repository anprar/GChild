import { randomBytes } from 'node:crypto';

/** ID opaque dengan prefiks agar mudah dibedakan di log dan audit. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export function shortId(id: string): string {
  return id.slice(-6);
}
