/**
 * W1-01 — Entity reference grammar.
 *
 * Canonical form: `<kind>:<id>[#<fragment>]`, e.g. `task:42`,
 * `goal-target:g1#3`, `channel-message:c1#128`.
 *
 * Only container-relative kinds take a fragment (channel-message,
 * goal-target, goal-check, kpi, task-section, wiki-space, base-table,
 * base-view, base-record); other kinds reject fragments so one entity has
 * one encoding. Route prefixes (`t-`, `k-`, `seq-`) are normalised away on
 * parse: `goal-target:g1#t-3` reads as fragment `3`.
 *
 * Unlike `parseRox2EntityId` (frozen, throws), `parseEntityRef` is total and
 * returns a `Result` so callers can render an "unavailable" chip instead of
 * unwinding. `formatEntityRef` keeps the throwing contract of
 * `formatRox2EntityId` for the id-empty case.
 */

import { isEntityKind, type EntityKind } from './kinds.ts'
import { normalizeKindAlias } from './aliases.ts'

export interface EntityRef {
  kind: EntityKind
  id: string
  /** Optional addressable sub-part (block, message seq, table column, …). */
  fragment?: string
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export type RefErrorCode =
  | 'empty'
  | 'missing-kind'
  | 'unknown-kind'
  | 'empty-id'
  | 'empty-fragment'
  | 'unexpected-fragment'

export interface RefError {
  code: RefErrorCode
  message: string
  input: string
}

const refError = (code: RefErrorCode, input: string, message: string): Result<EntityRef, RefError> => ({
  ok: false,
  error: { code, message, input },
})

/**
 * Kinds whose route builders read the child from `ref.fragment`
 * (see `./routes.ts`). All other kinds reject fragments so one entity has
 * one encoding.
 */
export const ENTITY_FRAGMENT_KINDS: ReadonlySet<EntityKind> = new Set([
  'channel-message',
  'goal-target',
  'goal-check',
  'kpi',
  'task-section',
  'wiki-space',
  'base-table',
  'base-view',
  'base-record',
] as const as EntityKind[])

/** True when `kind` may carry a fragment. */
export function kindTakesFragment(kind: EntityKind): boolean {
  return ENTITY_FRAGMENT_KINDS.has(kind)
}

/** Percent-encode `#` and `%` so ids round-trip through `kind:id#fragment`. */
function encodeRefPart(value: string): string {
  return value.replace(/%/g, '%25').replace(/#/g, '%23')
}

/** Decode the `%23`/`%25` escapes written by `encodeRefPart`. */
function decodeRefPart(value: string): string {
  return value.replace(/%23/g, '#').replace(/%25/g, '%')
}

/**
 * Strip route-level prefixes so `goal-target:g1#t-3`,
 * `goal-check:g1#k-7` and `channel-message:c1#seq-128` normalise to the
 * canonical fragments `3`, `7` and `128`.
 *
 * Exported for the Zod schema layer (`@rox/shared/entities`), which must
 * canonicalise the same prefixes `parseEntityRef` strips so RPC `add` can
 * never store a second encoding (`#t-t-3`).
 */
export function normalizeEntityFragment(kind: EntityKind, fragment: string): string {
  if (kind === 'goal-target' && fragment.startsWith('t-') && fragment.length > 2) {
    return fragment.slice(2)
  }
  if (kind === 'goal-check' && fragment.startsWith('k-') && fragment.length > 2) {
    return fragment.slice(2)
  }
  if (kind === 'channel-message' && fragment.startsWith('seq-') && fragment.length > 4) {
    return fragment.slice(4)
  }
  return fragment
}

/**
 * Parse a reference literal. Never throws: malformed input yields
 * `{ ok: false }` with a machine-readable `RefError`.
 */
export function parseEntityRef(input: string): Result<EntityRef, RefError> {
  if (typeof input !== 'string' || input.length === 0) {
    return refError('empty', String(input ?? ''), 'empty reference')
  }

  const hashIndex = input.indexOf('#')
  const head = hashIndex === -1 ? input : input.slice(0, hashIndex)
  const rawFragment = hashIndex === -1 ? undefined : input.slice(hashIndex + 1)

  const colonIndex = head.indexOf(':')
  if (colonIndex <= 0) {
    return refError('missing-kind', input, 'reference must be "<kind>:<id>"')
  }

  const rawKind = head.slice(0, colonIndex)
  const rawId = head.slice(colonIndex + 1)
  const kind = normalizeKindAlias(rawKind)

  if (!isEntityKind(kind)) {
    return refError('unknown-kind', input, `unknown entity kind "${rawKind}"`)
  }
  if (rawId.length === 0) {
    return refError('empty-id', input, `reference "${kind}" is missing an id`)
  }
  if (rawFragment !== undefined && rawFragment.length === 0) {
    return refError('empty-fragment', input, 'reference fragment is empty')
  }
  if (rawFragment !== undefined && !kindTakesFragment(kind as EntityKind)) {
    return refError('unexpected-fragment', input, `kind "${kind}" does not take a fragment`)
  }

  const id = decodeRefPart(rawId)
  if (id.length === 0) {
    return refError('empty-id', input, `reference "${kind}" is missing an id`)
  }
  if (rawFragment === undefined) {
    return { ok: true, value: { kind: kind as EntityKind, id } }
  }
  const fragment = normalizeEntityFragment(kind as EntityKind, decodeRefPart(rawFragment))
  if (fragment.length === 0) {
    return refError('empty-fragment', input, 'reference fragment is empty')
  }

  return {
    ok: true,
    value: { kind: kind as EntityKind, id, fragment },
  }
}

/** Thrown by `formatEntityRef` on an invalid ref; mirrors `formatRox2EntityId`. */
export class EntityRefFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EntityRefFormatError'
  }
}

/** Format a ref back to its canonical literal. Throws on empty kind/id. */
export function formatEntityRef(ref: EntityRef): string {
  if (ref.id.length === 0) {
    throw new EntityRefFormatError(`Cannot format entity ref "${ref.kind}" with an empty id`)
  }
  const base = `${ref.kind}:${encodeRefPart(ref.id)}`
  return ref.fragment && ref.fragment.length > 0 ? `${base}#${encodeRefPart(ref.fragment)}` : base
}

/** Structural equality on the canonical fields. */
export function entityRefEquals(a: EntityRef, b: EntityRef): boolean {
  return a.kind === b.kind && a.id === b.id && (a.fragment ?? '') === (b.fragment ?? '')
}

/** Stable map/list key for a ref (canonical literal). */
export function entityRefKey(ref: EntityRef): string {
  return formatEntityRef(ref)
}