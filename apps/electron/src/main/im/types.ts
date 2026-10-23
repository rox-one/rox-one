/**
 * Structural types for the native chat-core messenger relay (deliverable 4).
 *
 * `@rox/chat-core` is a frozen, optional dependency: at runtime it may be
 * absent (dev builds, unsupported base image). Its public surface is declared
 * here structurally — never with a static import — so this module compiles and
 * loads whether or not the package is installed. The loader adapts the real
 * module to these shapes and reports `unavailable` on any mismatch.
 */

import type {
  ImMessageEvent,
  ImPresenceEvent,
  ImPresenceStatus,
  ImStatusEvent,
  ImTypingEvent,
} from '@rox/shared/protocol'

export type { ImMessageEvent, ImPresenceEvent, ImPresenceStatus, ImStatusEvent, ImTypingEvent }

/** Constructor options for the frozen `createChatCore(options)` factory. */
export interface ImChatCoreOptions {
  relayUrl: string
  dbPath: string
  secretKeyHex: string
  channels?: string[]
}

/** List-message page input (mirrors the frozen client's `listMessages`). */
export interface ImListMessagesInput {
  channelId: string
  /** Native addon uses `before` (unix seconds / createdAt cursor). */
  before?: number
  beforeSeq?: number
  limit?: number
}

/**
 * Structural view of the frozen `ChatCore` instance. Every callback is
 * optional because a partial/older native module must degrade to the JSON
 * team-chat fallback rather than crash the main process.
 */
export interface ImChatCoreClient {
  start(): void | Promise<void>
  stop(): void | Promise<void>
  subscribe(channelId: string): void | Promise<void>
  unsubscribe(channelId: string): void | Promise<void>
  sendMessage(channelId: string, text: string): ImMessageEvent | Promise<ImMessageEvent>
  editMessage?(channelId: string, messageId: string, text: string): ImMessageEvent | Promise<ImMessageEvent>
  deleteMessage?(channelId: string, messageId: string): void | Promise<void>
  listMessages(channel: string, options?: { limit?: number; before?: number }): ImMessageEvent[] | Promise<ImMessageEvent[]>
  markRead?(channelId: string): void | Promise<void>
  searchMessages?(query: string, opts?: { channelId?: string; limit?: number }): ImMessageEvent[] | Promise<ImMessageEvent[]>
  publishTyping(channelId: string, isTyping: boolean): void | Promise<void>
  onMessage?(callback: (message: ImMessageEvent) => void): void
  onPresence?(callback: (presence: ImPresenceEvent) => void): void
  onTyping?(callback: (typing: ImTypingEvent) => void): void
  onStatus?(callback: (status: unknown) => void): void
}

/** Shape of the resolved `@rox/chat-core` module namespace. */
export interface ImChatCoreModule {
  createChatCore(options: ImChatCoreOptions): ImChatCoreClient
  /** Present when the native binding is missing at call time. */
  ChatCoreUnavailableError?: new (message?: string) => Error
}

/** Injectable module loader (defaults to a real dynamic `import()`). */
export type ImModuleLoader = () => Promise<unknown>

/** Why the native relay is not active; the renderer maps this to a fallback. */
export type ImUnavailableReason =
  | 'flag-disabled'
  | 'not-configured'
  | 'module-missing'
  | 'native-unavailable'
  | 'start-failed'
  | 'stopped'

/** Outcome of loading the native chat-core client. */
export type ImLoadResult =
  | { status: 'ready'; client: ImChatCoreClient }
  | { status: 'unavailable'; reason: ImUnavailableReason }

/** A request result; `ok: false` tells the caller to use the team-chat store. */
export type ImResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: ImUnavailableReason; fallback: 'team-chat' }
