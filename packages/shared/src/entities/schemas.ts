/**
 * W1-02 — Zod validation for entity links and preview transport.
 *
 * Lives in `@rox/shared` (which already depends on zod) so the dependency-free
 * `@rox/core` stays clean; the domain types come from `@rox/core/entities`.
 */

import { z } from 'zod'
import {
  isEntityKind,
  isEntityRelation,
  type EntityKind,
  type EntityLink,
  type EntityRef,
  type EntityRelation,
} from '@rox/core/entities'

export const entityKindSchema = z
  .string()
  .refine(isEntityKind, { message: 'unknown entity kind' })
  .transform(value => value as EntityKind)

export const entityRelationSchema = z
  .string()
  .refine(isEntityRelation, { message: 'unknown entity relation' })
  .transform(value => value as EntityRelation)

export const entityRefSchema: z.ZodType<EntityRef> = z.object({
  kind: entityKindSchema,
  id: z.string().min(1),
  fragment: z.string().min(1).optional(),
})

export const entityLinkAnchorSchema = z.object({
  blockId: z.string().min(1).optional(),
  seq: z.number().int().nonnegative().optional(),
  line: z.number().int().nonnegative().optional(),
  targetId: z.string().min(1).optional(),
})

export const entityLinkSchema: z.ZodType<EntityLink> = z.object({
  linkId: z.string().min(1),
  from: entityRefSchema,
  to: entityRefSchema,
  relation: entityRelationSchema,
  role: z.string().min(1).optional(),
  anchor: entityLinkAnchorSchema.optional(),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  revision: z.number().int().nonnegative(),
})

export const entityResolveRequestSchema = z.object({
  refs: z.array(entityRefSchema).max(500),
})

export const entityLinksAddRequestSchema = z.object({
  from: entityRefSchema,
  to: entityRefSchema,
  relation: entityRelationSchema,
  role: z.string().min(1).optional(),
  anchor: entityLinkAnchorSchema.optional(),
})

export const entityLinksRemoveRequestSchema = z.object({
  from: entityRefSchema,
  to: entityRefSchema,
  relation: entityRelationSchema,
})

export const entityLinksOutgoingRequestSchema = z.object({
  ref: entityRefSchema,
})

export const entityLinksBacklinksRequestSchema = z.object({
  ref: entityRefSchema,
  kinds: z.array(entityKindSchema).max(64).optional(),
  relations: z.array(entityRelationSchema).max(64).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().positive().max(1000).optional(),
})

/** Body of the `entities:links` RPC: a single discriminated operation. */
export const entityLinksRequestSchema = z.discriminatedUnion('op', [
  entityLinksAddRequestSchema.extend({ op: z.literal('add') }),
  entityLinksRemoveRequestSchema.extend({ op: z.literal('remove') }),
  entityLinksOutgoingRequestSchema.extend({ op: z.literal('outgoing') }),
  entityLinksBacklinksRequestSchema.extend({ op: z.literal('backlinks') }),
])

export type EntityResolveRequest = z.infer<typeof entityResolveRequestSchema>
export type EntityLinksAddRequest = z.infer<typeof entityLinksAddRequestSchema>
export type EntityLinksRemoveRequest = z.infer<typeof entityLinksRemoveRequestSchema>
export type EntityLinksOutgoingRequest = z.infer<typeof entityLinksOutgoingRequestSchema>
export type EntityLinksBacklinksRequest = z.infer<typeof entityLinksBacklinksRequestSchema>
export type EntityLinksRequest = z.infer<typeof entityLinksRequestSchema>