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

/** Normalize an untrusted native `onStatus` payload into our wire shape. */
export function normalizeImStatus(raw: unknown): ImStatusEvent {
  // Boundary value from the native module; read only validated fields below.
  const record: Record<string, unknown> | null = asRecord(raw)
  const available = record?.available === true || record?.online === true
  const reason = typeof record?.reason === 'string' ? record.reason : undefined
  return { available, mode: available ? 'native' : 'fallback', ...(reason ? { reason } : {}) }
}

export class ImService {
  private readonly options: ImServiceOptions
  private client: ImChatCoreClient | null = null
  private push: ImPushSink | null = null
  private status: ImStatusEvent = { available: false, mode: 'fallback', reason: 'not-started' }
  private lastReason: ImUnavailableReason = 'not-configured'
  private startPromise: Promise<ImStatusEvent> | null = null

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
    client.onMessage?.((message) => this.push?.message(message))
    client.onPresence?.((presence) => this.push?.presence(presence))
    client.onTyping?.((typing) => this.push?.typing(typing))
    client.onStatus?.((status) => this.publishStatus(normalizeImStatus(status)))
  }

  async stop(): Promise<void> {
    const client = this.client
    this.client = null
    this.startPromise = null
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

  async subscribeChannel(channelId: string): Promise<ImResult<Record<never, never>>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    await this.client.subscribe(channelId)
    return { ok: true }
  }

  async unsubscribeChannel(channelId: string): Promise<ImResult<Record<never, never>>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    await this.client.unsubscribe(channelId)
    return { ok: true }
  }

  async sendMessage(channelId: string, text: string): Promise<ImResult<{ message: ImMessageEvent }>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    const message = await this.client.sendMessage(channelId, text)
    return { ok: true, message }
  }

  async listMessages(input: ImListMessagesInput): Promise<ImResult<{ messages: ImMessageEvent[] }>> {
    await this.ensureStarted()
    if (!this.client) return this.fallback()
    const messages = await this.client.listMessages(input)
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
