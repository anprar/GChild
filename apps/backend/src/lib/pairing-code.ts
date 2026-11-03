import { randomInt } from 'node:crypto';

/** 8 digit, entropi rendah, karena itu selalu dipasangkan HMAC + TTL + attempt limit. */
export function generatePairingCode(): string {
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}

/** 6 digit, dibandingkan manusia di dua layar (Companion vs Parent). */
export function generateVerificationCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}
