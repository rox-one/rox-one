/**
 * Telegram bot worker. The bot logic is written against a small {@link BotTransport}
 * seam, so production runs on the raw Bot API over `fetch` (long polling, no
 * runtime dependencies) while tests drive a fake transport with no network and
 * no bot token.
 *
 * The worker owns one concern: turn bot updates into link-state transitions.
 * It never logs phone numbers or codes.
 */
import type { Config } from './config.ts'
import { log } from './log.ts'
import { effectiveStatus, parseStartPayload } from './link.ts'
import type { LinkState } from './state.ts'

export interface TelegramChat {
  id: number | string
}

export interface TelegramUser {
  id: number | string
}

export interface TelegramContact {
  phone_number?: string
  user_id?: number | string
  first_name?: string
}

export interface TelegramMessage {
  message_id: number
  chat?: TelegramChat
  from?: TelegramUser
  text?: string
  contact?: TelegramContact
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** Everything the bot needs from the outside world, fakeable in tests. */
export interface BotTransport {
  getMe(): Promise<{ username?: string }>
  getUpdates(offset: number, timeoutSec: number, signal: AbortSignal): Promise<TelegramUpdate[]>
  sendMessage(chatId: number | string, text: string, replyMarkup?: unknown): Promise<void>
}

interface ApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly errorCode: number,
  ) {
    super(message)
    this.name = 'TelegramApiError'
  }
}

export interface HttpBotTransportOptions {
  token: string
  apiBase: string
  /** Test seam: replaces the network. */
  fetchImpl?: FetchLike
}

/** Raw Bot API client: one JSON POST per method. */
export class HttpBotTransport implements BotTransport {
  private readonly token: string
  private readonly apiBase: string
  private readonly fetchImpl: FetchLike

  constructor(options: HttpBotTransportOptions) {
    this.token = options.token
    this.apiBase = options.apiBase
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  private async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
    const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null
    if (!response.ok || !payload?.ok) {
      const errorCode = payload?.error_code ?? response.status
      throw new TelegramApiError(payload?.description ?? `Telegram API ${method} failed with ${response.status}`, errorCode)
    }
    return payload.result as T
  }

  async getMe(): Promise<{ username?: string }> {
    return this.call<{ username?: string }>('getMe', {})
  }

  async getUpdates(offset: number, timeoutSec: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSec, allowed_updates: ['message'] },
      signal,
    )
  }

  async sendMessage(chatId: number | string, text: string, replyMarkup?: unknown): Promise<void> {
    await this.call('sendMessage', {
      chat_id: String(chatId),
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    })
  }
}

const CONTACT_KEYBOARD = {
  keyboard: [[{ text: 'Поделиться телефоном', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
}

const REQUEST_CONTACT_TEXT =
  'Чтобы подтвердить аккаунт Rox, поделитесь своим номером телефона — нажмите кнопку ниже.'
const FOREIGN_CONTACT_TEXT =
  'Нужен именно ваш номер телефона. Пожалуйста, поделитесь своим контактом, а не контактом другого человека.'
const LINK_NOT_FOUND_TEXT =
  'Ссылка не найдена или истекла. Откройте приложение Rox и нажмите «Привязать Telegram» ещё раз.'
const CONFIRMED_TEXT = 'Этот аккаунт уже подтверждён в Rox.'

/** The required user-facing instruction, sent together with the code. */
export function codeMessage(code: string): string {
  return `Ваш код: ${code}\nУ вас 30 минут, чтобы ввести код в приложении Rox.`
}

export interface TelegramBotOptions {
  transport: BotTransport
  state: LinkState
  /** Long-poll timeout handed to the transport, in seconds. */
  pollTimeoutSec?: number
  /** Retry envelope for failed polls. */
  backoffBaseMs?: number
  backoffMaxMs?: number
  /** Test seam: virtual clock. */
  now?: () => number
}

export class TelegramBot {
  private readonly transport: BotTransport
  private readonly state: LinkState
  private readonly pollTimeoutSec: number
  private readonly backoffBaseMs: number
  private readonly backoffMaxMs: number
  private readonly now: () => number
  private offset = 0
  private running = false
  private controller: AbortController | null = null
  private discoveredUsername: string | null = null

  constructor(options: TelegramBotOptions) {
    this.transport = options.transport
    this.state = options.state
    this.pollTimeoutSec = options.pollTimeoutSec ?? 25
    this.backoffBaseMs = options.backoffBaseMs ?? 1000
    this.backoffMaxMs = options.backoffMaxMs ?? 60_000
    this.now = options.now ?? Date.now
  }

  /** Bot username learned from getMe, or '' when discovery has not run/failed. */
  get botUsername(): string {
    return this.discoveredUsername ?? ''
  }

  /** Ask Telegram who we are, so the HTTP layer can build deep links. */
  async resolveUsername(): Promise<string | null> {
    try {
      const me = await this.transport.getMe()
      this.discoveredUsername = me.username ?? null
      return this.discoveredUsername
    } catch (error) {
      log('warn', 'getMe failed', { detail: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  /** Route one update. Contact ownership is enforced here. */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message
    const chatId = message?.chat?.id
    const fromId = message?.from?.id
    if (!message || chatId === undefined || fromId === undefined) return

    if (message.contact) {
      await this.handleContact(chatId, fromId, message.contact)
      return
    }
    if (typeof message.text === 'string' && message.text.trim() !== '') {
      await this.handleText(chatId, message.text)
    }
  }

  private async handleText(chatId: number | string, text: string): Promise<void> {
    const parsed = parseStartPayload(text)
    if (!parsed) return
    if (parsed.command === 'status') {
      await this.replyStatus(chatId)
      return
    }
    if (parsed.command !== 'start') return

    const linkId = parsed.payload
    if (linkId === null) {
      await this.transport.sendMessage(chatId, LINK_NOT_FOUND_TEXT)
      return
    }
    const record = this.state.byId(linkId)
    if (!record) {
      await this.transport.sendMessage(chatId, LINK_NOT_FOUND_TEXT)
      return
    }
    const status = effectiveStatus(record.status, record.expiresAt, this.now())
    if (status === 'waiting' || status === 'code_issued') {
      this.state.bindChat(String(chatId), linkId, this.now())
    }
    if (status === 'waiting') {
      await this.transport.sendMessage(chatId, REQUEST_CONTACT_TEXT, CONTACT_KEYBOARD)
      return
    }
    if (status === 'code_issued' && record.code !== null) {
      await this.transport.sendMessage(chatId, codeMessage(record.code))
      return
    }
    await this.transport.sendMessage(chatId, status === 'confirmed' ? CONFIRMED_TEXT : LINK_NOT_FOUND_TEXT)
  }

  private async replyStatus(chatId: number | string): Promise<void> {
    const linkId = this.state.linkForChat(String(chatId))
    const view = linkId === null ? null : this.state.status(linkId, this.now())
    if (!view) {
      await this.transport.sendMessage(chatId, LINK_NOT_FOUND_TEXT)
      return
    }
    if (view.status === 'waiting') {
      await this.transport.sendMessage(chatId, REQUEST_CONTACT_TEXT, CONTACT_KEYBOARD)
      return
    }
    if (view.status === 'code_issued' && view.code !== undefined) {
      await this.transport.sendMessage(chatId, codeMessage(view.code))
      return
    }
    await this.transport.sendMessage(chatId, view.status === 'confirmed' ? CONFIRMED_TEXT : LINK_NOT_FOUND_TEXT)
  }

  /**
   * Handle a shared contact. A forwarded/foreign contact
   * (`contact.user_id !== from.id`) is rejected and never binds a phone.
   */
  private async handleContact(chatId: number | string, fromId: number | string, contact: TelegramContact): Promise<void> {
    const linkId = this.state.linkForChat(String(chatId))
    if (linkId === null) {
      await this.transport.sendMessage(chatId, LINK_NOT_FOUND_TEXT)
      return
    }
    if (String(contact.user_id ?? '') !== String(fromId)) {
      await this.transport.sendMessage(chatId, FOREIGN_CONTACT_TEXT, CONTACT_KEYBOARD)
      return
    }
    const phone = (contact.phone_number ?? '').trim()
    if (phone === '') {
      await this.transport.sendMessage(chatId, FOREIGN_CONTACT_TEXT, CONTACT_KEYBOARD)
      return
    }
    const issued = this.state.issueCode(String(chatId), phone, this.now())
    if (!issued || issued.record.code === null) {
      await this.transport.sendMessage(chatId, LINK_NOT_FOUND_TEXT)
      return
    }
    await this.transport.sendMessage(chatId, codeMessage(issued.record.code))
  }

  /** One poll + dispatch cycle. Returns how many updates were processed. */
  async runOnce(signal: AbortSignal): Promise<number> {
    const updates = await this.transport.getUpdates(this.offset, this.pollTimeoutSec, signal)
    let processed = 0
    for (const update of updates) {
      if (typeof update.update_id === 'number') this.offset = update.update_id + 1
      try {
        await this.handleUpdate(update)
        processed += 1
      } catch (error) {
        log('warn', 'update handling failed', {
          updateId: update.update_id,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return processed
  }

  /** Long-poll loop with capped exponential backoff (+ jitter). */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    let backoff = this.backoffBaseMs
    log('info', 'telegram polling started')
    while (this.running) {
      const controller = new AbortController()
      this.controller = controller
      try {
        await this.runOnce(controller.signal)
        backoff = this.backoffBaseMs
      } catch (error) {
        if (!this.running) break
        const detail = error instanceof Error ? error.message : String(error)
        log('warn', 'telegram poll failed; backing off', { backoffMs: backoff, detail })
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, backoff / 2 + Math.random() * (backoff / 2))
        await promise
        backoff = Math.min(backoff * 2, this.backoffMaxMs)
      }
    }
    this.controller = null
  }

  stop(): void {
    this.running = false
    this.controller?.abort()
  }
}

/** Build the production transport from config. */
export function botTransportFromConfig(config: Config, fetchImpl?: FetchLike): BotTransport {
  return new HttpBotTransport({ token: config.botToken, apiBase: config.polling.apiBase, fetchImpl })
}