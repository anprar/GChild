import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const baseEnv = {
  PAIRING_CODE_PEPPER: 'x'.repeat(40),
};

describe('loadConfig — TELEGRAM_BOT_TOKEN', () => {
  it('token kosong dari .env berarti kanal bot nonaktif, bukan error', () => {
    const config = loadConfig({ ...baseEnv, TELEGRAM_BOT_TOKEN: '' });
    expect(config.telegramBotToken).toBeNull();
  });

  it('token berisi spasi saja juga dianggap kosong', () => {
    const config = loadConfig({ ...baseEnv, TELEGRAM_BOT_TOKEN: '   ' });
    expect(config.telegramBotToken).toBeNull();
  });

  it('token valid diteruskan apa adanya', () => {
    const config = loadConfig({ ...baseEnv, TELEGRAM_BOT_TOKEN: '123:abc' });
    expect(config.telegramBotToken).toBe('123:abc');
  });
});
