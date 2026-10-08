/**
 * W1-02 — Entity links domain model.
 *
 * `EntityLink` is the local link-store record; the 12 relations extend the
 * frozen `ROX2_RELATION_KINDS` (first 8) with 4 unified-shell relations.
 * Zod validation lives in `@rox/shared/entities` (this package is
 * dependency-free); this module owns the types, constants and dedupe rule.
 */

import { ROX2_RELATION_KINDS } from '../rox2/platform-contract.ts'
import type { EntityRef } from './refs.ts'

export { ROX2_RELATION_KINDS }

/** Relations added on top of the frozen Rox2 set. */
export const NEW_ENTITY_RELATIONS = ['embeds', 'relates-to', 'aligned-to', 'resource-of'] as const

/** All 12 link relations. */
export const ENTITY_RELATIONS = [...ROX2_RELATION_KINDS, ...NEW_ENTITY_RELATIONS] as const

export type EntityRelation = (typeof ENTITY_RELATIONS)[number]

/** Alias kept for the frozen subset name used across the codebase. */
export const ROX2_RELATIONS = ROX2_RELATION_KINDS

export function isEntityRelation(value: string): value is EntityRelation {
  return (ENTITY_RELATIONS as readonly string[]).includes(value)
}

/**
 * Where in the source entity the link originates. Container-relative kinds
 * use `blockId` (TipTap block) or `seq` (channel message sequence); structured
 * kinds may point at a `targetId` column.
 */
export interface EntityLinkAnchor {
  blockId?: string
  seq?: number
  line?: number
  targetId?: string
}

export interface EntityLink {
  linkId: string
  from: EntityRef
  to: EntityRef
  relation: EntityRelation
  /** Optional sub-role (e.g. `assignee` vs `reviewer` for `assigned`). */
  role?: string
  anchor?: EntityLinkAnchor
  createdBy: string
  createdAt: string
  revision: number
}

/** Bump when the persisted link shape changes. */
export const ENTITY_LINK_SCHEMA_VERSION = 1

/**
 * Dedupe identity: a link is unique per `(from, relation, to)` regardless of
 * role/anchor. Used by the store to upsert instead of duplicating.
 */
export function entityLinkDedupeKey(link: Pick<EntityLink, 'from' | 'relation' | 'to'>): string {
  return `${link.from.kind}:${link.from.id}#${link.from.fragment ?? ''}|${link.relation}|${link.to.kind}:${link.to.id}#${link.to.fragment ?? ''}`
}