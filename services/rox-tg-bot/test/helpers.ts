/**
 * Test helpers: an in-memory state factory, a fake bot transport and update
 * builders. Nothing here touches the network or a real bot token.
 */
import type { BotTransport, TelegramUpdate } from '../src/bot.ts'
import { CODE_ALPHABET, type RandomIndex } from '../src/link.ts'
import { LinkState } from '../src/state.ts'

export const NOW = 1_700_000_000_000

/** Deterministic state: codes spell out `codeRepeats` and link ids count up. */
export function memoryState(options: { code?: string; linkIds?: string[] } = {}): LinkState {
  const letters = [...(options.code ?? 'ABCDEFGH')]
  let codeIndex = 0
  const linkIds = [...(options.linkIds ?? ['link-1', 'link-2', 'link-3', 'link-4', 'link-5'])]
  const randomIndex: RandomIndex = () => {
    const char = letters[codeIndex % letters.length] ?? 'A'
    codeIndex += 1
    return CODE_ALPHABET.indexOf(char)
  }
  return new LinkState(':memory:', { randomIndex, makeLinkId: () => linkIds.shift() ?? `link-${Math.random()}` })
}

export interface SentMessage {
  chatId: string
  text: string
  replyMarkup: unknown
}

export class FakeBotTransport implements BotTransport {
  readonly sent: SentMessage[] = []
  username: string | null = 'rox_test_bot'
  private updates: TelegramUpdate[] = []

  async getMe(): Promise<{ username?: string }> {
    return this.username === null ? {} : { username: this.username }
  }

  async getUpdates(offset: number): Promise<TelegramUpdate[]> {
    const ready = this.updates.filter(update => update.update_id >= offset)
    this.updates = this.updates.filter(update => update.update_id < offset)
    return ready
  }

  async sendMessage(chatId: number | string, text: string, replyMarkup?: unknown): Promise<void> {
    this.sent.push({ chatId: String(chatId), text, replyMarkup })
  }

  /** Queue an update for the next `getUpdates` call. */
  push(update: TelegramUpdate): void {
    this.updates.push(update)
  }

  /** Text of the most recent message sent to a chat, or null. */
  lastText(chatId?: string): string | null {
    const messages = chatId === undefined ? this.sent : this.sent.filter(message => message.chatId === chatId)
    return messages.at(-1)?.text ?? null
  }

  /** Last reply markup sent to a chat, or null. */
  lastMarkup(chatId?: string): unknown {
    const messages = chatId === undefined ? this.sent : this.sent.filter(message => message.chatId === chatId)
    return messages.at(-1)?.replyMarkup ?? null
  }
}

type MessageFields = Omit<NonNullable<TelegramUpdate['message']>, 'message_id' | 'chat' | 'from'>

export function message(partial: MessageFields & Partial<Pick<NonNullable<TelegramUpdate['message']>, 'chat' | 'from'>> = {}): TelegramUpdate {
  return { update_id: 1, message: { message_id: 1, chat: { id: '42' }, from: { id: '42' }, ...partial } }
}

export function command(text: string, overrides: Parameters<typeof message>[0] = {}): TelegramUpdate {
  return message({ text, ...overrides })
}

/** A contact message claiming the given phone for the given telegram user. */
export function contactMessage(phone: string, overrides: { fromId?: number | string; chatId?: number | string; contactUserId?: number | string | null } = {}): TelegramUpdate {
  const fromId = overrides.fromId ?? '42'
  const chatId = overrides.chatId ?? fromId
  return message({
    chat: { id: chatId },
    from: { id: fromId },
    contact: {
      phone_number: phone,
      ...(overrides.contactUserId === null ? {} : { user_id: overrides.contactUserId ?? fromId }),
    },
  })
}