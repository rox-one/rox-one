/**
 * Native chat-core messenger relay service (deliverable 4).
 *
 * Owns the single `@rox/chat-core` client for the host: lazily loads it behind
 * the messenger flag, wires its `onMessage` / `onPresence` / `onTyping` /
 * `onStatus` callbacks to a push sink (the RPC handlers forward those to the
 * renderer as `im:*` events), and exposes the request surface the handlers
 * delegate to. When the native module is absent (or the flag is off) every
 * request answers `{ ok: false, fallback: 'team-chat' }` and the renderer uses
 * the JSON team-chat store instead — the relay never throws into a handler.
 */

import { resolveConfigDir } from '@rox/shared/config'
import { loadImChatCore } from './chat-core-loader'
import { isModeMessengerEnabled, MODE_MESSENGER_ENV_KEY } from './flags'
import type {
  ImChatCoreClient,
  ImChatCoreOptions,
  ImListMessagesInput,
  ImMessageEvent,
  ImModuleLoader,
  ImPresenceEvent,
  ImPresenceStatus,
  ImResult,
  ImStatusEvent,
  ImTypingEvent,
  ImUnavailableReason,
} from './types'

/** Sink the RPC handlers provide so the service can push `im:*` events. */
export interface ImPushSink {
  message(message: ImMessageEvent): void
  presence(presence: ImPresenceEvent): void
  typing(typing: ImTypingEvent): void
  status(status: ImStatusEvent): void
}

export interface ImServiceOptions {
  /** Effective flag state; defaults to `isModeMessengerEnabled()`. */
  enabled?: boolean
  /**
   * Resolves the native client's constructor options, or `null` when the relay
   * is not configured on this host. Defaults to env-provided configuration.
   */
  resolveChatCoreOptions?: () => ImChatCoreOptions | null
  /** Test seam for the module loader. */
  load?: ImModuleLoader
}

/** Env-configurable relay settings; no secret is ever bundled or logged. */
export function resolveImChatCoreOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): ImChatCoreOptions | null {
  const relayUrl = env.ROX_IM_RELAY_URL?.trim()
  const secretKeyHex = env.ROX_IM_SECRET_KEY_HEX?.trim()
  if (!relayUrl || !secretKeyHex) return null
  const dbPath = env.ROX_IM_DB_PATH?.trim() || `${resolveConfigDir()}/im-chat-core.sqlite`
  return { relayUrl, dbPath, secretKeyHex }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** Normalize native / mock message shapes into ImMessageEvent (pubkey→senderId, content→text). */
export function normalizeImMessage(raw: unknown, fallback?: { channelId?: string; text?: string; senderId?: string }): ImMessageEvent | null {
  const record = asRecord(raw)
  if (!record) return null
  const id = typeof record.id === 'string' ? record.id : ''
  if (!id) return null
  const channelId =
    (typeof record.channelId === 'string' && record.channelId) ||
    (typeof record.channel_id === 'string' && record.channel_id) ||
    fallback?.channelId ||
    ''
  const senderId =
    (typeof record.senderId === 'string' && record.senderId) ||
    (typeof record.pubkey === 'string' && record.pubkey) ||
    fallback?.senderId ||
    ''
  const text =
    (typeof record.text === 'string' && record.text) ||
    (typeof record.content === 'string' && record.content) ||
    fallback?.text ||
    ''
  if (!channelId || !senderId) return null
  // Native ChatMessage uses `created_at` (unix seconds); ImMessageEvent uses `createdAt` (ms).
  let createdAt = Date.now()
  if (typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)) {
    createdAt = Math.round(record.createdAt)
  } else if (typeof record.created_at === 'number' && Number.isFinite(record.created_at)) {
    const sec = record.created_at
    createdAt = sec < 1_000_000_000_000 ? Math.round(sec * 1000) : Math.round(sec)
  }
  const out: ImMessageEvent = { id, channelId, senderId, text, createdAt }
  if (typeof record.editedAt === 'number') out.editedAt = record.editedAt
  if (typeof record.deletedAt === 'number') out.deletedAt = record.deletedAt
  // reply from explicit fields or Nostr `e` tags: prefer marker "reply", else last non-edit `e`.
  if (typeof record.replyToId === 'string' && record.replyToId) out.replyToId = record.replyToId
  if (typeof record.threadId === 'string' && record.threadId) out.threadId = record.threadId
  if (!out.replyToId && Array.isArray(record.tags)) {
    let replyMarked: string | undefined
    let lastE: string | undefined
    for (const tag of record.tags) {
      if (!Array.isArray(tag) || tag[0] !== 'e' || typeof tag[1] !== 'string' || !tag[1]) continue
      if (tag[3] === 'edit') continue
      if (tag[3] === 'reply') replyMarked = tag[1]
      lastE = tag[1]
    }
    const chosen = replyMarked ?? lastE
    if (chosen) {
      out.replyToId = chosen
      out.threadId = out.threadId ?? chosen
    }
  }
  return out
}

/** Normalize an untrusted native `onStatus` payload into our wire shape. */
export function normalizeImStatus(raw: unknown): ImStatusEvent {
  // Boundary value from the native module; read only validated fields below.
  // Native addon emits `{ state: 'connected' | 'reconnecting' | 'offline' }`.
  const record: Record<string, unknown> | null = asRecord(raw)
  const state = typeof record?.state === 'string' ? record.state : undefined
  const available =
    record?.available === true ||
    record?.online === true ||
    state === 'connected' ||
    state === 'reconnecting'
  const reason =
    typeof record?.reason === 'string'
      ? record.reason
      : state === 'offline'
        ? 'offline'
        : state === 'reconnecting'
          ? 'reconnecting'
          : undefined
  return { available, mode: available ? 'native' : 'fallback', ...(reason ? { reason } : {}) }
}

export class ImService {
  private readonly options: ImServiceOptions
  private client: ImChatCoreClient | null = null
  private push: ImPushSink | null = null
  private status: ImStatusEvent = { available: false, mode: 'fallback', reason: 'not-started' }
  private lastReason: ImUnavailableReason = 'not-configured'
  private startPromise: Promise<ImStatusEvent> | null = null
  /** Per-channel subscribe refcounts (open view + followed fan-out share one native sub). */
  private subscribeRefs = new Map<string, number>()
  /** Per-channel promise chain so concurrent subscribe/unsubscribe cannot undercount. */
  private subscribeLocks = new Map<string, Promise<void>>()

  constructor(options: ImServiceOptions = {}) {
    this.options = options
  }

  /** Install the push sink; called once per handler registration. */
  setPush(push: ImPushSink | null): void {
    this.push = push
  }

  /** Current availability; `mode: 'fallback'` means use the team-chat store. */
  getStatus(): ImStatusEvent {
    return this.status
  }

  isAvailable(): boolean {
    return this.client !== null
  }

  private publishStatus(next: ImStatusEvent): ImStatusEvent {
    const changed =
      next.available !== this.status.available ||
      next.mode !== this.status.mode ||
      next.reason !== this.status.reason
    this.status = next
    if (changed) this.push?.status(next)
    return next
  }

  /** Idempotent lazy start. Resolves to the resulting (never-throwing) status. */
  ensureStarted(): Promise<ImStatusEvent> {
    if (!this.startPromise) this.startPromise = this.start()
    return this.startPromise
  }

  private async start(): Promise<ImStatusEvent> {
    const enabled = this.options.enabled ?? isModeMessengerEnabled()
    const options = enabled ? (this.options.resolveChatCoreOptions ?? resolveImChatCoreOptionsFromEnv)() : null
    const result = await loadImChatCore({ enabled, options, load: this.options.load })
    if (result.status === 'unavailable') {
      this.lastReason = result.reason
      return this.publishStatus({ available: false, mode: 'fallback', reason: result.reason })
    }
    this.client = result.client
    this.wireClient(result.client)
    return this.publishStatus({ available: true, mode: 'native' })
  }

  private wireClient(client: ImChatCoreClient): void {
    client.onMessage?.((message) => {
      const normalized = normalizeImMessage(message)
      if (normalized) this.push?.message(normalized)
    })
    client.onPresence?.((presence) => this.push?.presence(presence))
    client.onTyping?.((typing) => this.push?.typing(typing))
    client.onStatus?.((status) => this.publishStatus(normalizeImStatus(status)))
  }

  async stop(): Promise<void> {
    const client = this.client
    this.client = null
    this.startPromise = null
    this.subscribeRefs.clear()
    this.subscribeLocks.clear()
    this.lastReason = 'stopped'
    this.publishStatus({ available: false, mode: 'fallback', reason: 'stopped' })
    if (client) {
      try {
        await client.stop()
      } catch {
        // A client teardown failure must never block shutdown.
      }
    }
  }

  private fallback(): { ok: false; reason: ImUnavailableReason; fallback: 'team-chat' } {
    return { ok: false, reason: this.lastReason, fallback: 'team-chat' }
  }

  /** Run `fn` exclusively for `channelId` (serialize RMW around await). */
  private async withSubscribeLock<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.subscribeLocks.get(channelId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = prev.then(() => gate)
    this.subscribeLocks.set(channelId, tail)
    await prev.catch(() => {})
    try {
      return await fn()
    } finally {
      release()
      if (this.subscribeLocks.get(channelId) === tail) this.subscribeLocks.delete(channelId)
    }
  }

  async subscribeChannel(channelId: string): Promise<ImResult<Record<never, never>>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    return this.withSubscribeLock(channelId, async () => {
      if (!this.client) return this.fallback()
      const prev = this.subscribeRefs.get(channelId) ?? 0
      if (prev === 0) await this.client.subscribe(channelId)
      this.subscribeRefs.set(channelId, prev + 1)
      return { ok: true }
    })
  }

  async unsubscribeChannel(channelId: string): Promise<ImResult<Record<never, never>>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    return this.withSubscribeLock(channelId, async () => {
      if (!this.client) return this.fallback()
      const prev = this.subscribeRefs.get(channelId) ?? 0
      if (prev <= 0) return { ok: true }
      const next = prev - 1
      if (next === 0) {
        this.subscribeRefs.delete(channelId)
        await this.client.unsubscribe(channelId)
      } else {
        this.subscribeRefs.set(channelId, next)
      }
      return { ok: true }
    })
  }

  async sendMessage(channelId: string, text: string): Promise<ImResult<{ message: ImMessageEvent }>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    const raw = await this.client.sendMessage(channelId, text)
    const message =
      normalizeImMessage(raw, { channelId, text, senderId: 'self' }) ??
      ({ id: typeof (raw as { id?: string })?.id === 'string' ? (raw as { id: string }).id : `local-${Date.now()}`, channelId, senderId: 'self', text, createdAt: Date.now() } satisfies ImMessageEvent)
    return { ok: true, message }
  }

  async listMessages(input: ImListMessagesInput): Promise<ImResult<{ messages: ImMessageEvent[] }>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    const before = input.before ?? input.beforeSeq
    const options =
      input.limit !== undefined || before !== undefined
        ? { ...(input.limit !== undefined ? { limit: input.limit } : {}), ...(before !== undefined ? { before } : {}) }
        : undefined
    const raw = await this.client.listMessages(input.channelId, options)
    const messages = (Array.isArray(raw) ? raw : [])
      .map((row) => normalizeImMessage(row, { channelId: input.channelId }))
      .filter((m): m is ImMessageEvent => m !== null)
    return { ok: true, messages }
  }

  async searchMessages(
    query: string,
    opts?: { channelId?: string; limit?: number },
  ): Promise<ImResult<{ messages: ImMessageEvent[] }>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    if (!this.client.searchMessages) return this.fallback()
    const raw = await this.client.searchMessages(query, opts)
    const messages = (Array.isArray(raw) ? raw : [])
      .map((row) => normalizeImMessage(row, opts?.channelId ? { channelId: opts.channelId } : undefined))
      .filter((m): m is ImMessageEvent => m !== null)
    return { ok: true, messages }
  }

  async publishTyping(channelId: string, isTyping: boolean): Promise<ImResult<Record<never, never>>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    await this.client.publishTyping(channelId, isTyping)
    return { ok: true }
  }

  async markRead(channelId: string): Promise<ImResult<Record<never, never>>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    await this.client.markRead?.(channelId)
    return { ok: true }
  }
}

let singleton: ImService | null = null

/** Process-wide relay service (the handlers share one native client). */
export function getImService(): ImService {
  if (!singleton) singleton = new ImService()
  return singleton
}

/** Test seam: replace the process-wide service. */
export function setImServiceForTests(service: ImService | null): void {
  singleton = service
}

export { MODE_MESSENGER_ENV_KEY }
export type { ImMessageEvent, ImPresenceEvent, ImPresenceStatus, ImStatusEvent, ImTypingEvent }
