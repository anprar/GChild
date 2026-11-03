import { randomBytes } from 'node:crypto';

export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}
