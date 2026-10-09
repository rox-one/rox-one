/**
 * W1-06 (#1503) — Shared zod building blocks for the domain command schemas.
 *
 * Domain schemas live in `@rox/shared/domain` (not `@rox/core/<module>`) for
 * the same reason as `@rox/shared/commands/schemas` and
 * `@rox/shared/entities/schemas`: `@rox/core` stays dependency-free and
 * binds them through the structural `SchemaLike` contract.
 *
 * Conventions (every module file follows them):
 * - The envelope `target` names the entity a command acts on; payloads carry
 *   only the change. Creates accept an optional client id (`id`).
 * - Payloads are strict objects: unknown members are a VALIDATION rejection.
 * - Dates are ISO-8601 (`YYYY-MM-DD` for calendar dates, full timestamps
 *   with offset otherwise); rich text is ProseMirror JSON or Markdown.
 */

import { z } from 'zod'
import { entityRefSchema, entityRelationSchema } from '../entities/schemas'

const CONTROL = /[\u0000-\u001f\u007f]/

/** Opaque id (uuid on the server, legacy string ids locally). */
export const idSchema = z.string().min(1).max(256).refine(value => !CONTROL.test(value), { message: 'control characters are not allowed' })
export const principalIdSchema = idSchema
export const refSchema = entityRefSchema
export const relationSchema = entityRelationSchema
export const isoDateSchema = z.iso.date()
export const isoDateTimeSchema = z.iso.datetime({ offset: true })
export const titleSchema = z.string().trim().min(1).max(500)
export const nameSchema = z.string().trim().min(1).max(200)
export const shortTextSchema = z.string().max(2000)
export const longTextSchema = z.string().max(200_000)
export const sortKeySchema = z.string().min(1).max(64)
export const colorSchema = z.string().min(1).max(32)
export const emojiSchema = z.string().min(1).max(64)
export const urlSchema = z.url().max(4096)
export const emailSchema = z.email().max(320)
export const timeZoneSchema = z.string().min(1).max(64)
/** ProseMirror JSON document or Markdown text. */
export const richTextSchema = z.union([longTextSchema, z.record(z.string(), z.unknown())])
export const jsonObjectSchema = z.record(z.string(), z.unknown())
export const duePrecisionSchema = z.enum(['day', 'month', 'quarter', 'year'])
export const idListSchema = z.array(idSchema).max(500)
export const principalListSchema = z.array(principalIdSchema).max(500)

/** Strict command payload object. */
export function cmd<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict()
}

/** Payload of a command that takes no input beyond its target. */
export const emptyPayload = cmd({})

/** System fields every stored entity carries (DATA-MODEL §1 conventions). */
export const entitySystemShape = {
  id: idSchema,
  revision: z.number().int().nonnegative(),
  authority: z.enum(['local', 'workspace', 'external']),
  workspaceId: idSchema.optional(),
  schemaVersion: z.number().int().positive().optional(),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
  deletedAt: isoDateTimeSchema.optional(),
}

/** Entity shape = its fields + system fields (unknown members tolerated on read). */
export function entity<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...entitySystemShape, ...shape })
}

/** `[optional client id]` member for create payloads. */
export const createIdShape = { id: idSchema.optional() }

export type CommandSchemaMap = Readonly<Record<string, z.ZodType>>
