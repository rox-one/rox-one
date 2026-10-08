/**
 * W1-03 (#1500) — Command envelope (TECH-SPEC §3.4, §12, §18.2).
 *
 * Every mutation in the unified suite is a command routed by authority: local
 * refs go to the server-core handler, workspace refs are queued in the client
 * outbox and sent to `POST /v1/workspaces/{ws}/commands` (TECH-SPEC §1 rule 1).
 *
 * `@rox/core` stays dependency-free: zod schemas for the envelope live in
 * `@rox/shared/commands/schemas`; this file holds the types plus the small
 * structural helpers both sides share (limits, canonical request form).
 */

import type { EntityRef } from '../entities/refs.ts'

/** `<module>.<operation>`, e.g. `tasks.update_status`, `system.ping`. */
export type CommandType = `${string}.${string}`

/** Lower-case dotted name: at least one dot, segments `[a-z][a-z0-9_]*`. */
export const COMMAND_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/

export function isCommandType(value: unknown): value is CommandType {
  return typeof value === 'string' && value.length <= 128 && COMMAND_TYPE_PATTERN.test(value)
}

/** Max length of `commandId` / `idempotencyKey` (mirrors `command_receipt` DDL, 05-events). */
export const MAX_COMMAND_ID_LENGTH = 256

/** Default byte budget for a serialised payload; a definition may lower or raise it. */
export const DEFAULT_MAX_COMMAND_PAYLOAD_BYTES = 64 * 1024

/** Hard ceiling for any definition's payload budget. */
export const MAX_COMMAND_PAYLOAD_BYTES = 1024 * 1024

/** Where a command came from (TECH-SPEC §12 `Origin`, §18.2 agent panel). */
export type CommandOrigin =
  /** `derived-from` entity (TECH-SPEC §3.4). */
  | EntityRef
  | { kind: 'doc-block'; docRef: string; blockId: string; anchor?: unknown }
  | { kind: 'message'; chatRef: string; seq: number; threadRootSeq?: number }
  | { kind: 'comment'; commentId: string }
  | { kind: 'agent'; sessionRef: string; messageRef?: string }
  /** TECH-SPEC §18.2: proposals from the agent panel. */
  | { kind: 'agent-panel'; sessionId: string; messageId?: string; surface?: string }

/** Routing hint for `by-target` commands whose target does not decide the authority. */
export type CommandAuthorityHint = 'local' | 'workspace'

export interface CommandEnvelope<P = unknown> {
  /** Client-generated unique id; also the default idempotency key. */
  commandId: string
  /** Dedupe key for `command_receipt` (same key → one effect). */
  idempotencyKey: string
  type: CommandType
  /** The entity the command acts on (decides `by-target` authority and ACL). */
  target?: EntityRef
  /** Optimistic-concurrency precondition; a mismatch yields a `conflict` receipt. */
  expectedRevision?: number
  payload: P
  /** ISO-8601 timestamp set by the issuing client. */
  issuedAt: string
  origin?: CommandOrigin
  authorityHint?: CommandAuthorityHint
  /** Correlates follow-up commands/events (rule engine, batches). Defaults to `commandId`. */
  correlationId?: string
  /** AI path (TECH-SPEC §3.4): actor = user, onBehalfOf = bot principal. */
  onBehalfOf?: string
}

function randomId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  // Fallback for exotic runtimes; not used by Bun/Node/Electron.
  return 'cmd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}

export interface CreateCommandEnvelopeOptions {
  commandId?: string
  idempotencyKey?: string
  target?: EntityRef
  expectedRevision?: number
  origin?: CommandOrigin
  authorityHint?: CommandAuthorityHint
  correlationId?: string
  onBehalfOf?: string
  now?: () => Date
}

/** Typed client helper: a fresh envelope with `idempotencyKey` defaulting to `commandId`. */
export function createCommandEnvelope<P>(type: CommandType, payload: P, options: CreateCommandEnvelopeOptions = {}): CommandEnvelope<P> {
  const commandId = options.commandId ?? randomId()
  const envelope: CommandEnvelope<P> = {
    commandId,
    idempotencyKey: options.idempotencyKey ?? commandId,
    type,
    payload,
    issuedAt: (options.now?.() ?? new Date()).toISOString(),
  }
  if (options.target) envelope.target = options.target
  if (options.expectedRevision !== undefined) envelope.expectedRevision = options.expectedRevision
  if (options.origin) envelope.origin = options.origin
  if (options.authorityHint) envelope.authorityHint = options.authorityHint
  if (options.correlationId) envelope.correlationId = options.correlationId
  if (options.onBehalfOf) envelope.onBehalfOf = options.onBehalfOf
  return envelope
}

/** UTF-8 byte length of the JSON-serialised payload; `Infinity` when it cannot be serialised. */
export function payloadByteLength(payload: unknown): number {
  let json: string | undefined
  try { json = JSON.stringify(payload) } catch { return Number.POSITIVE_INFINITY }
  if (json === undefined) return Number.POSITIVE_INFINITY
  return new TextEncoder().encode(json).length
}

/** Deterministic JSON (object keys sorted recursively); `undefined` members are dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const member = (value as Record<string, unknown>)[key]
      if (member !== undefined) out[key] = sortKeys(member)
    }
    return out
  }
  return value
}

/**
 * The request identity hashed into `command_receipt.request_hash`: the parts
 * that determine the effect. Reusing an idempotency key with a different
 * canonical request is rejected (`IDEMPOTENCY_KEY_REUSED`), never applied.
 */
export function canonicalCommandRequest(envelope: Pick<CommandEnvelope, 'type' | 'target' | 'expectedRevision' | 'payload' | 'onBehalfOf'>): string {
  return canonicalJson({
    type: envelope.type,
    target: envelope.target ?? null,
    expectedRevision: envelope.expectedRevision ?? null,
    payload: envelope.payload ?? null,
    onBehalfOf: envelope.onBehalfOf ?? null,
  })
}
