/**
 * W1-06 (#1503) — Reader for the Rox frontmatter keys of a Markdown note
 * (DATA-MODEL §5.2): `rox_id`, `rox_authority: local|workspace`,
 * `rox_doc_id`, `rox_subtype` (default `doc`).
 *
 * Read-only and conservative: it reuses the retained-source frontmatter
 * projection (no YAML re-stringify). A note without the keys, or whose
 * frontmatter cannot be read, is `local` — only an explicit
 * `rox_authority: workspace` marks the file as the read-only mirror of a
 * shared doc (the notes save guard `AUTHORITY_MOVED` builds on this).
 */

import { projectFrontmatter } from './frontmatter-patches.ts'
import { retainSource } from './retained-source.ts'

export type RoxAuthority = 'local' | 'workspace'
export const ROX_AUTHORITIES: readonly RoxAuthority[] = ['local', 'workspace']
export const ROX_FRONTMATTER_KEYS = ['rox_id', 'rox_authority', 'rox_doc_id', 'rox_subtype'] as const

export interface RoxFrontmatter {
  authority: RoxAuthority
  /** `ok`: keys read (or absent); `invalid`: a rox_* value is not a usable string; `unreadable`: frontmatter did not parse. */
  status: 'ok' | 'invalid' | 'unreadable'
  roxId?: string
  docId?: string
  subtype: string
  /** True only when the file explicitly says `rox_authority: workspace`. */
  readOnlyMirror: boolean
}

const LOCAL: RoxFrontmatter = { authority: 'local', status: 'ok', subtype: 'doc', readOnlyMirror: false }

export function readRoxFrontmatter(markdown: string | Uint8Array): RoxFrontmatter {
  const projection = projectFrontmatter(retainSource(markdown))
  if (projection.status !== 'ok') return { ...LOCAL, status: 'unreadable' }
  const values = new Map<string, unknown>()
  for (const property of projection.properties) {
    if (property.keyPath.length === 1 && (ROX_FRONTMATTER_KEYS as readonly string[]).includes(property.keyPath[0]!)) values.set(property.keyPath[0]!, property.value)
  }
  let status: RoxFrontmatter['status'] = 'ok'
  const text = (key: string): string | undefined => {
    if (!values.has(key)) return undefined
    const value = values.get(key)
    if (typeof value === 'string' && value.trim() && value.length <= 256) return value.trim()
    status = 'invalid'
    return undefined
  }
  const rawAuthority = text('rox_authority')
  if (rawAuthority !== undefined && !(ROX_AUTHORITIES as readonly string[]).includes(rawAuthority)) status = 'invalid'
  const authority: RoxAuthority = rawAuthority === 'workspace' ? 'workspace' : 'local'
  const roxId = text('rox_id')
  const docId = text('rox_doc_id')
  const subtype = text('rox_subtype') ?? 'doc'
  return { authority, status, subtype, readOnlyMirror: authority === 'workspace', ...(roxId ? { roxId } : {}), ...(docId ? { docId } : {}) }
}

/** Shorthand for guards: `workspace` only for an explicit, well-formed stamp. */
export function readRoxAuthority(markdown: string | Uint8Array): RoxAuthority {
  return readRoxFrontmatter(markdown).authority
}
