/**
 * W1-01 — Entity reference grammar.
 *
 * Canonical form: `<kind>:<id>[#<fragment>]`, e.g. `task:42`,
 * `goal:7#t-3`, `channel-message:chat-9#seq-128`.
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
  const id = head.slice(colonIndex + 1)
  const kind = normalizeKindAlias(rawKind)

  if (!isEntityKind(kind)) {
    return refError('unknown-kind', input, `unknown entity kind "${rawKind}"`)
  }
  if (id.length === 0) {
    return refError('empty-id', input, `reference "${kind}" is missing an id`)
  }
  if (rawFragment !== undefined && rawFragment.length === 0) {
    return refError('empty-fragment', input, 'reference fragment is empty')
  }

  return {
    ok: true,
    value: rawFragment === undefined ? { kind, id } : { kind, id, fragment: rawFragment },
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
  const base = `${ref.kind}:${ref.id}`
  return ref.fragment && ref.fragment.length > 0 ? `${base}#${ref.fragment}` : base
}

/** Structural equality on the canonical fields. */
export function entityRefEquals(a: EntityRef, b: EntityRef): boolean {
  return a.kind === b.kind && a.id === b.id && (a.fragment ?? '') === (b.fragment ?? '')
}

/** Stable map/list key for a ref (canonical literal). */
export function entityRefKey(ref: EntityRef): string {
  return formatEntityRef(ref)
}