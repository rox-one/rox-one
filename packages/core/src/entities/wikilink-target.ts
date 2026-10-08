/**
 * W1-02 / W1-08 — Shared wikilink target classifier.
 *
 * One rule set for every surface that turns `[[…]]` / `![[…]]` into refs:
 * the server-side link extractor (`server-core/src/entities/extract.ts`)
 * and the editor's mention/embed nodes (`@rox/ui` entity-markdown). Keeping
 * it here means the editor and the link index always agree on whether a
 * target is an explicit entity ref or a plain note title.
 *
 * Approved #1499 rules:
 * - A direct entity literal wins (kind aliases like `doc:hello` included).
 * - `unexpected-fragment` re-parses the part before `#`, so
 *   `[[note:abc#Heading]]` links to `note:abc`.
 * - A `prefix:` that is not a known kind, or an id with leading whitespace,
 *   makes the whole target a plain note title (`[[Встреча: итоги]]`,
 *   `[[note: итоги]]`). Nothing is trimmed silently.
 * - A colon-less target is a note title (`[[My note]]`).
 *
 * Callers pass the inner target (between `[[` and `|`/`]]`), already
 * trimmed of outer whitespace.
 */

import { normalizeKindAlias } from './aliases.ts'
import { isEntityKind } from './kinds.ts'
import { parseEntityRef, type EntityRef } from './refs.ts'

export type WikilinkTargetClass =
  /** Explicit entity syntax: `[[kind:id]]` with a known kind. */
  | { type: 'entity'; ref: EntityRef }
  /** Plain note title; `ref` is the `note` ref the link index records. */
  | { type: 'title'; ref: EntityRef }

export function classifyWikilinkTarget(inner: string): WikilinkTargetClass | null {
  if (!inner) return null
  const hashIndex = inner.indexOf('#')
  const head = hashIndex === -1 ? inner : inner.slice(0, hashIndex)
  const colonIndex = head.indexOf(':')
  if (colonIndex <= 0) {
    const title = head.trim()
    if (!title || title.includes(':')) return null
    return { type: 'title', ref: { kind: 'note', id: title } }
  }
  const rawKind = head.slice(0, colonIndex)
  const rawId = head.slice(colonIndex + 1)
  if (rawId.length > 0 && /^\s/.test(rawId)) return { type: 'title', ref: { kind: 'note', id: inner } }
  if (!isEntityKind(normalizeKindAlias(rawKind))) return { type: 'title', ref: { kind: 'note', id: inner } }
  const direct = parseEntityRef(inner)
  if (direct.ok) return { type: 'entity', ref: direct.value }
  if (direct.error.code === 'unexpected-fragment') {
    const reparsed = parseEntityRef(head)
    if (reparsed.ok) return { type: 'entity', ref: reparsed.value }
  }
  return null
}

/** The explicit entity ref for a wikilink target, or null (note titles included). */
export function explicitEntityRefFromWikilinkTarget(inner: string): EntityRef | null {
  const classified = classifyWikilinkTarget(inner)
  return classified?.type === 'entity' ? classified.ref : null
}
