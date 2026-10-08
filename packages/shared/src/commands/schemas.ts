/**
 * W1-03 (#1500) — Zod validation for the command bus wire format.
 *
 * `@rox/core/commands` holds the types; this file validates untrusted input
 * (RPC args, the workspace HTTP body, realtime subscribe requests). Lives in
 * `@rox/shared`, which already depends on zod.
 */

import { z } from 'zod'
import {
  COMMAND_ERROR_CODES,
  COMMAND_RECEIPT_STATUSES,
  MAX_COMMAND_ID_LENGTH,
  isCommandType,
  type CommandEnvelope,
  type CommandReceipt,
  type CommandType,
} from '@rox/core/commands'
import { MAX_SUBSCRIBE_TOPICS, normalizeTopic, type RealtimeSubscribeRequest } from '@rox/core/events'
import { entityRefSchema } from '../entities/schemas'

/** Ids, keys and correlation ids: no NUL / C0 / DEL control characters (Postgres text rejects NUL). */
const idSchema = z.string().min(1).max(MAX_COMMAND_ID_LENGTH).refine(value => !/[\u0000-\u001f\u007f]/.test(value), { message: 'control characters are not allowed' })

/** Revisions must stay exact in JS numbers and in Postgres bigint. */
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

function unstorableString(value: string): string | null {
  if (value.includes('\u0000')) return 'NUL characters are not allowed'
  if (LONE_SURROGATE.test(value)) return 'unpaired UTF-16 surrogates are not allowed'
  return null
}

/**
 * Text Postgres `text` / `jsonb` cannot store: NUL (`\u0000`, 22P05 / 22021)
 * and unpaired surrogates, in any string or object key of the envelope.
 * Rejected as VALIDATION up front instead of failing deterministically in
 * the store. Iterative (explicit stack), so deep nesting cannot overflow.
 */
export function findUnstorableText(value: unknown): string | null {
  const stack: unknown[] = [value]
  const seen = new Set<object>()
  while (stack.length > 0) {
    const current = stack.pop()
    if (typeof current === 'string') {
      const found = unstorableString(current)
      if (found) return found
      continue
    }
    if (current === null || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    if (Array.isArray(current)) { for (const item of current) stack.push(item); continue }
    for (const [key, item] of Object.entries(current)) {
      const found = unstorableString(key)
      if (found) return found
      stack.push(item)
    }
  }
  return null
}

export const commandTypeSchema = z
  .string()
  .refine(isCommandType, { message: 'invalid command type' })
  .transform(value => value as CommandType)

const originSchema = z.union([
  entityRefSchema,
  z.object({ kind: z.literal('doc-block'), docRef: z.string().min(1).max(512), blockId: z.string().min(1).max(256), anchor: z.unknown().optional() }).strict(),
  z.object({ kind: z.literal('message'), chatRef: z.string().min(1).max(512), seq: z.number().int().nonnegative(), threadRootSeq: z.number().int().nonnegative().optional() }).strict(),
  z.object({ kind: z.literal('comment'), commentId: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('agent'), sessionRef: z.string().min(1).max(512), messageRef: z.string().min(1).max(512).optional() }).strict(),
  z.object({ kind: z.literal('agent-panel'), sessionId: z.string().min(1).max(256), messageId: z.string().min(1).max(256).optional(), surface: z.string().min(1).max(128).optional() }).strict(),
])

/**
 * Wire envelope. `idempotencyKey` may be omitted (defaults to `commandId`);
 * unknown members are rejected so a caller cannot smuggle actor/workspace
 * fields — those always come from the authenticated session.
 */
export const commandEnvelopeSchema = z
  .object({
    commandId: idSchema,
    idempotencyKey: idSchema.optional(),
    type: commandTypeSchema,
    target: entityRefSchema.optional(),
    expectedRevision: revisionSchema.optional(),
    payload: z.unknown(),
    issuedAt: z.string().min(1).max(64).refine(value => !Number.isNaN(Date.parse(value)), { message: 'issuedAt must be an ISO timestamp' }),
    origin: originSchema.optional(),
    authorityHint: z.enum(['local', 'workspace']).optional(),
    correlationId: idSchema.optional(),
    onBehalfOf: idSchema.optional(),
  })
  .strict()
  .transform(value => {
    const envelope: CommandEnvelope = {
      commandId: value.commandId,
      idempotencyKey: value.idempotencyKey ?? value.commandId,
      type: value.type,
      payload: value.payload,
      issuedAt: value.issuedAt,
    }
    if (value.target) envelope.target = value.target
    if (value.expectedRevision !== undefined) envelope.expectedRevision = value.expectedRevision
    if (value.origin) envelope.origin = value.origin as CommandEnvelope['origin']
    if (value.authorityHint) envelope.authorityHint = value.authorityHint
    if (value.correlationId) envelope.correlationId = value.correlationId
    if (value.onBehalfOf) envelope.onBehalfOf = value.onBehalfOf
    return envelope
  })

export type DecodeResult<T> = { ok: true; value: T } | { ok: false; message: string; issues: string[] }

function decode<T>(schema: z.ZodType<T>, input: unknown): DecodeResult<T> {
  const parsed = schema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issues = parsed.error.issues.slice(0, 10).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
  return { ok: false, message: issues[0] ?? 'invalid input', issues }
}

/** Decode an untrusted envelope; `payload` is validated later against the command's schema. */
export function decodeCommandEnvelope(input: unknown): DecodeResult<CommandEnvelope> {
  const decoded = decode(commandEnvelopeSchema as unknown as z.ZodType<CommandEnvelope>, input)
  if (!decoded.ok) return decoded
  const unstorable = findUnstorableText(input)
  if (unstorable) return { ok: false, message: unstorable, issues: [`(envelope): ${unstorable}`] }
  return decoded
}

const receiptErrorSchema = z.object({
  code: z.enum(COMMAND_ERROR_CODES),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
})

const baseReceiptSchema = z.object({
  commandId: idSchema,
  status: z.enum(COMMAND_RECEIPT_STATUSES),
  ref: entityRefSchema.optional(),
  revision: revisionSchema.optional(),
  eventIds: z.array(z.string().min(1)).optional(),
  result: z.unknown().optional(),
  conflict: z.object({ currentRevision: revisionSchema, current: z.unknown().optional() }).optional(),
  error: receiptErrorSchema.optional(),
  queuedAt: z.string().optional(),
})

/** Receipts coming back from a workspace authority (client side). */
export const commandReceiptSchema: z.ZodType<CommandReceipt> = baseReceiptSchema.extend({
  original: baseReceiptSchema.optional(),
}) as unknown as z.ZodType<CommandReceipt>

export function decodeCommandReceipt(input: unknown): DecodeResult<CommandReceipt> {
  return decode(commandReceiptSchema, input)
}

const topicSchema = z
  .string()
  .max(512)
  .refine(value => normalizeTopic(value) !== null, { message: 'invalid topic' })

export const realtimeSubscribeRequestSchema = z
  .object({
    topics: z
      .array(
        z
          .object({
            topic: z.string().max(512),
            sinceSeq: z.number().int().nonnegative().optional(),
            epoch: z.string().min(1).max(128).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_SUBSCRIBE_TOPICS),
    resume: z.boolean().optional(),
  })
  .strict()

/**
 * Decode a subscribe request. Individual malformed topic names are NOT a
 * request-level error: the gateway answers them per topic with `invalid`.
 */
export function decodeRealtimeSubscribeRequest(input: unknown): DecodeResult<RealtimeSubscribeRequest> {
  return decode(realtimeSubscribeRequestSchema as unknown as z.ZodType<RealtimeSubscribeRequest>, input)
}

export const realtimeUnsubscribeRequestSchema = z.object({ topics: z.array(topicSchema).min(1).max(MAX_SUBSCRIBE_TOPICS) }).strict()

export function decodeRealtimeUnsubscribeRequest(input: unknown): DecodeResult<{ topics: string[] }> {
  return decode(realtimeUnsubscribeRequestSchema, input)
}
