/**
 * Session lifecycle event bus (PRD §8 "Lifecycle hooks" / §32).
 *
 * In-process, synchronous fan-out for the ten session learning hooks.
 * `SessionManager` publishes; consumers (learning service, outcome store,
 * analytics) subscribe with {@link SessionEventBus.on} instead of importing
 * the manager — the bus is the seam, not another dependency edge.
 *
 * Contract:
 * - Delivery is synchronous, one listener at a time, in subscription order.
 * - A throwing listener is logged and skipped: it can never break the emitter
 *   (and therefore never the session pipeline) nor starve the other listeners.
 * - `emit` with no listeners for that type returns immediately without
 *   allocating, so an unwired bus costs nothing on hot paths (tool events).
 * - Every event carries the shared envelope: `sessionId`, `workspaceId`
 *   (broadcast scope) and an ISO-8601 `ts`.
 * - `user.correction` / `session.branched` are attributed to the session that
 *   was branched *from* (the corrected session); the new session id rides in
 *   `SessionBranchedEvent.newSessionId`.
 */

import { CONSOLE_LOGGER, createScopedLogger } from '@rox/server-core/runtime'
import type { TokenUsage } from '@rox/core/types'

const busLog = createScopedLogger(CONSOLE_LOGGER, 'session-event-bus')

/** Envelope shared by every lifecycle event. */
export interface SessionLifecycleEvent {
  /** Session the event belongs to (see per-event docs for attribution). */
  sessionId: string
  /** Workspace that scopes the event. */
  workspaceId: string
  /** ISO-8601 timestamp. */
  ts: string
}

export type SessionCreatedReason = 'create' | 'branch' | 'import' | 'unknown'

/** PRD §8 `session.created` — a session became live (created, branched or imported). */
export interface SessionCreatedEvent extends SessionLifecycleEvent {
  reason: SessionCreatedReason
}

/** PRD §8 `session.prompt.assembled` — what actually reached the model context. */
export interface PromptAssembledEvent extends SessionLifecycleEvent {
  model?: string
  /**
   * Lessons injected into the prompt, exactly as recorded in the session
   * provenance file (`LessonUsage` = rule + scope). This is the shape the
   * learning contract expects (`LearningServicePorts.recordContextUsage`).
   */
  lessons?: Array<{ rule: string; scope: 'global' | 'workspace' }>
  /**
   * Lesson ids, when a producer can resolve them. Provenance stores rule+scope,
   * so no producer currently fills this — consumers should prefer `lessons`.
   */
  lessonIds?: string[]
  /**
   * Episodic-memory episode ids, when recall exposes them. MemoryService keeps
   * episode ids internal (only formatted text reaches the prompt), so no
   * producer currently fills this.
   */
  episodeIds?: string[]
  /** Skill slugs injected via `[skill:slug]` mentions in the session messages. */
  skillSlugs?: string[]
}

/** PRD §8 `tool.call` — for outcome analysis. */
export interface ToolCallEvent extends SessionLifecycleEvent {
  tool: string
  /** `toolUseId` of the call — matches {@link ToolResultEvent.callId}. */
  callId: string
  /** Cheap, clipped argument digest (never the full tool input). */
  argsSummary?: string
}

/** PRD §8 `tool.result` — success/failure, latency, error. */
export interface ToolResultEvent extends SessionLifecycleEvent {
  tool: string
  callId: string
  ok: boolean
  /** Wall-clock latency measured from the tool message that opened the call. */
  latencyMs?: number
  /** Clipped result excerpt when `ok` is false. */
  error?: string
}

export type UserCorrectionKind = 'branch' | 'plan_edit' | 'rejected' | 'fact_correction'

/** PRD §8 `user.correction` — the highest-value learning signal. */
export interface UserCorrectionEvent extends SessionLifecycleEvent {
  kind: UserCorrectionKind
  detail?: string
}

export type VerificationKind = 'tests' | 'typecheck' | 'build' | 'lint'

/** PRD §8 `verification.completed`. */
export interface VerificationCompleteEvent extends SessionLifecycleEvent {
  kind: VerificationKind
  ok: boolean
  summary?: string
}

export type SessionCompleteReason = 'complete' | 'interrupted' | 'error' | 'timeout'

/** PRD §8 `session.completed` — creates the `TaskOutcome`. */
export interface SessionCompleteEvent extends SessionLifecycleEvent {
  reason: SessionCompleteReason
  finalMessageId?: string
  tokenUsage?: TokenUsage
}

/** PRD §8 `session.failed` — terminal failure evidence. */
export interface SessionFailedEvent extends SessionLifecycleEvent {
  error?: string
}

/**
 * PRD §8 `session.branches` — a user branching off an earlier message is a
 * strong correction signal. `sessionId` is the session branched *from*.
 */
export interface SessionBranchedEvent extends SessionLifecycleEvent {
  /** Message id the branch was taken at (the point the user rejected). */
  fromMessageId?: string
  /** Newly created branch session. */
  newSessionId?: string
}

/** PRD §8 `workspace.idle` — background learning trigger. */
export interface WorkspaceIdleEvent extends SessionLifecycleEvent {
  idleMs?: number
}

/** Event type → payload contract. Every PRD §8 hook is representable here. */
export interface SessionLifecycleEventMap {
  'session.created': SessionCreatedEvent
  'prompt.assembled': PromptAssembledEvent
  'tool.call': ToolCallEvent
  'tool.result': ToolResultEvent
  'user.correction': UserCorrectionEvent
  'verification.completed': VerificationCompleteEvent
  'session.completed': SessionCompleteEvent
  'session.failed': SessionFailedEvent
  'session.branched': SessionBranchedEvent
  'workspace.idle': WorkspaceIdleEvent
}

export type SessionLifecycleEventType = keyof SessionLifecycleEventMap

export type SessionEventListener<K extends SessionLifecycleEventType> = (
  event: SessionLifecycleEventMap[K],
) => void

/**
 * Typed in-process bus. Not serializable, not persisted, not renderer-facing:
 * publish/subscribe only, inside one server process.
 */
export class SessionEventBus {
  private listenersByType = new Map<SessionLifecycleEventType, Set<(event: SessionLifecycleEvent) => void>>()

  /** Subscribe to one event type. Returns an idempotent unsubscribe function. */
  on<K extends SessionLifecycleEventType>(type: K, listener: SessionEventListener<K>): () => void {
    let listeners = this.listenersByType.get(type)
    if (!listeners) {
      listeners = new Set()
      this.listenersByType.set(type, listeners)
    }
    // Safe: the bus only ever delivers this type's payload to this listener.
    listeners.add(listener as (event: SessionLifecycleEvent) => void)
    return () => {
      this.off(type, listener)
    }
  }

  /** Unsubscribe a previously registered listener. Unknown types/listeners are ignored. */
  off<K extends SessionLifecycleEventType>(type: K, listener: SessionEventListener<K>): void {
    const listeners = this.listenersByType.get(type)
    if (!listeners) return
    listeners.delete(listener as (event: SessionLifecycleEvent) => void)
    if (listeners.size === 0) this.listenersByType.delete(type)
  }

  /**
   * Deliver one event. Never throws: a throwing listener is logged and the
   * remaining listeners still receive the event. Listener-gated so an unwired
   * (or partially wired) bus costs a single Map lookup.
   */
  emit<K extends SessionLifecycleEventType>(type: K, event: SessionLifecycleEventMap[K]): void {
    const listeners = this.listenersByType.get(type)
    if (!listeners || listeners.size === 0) return
    // Live Set iteration: a listener that unsubscribes itself is safe.
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (err) {
        busLog.warn(`listener for '${type}' threw (ignored)`, err)
      }
    }
  }

  /** Number of listeners registered for one event type. */
  listenerCount(type: SessionLifecycleEventType): number {
    return this.listenersByType.get(type)?.size ?? 0
  }
}

/**
 * Default bus until a consumer is wired. It is a plain bus with no listeners,
 * so every `emit` is dropped — `SessionManager` can publish unconditionally.
 * Never subscribe to this shared instance; use the manager's
 * `setSessionEventBus()` with your own bus instead.
 */
export const NOOP_SESSION_EVENT_BUS = new SessionEventBus()

/**
 * Cheap argument digest for {@link ToolCallEvent.argsSummary}.
 *
 * Nested payloads (file bodies, prompts) are never stringified — objects
 * collapse to `{…}` and arrays to `[n items]`, scalars are clipped — so this
 * stays negligible even for multi-megabyte tool inputs. Returns undefined for
 * empty or non-object input.
 */
export function summarizeToolArgs(input: unknown, maxLength = 400): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  const parts: string[] = []
  let length = 0
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    const value = record[key]
    if (value === undefined || value === null) continue
    let text: string
    if (typeof value === 'string') text = value.length > 64 ? `${value.slice(0, 64)}…` : value
    else if (Array.isArray(value)) text = `[${value.length} items]`
    else if (typeof value === 'object') text = '{…}'
    else text = String(value)
    const part = `${key}=${text}`
    if (length + part.length > maxLength) {
      parts.push('…')
      break
    }
    parts.push(part)
    length += part.length + 2
  }
  return parts.length > 0 ? parts.join(', ') : undefined
}