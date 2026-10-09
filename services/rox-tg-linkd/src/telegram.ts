/**
 * Telegram Bot API client + long-polling worker, raw `fetch` only.
 *
 * The worker owns one concern: turn bot updates into pending-link state
 * transitions. It never logs phone numbers or codes.
 */
import type { Config } from './config.ts'
import { log } from './log.ts'
import { effectiveStatus, parseStartPayload } from './link.ts'
import type { LinkStore, PendingLink } from './store.ts'

export interface TelegramChat {
  id: number | string
}

export interface TelegramUser {
  id: number | string
}

export interface TelegramMessage {
  message_id: number
  chat?: TelegramChat
  from?: TelegramUser
  text?: string
  contact?: { phone_number?: string; user_id?: number | string; first_name?: string }
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface TelegramBotOptions {
  config: Config
  store: LinkStore
  /** Test seam: replaces the network. */
  fetchImpl?: FetchLike
  /** Test seam: virtual clock. */
  now?: () => number
}

interface ApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

const CONTACT_KEYBOARD = {
  keyboard: [[{ text: 'Поделиться телефоном', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
}

const REQUEST_CONTACT_TEXT = 'Поделитесь своим номером телефона, чтобы подтвердить аккаунт Rox.'
const FOREIGN_CONTACT_TEXT = 'Нужен именно ваш номер. Пожалуйста, поделитесь своим контактом, а не контактом другого человека.'
const LINK_NOT_FOUND_TEXT = 'Ссылка не найдена или истекла. Откройте приложение Rox и нажмите «Привязать Telegram» ещё раз.'

function codeMessage(code: string): string {
  return `Ваш код: ${code}. У вас 30 минут — введите его в приложении Rox.`
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

export class TelegramBot {
  private readonly config: Config
  private readonly store: LinkStore
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private offset = 0
  private running = false
  private controller: AbortController | null = null
  private discoveredUsername: string | null = null

  constructor(options: TelegramBotOptions) {
    this.config = options.config
    this.store = options.store
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.now = options.now ?? Date.now
  }

  get token(): string {
    return this.config.botToken
  }

  /** Bot username, preferring the configured value then the getMe discovery. */
  username(): string {
    return this.config.botUsername || this.discoveredUsername || ''
  }

  private apiUrl(method: string): string {
    return `${this.config.polling.apiBase}/bot${this.config.botToken}/${method}`
  }

  private async callApi<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(this.apiUrl(method), {
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

  /** Learn the bot username so deep links can be built when none is configured. */
  async resolveUsername(): Promise<string | null> {
    if (this.token === '') return null
    try {
      const me = await this.callApi<{ username?: string }>('getMe', {})
      this.discoveredUsername = me.username ?? null
      return this.discoveredUsername
    } catch (error) {
      log('warn', 'getMe failed', { detail: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  async getUpdates(signal: AbortSignal): Promise<TelegramUpdate[]> {
    return this.callApi<TelegramUpdate[]>(
      'getUpdates',
      { offset: this.offset, timeout: this.config.polling.pollTimeoutSec, allowed_updates: ['message'] },
      signal,
    )
  }

  async sendMessage(chatId: number | string, text: string, replyMarkup?: unknown): Promise<void> {
    await this.callApi('sendMessage', {
      chat_id: String(chatId),
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    })
  }

  /**
   * Route one update. Contact ownership is enforced here: a forwarded contact
   * (`contact.user_id !== from.id`) is rejected and never binds a phone.
   */
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
    if (!parsed || parsed.command !== 'start') return
    const token = parsed.payload
    const pending = token ? this.store.byToken(token) : null
    if (!token || !pending) {
      await this.sendMessage(chatId, LINK_NOT_FOUND_TEXT)
      return
    }
    const status = effectiveStatus(pending.status, pending.expiresAt, this.now())
    if (status === 'waiting-code') {
      this.store.bindChat(token, String(chatId), this.now())
      await this.sendMessage(chatId, REQUEST_CONTACT_TEXT, CONTACT_KEYBOARD)
      return
    }
    if (status === 'code-sent' && pending.code) {
      await this.sendMessage(chatId, codeMessage(pending.code))
      return
    }
    await this.sendMessage(chatId, LINK_NOT_FOUND_TEXT)
  }

  private async handleContact(
    chatId: number | string,
    fromId: number | string,
    contact: NonNullable<TelegramMessage['contact']>,
  ): Promise<void> {
    const pending: PendingLink | null = this.store.findByChat(String(chatId), this.now())
    if (!pending) {
      await this.sendMessage(chatId, LINK_NOT_FOUND_TEXT)
      return
    }
    if (String(contact.user_id ?? '') !== String(fromId)) {
      await this.sendMessage(chatId, FOREIGN_CONTACT_TEXT, CONTACT_KEYBOARD)
      return
    }
    const phone = (contact.phone_number ?? '').trim()
    if (phone === '') {
      await this.sendMessage(chatId, FOREIGN_CONTACT_TEXT, CONTACT_KEYBOARD)
      return
    }
    const bound = this.store.bindPhone(String(chatId), phone, String(fromId), this.now())
    if (!bound?.code) {
      await this.sendMessage(chatId, LINK_NOT_FOUND_TEXT)
      return
    }
    await this.sendMessage(chatId, codeMessage(bound.code))
  }

  /** One poll + dispatch cycle. Returns how many updates were processed. */
  async runOnce(signal: AbortSignal): Promise<number> {
    const updates = await this.getUpdates(signal)
    let processed = 0
    for (const update of updates) {
      if (typeof update.update_id === 'number') this.offset = update.update_id + 1
      try {
        await this.handleUpdate(update)
        processed += 1
      } catch (error) {
        log('warn', 'update handling failed', { updateId: update.update_id, detail: error instanceof Error ? error.message : String(error) })
      }
    }
    return processed
  }

  /**
   * Long-poll loop with capped exponential backoff (+ jitter). Returns
   * immediately when no bot token is configured.
   */
  async start(): Promise<void> {
    if (this.token === '') {
      log('warn', 'TG_BOT_TOKEN is not set — bot polling disabled')
      return
    }
    if (this.running) return
    this.running = true
    let backoff = this.config.polling.backoffBaseMs
    log('info', 'telegram polling started', { apiBase: this.config.polling.apiBase })
    while (this.running) {
      const controller = new AbortController()
      this.controller = controller
      try {
        await this.runOnce(controller.signal)
        backoff = this.config.polling.backoffBaseMs
      } catch (error) {
        if (!this.running) break
        const detail = error instanceof Error ? error.message : String(error)
        log('warn', 'telegram poll failed; backing off', { backoffMs: backoff, detail })
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, backoff / 2 + Math.random() * (backoff / 2))
        await promise
        backoff = Math.min(backoff * 2, this.config.polling.backoffMaxMs)
      }
    }
    this.controller = null
  }

  stop(): void {
    this.running = false
    this.controller?.abort()
  }
}