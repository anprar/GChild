import type { Bot } from 'grammy';

export interface SentMessage {
  method: string;
  payload: Record<string, unknown>;
}

/** Menangkap panggilan Bot API tanpa jaringan. */
export function recordApiCalls(bot: Bot): SentMessage[] {
  const sent: SentMessage[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    const record = { method, payload: payload as Record<string, unknown> };
    sent.push(record);
    return {
      ok: true,
      result:
        method === 'sendMessage'
          ? {
              message_id: sent.length,
              date: Math.floor(Date.now() / 1000),
              chat: { id: Number(record.payload.chat_id ?? 0), type: 'private' },
              text: String(record.payload.text ?? ''),
            }
          : true,
    } as never;
  });
  return sent;
}

export function botConfig(): NonNullable<ConstructorParameters<typeof Bot>[1]> {
  return {
    botInfo: {
      id: 987654321,
      is_bot: true,
      first_name: 'GChild Test',
      username: 'gchild_test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    },
  } as NonNullable<ConstructorParameters<typeof Bot>[1]>;
}

let updateCounter = 1000;

export function resetUpdateCounter(): void {
  updateCounter = 1000;
}

export function textUpdate(telegramId: number, text: string): Record<string, unknown> {
  updateCounter += 1;
  return {
    update_id: updateCounter,
    message: {
      message_id: updateCounter,
      date: Math.floor(Date.now() / 1000),
      chat: { id: telegramId, type: 'private' },
      from: { id: telegramId, is_bot: false, first_name: 'Parent' },
      text,
      entities: text.startsWith('/')
        ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]?.length ?? 0 }]
        : undefined,
    },
  };
}

export function callbackUpdate(
  telegramId: number,
  data: string,
  messageId = 1,
): Record<string, unknown> {
  updateCounter += 1;
  return {
    update_id: updateCounter,
    callback_query: {
      id: String(updateCounter),
      from: { id: telegramId, is_bot: false, first_name: 'Parent' },
      chat_instance: 'test-chat-instance',
      data,
      message: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: telegramId, type: 'private' },
        text: 'callback',
      },
    },
  };
}

export function lastReplyText(sent: SentMessage[]): string {
  for (let index = sent.length - 1; index >= 0; index -= 1) {
    const record = sent[index];
    if (record?.method === 'sendMessage') return String(record.payload.text ?? '');
  }
  return '';
}

export function allTexts(sent: SentMessage[]): string[] {
  return sent
    .filter((record) => record.method === 'sendMessage')
    .map((record) => String(record.payload.text ?? ''));
}
