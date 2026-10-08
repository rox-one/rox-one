/**
 * W1-08 (#1505) — Markdown serialisation for entity mentions and embeds.
 *
 * TECH-SPEC §3.9: mention → `[[kind:id|label]]`, embed → `![[kind:id]]`.
 * The syntax is wiki-link compatible, so the vault indexer and the link
 * extractor in `server-core/src/entities/extract.ts` record the refs.
 *
 * Only *explicit* syntax becomes a node: the inner target must parse as an
 * entity ref (`parseEntityRef`). Plain wikilinks (`[[My note]]`) and bare
 * `kind:id` prose are left untouched (explicit-syntax-only policy).
 */
import { formatEntityRef, parseEntityRef, type EntityRef } from '@rox/core/entities'

export const ENTITY_MENTION_NODE = 'mention'
export const ENTITY_EMBED_NODE = 'entityEmbed'

/** `[[target|label]]` (not preceded by `!`). */
const MENTION_SOURCE = /^\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/
/** `![[target]]` / `![[target|label]]`. */
const EMBED_SOURCE = /^!\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/

/** Canonical ref literal for a target, or null when it is not an entity ref. */
export function canonicalEntityTarget(target: string): string | null {
  const parsed = parseEntityRef(target.trim())
  return parsed.ok ? formatEntityRef(parsed.value) : null
}

export function entityRefFromTarget(target: string): EntityRef | null {
  const parsed = parseEntityRef(target.trim())
  return parsed.ok ? parsed.value : null
}

/** Labels cannot contain `]` or newlines inside `[[…|label]]`. */
export function sanitizeMentionLabel(label: string): string {
  return label.replace(/[\]\n\r]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function serializeEntityMention(ref: string, label?: string | null): string {
  const canonical = canonicalEntityTarget(ref) ?? ref
  const clean = label ? sanitizeMentionLabel(label) : ''
  return clean ? `[[${canonical}|${clean}]]` : `[[${canonical}]]`
}

export function serializeEntityEmbed(ref: string): string {
  return `![[${canonicalEntityTarget(ref) ?? ref}]]`
}

export interface EntityMentionMatch {
  raw: string
  ref: string
  label: string | null
}

/** Match an entity mention at the start of `src` (null for plain wikilinks). */
export function matchEntityMention(src: string): EntityMentionMatch | null {
  const m = MENTION_SOURCE.exec(src)
  if (!m) return null
  const ref = canonicalEntityTarget(m[1] ?? '')
  if (!ref) return null
  const label = m[2] !== undefined ? sanitizeMentionLabel(m[2]) : ''
  return { raw: m[0], ref, label: label || null }
}

/** Match an entity embed at the start of `src`. */
export function matchEntityEmbed(src: string): EntityMentionMatch | null {
  const m = EMBED_SOURCE.exec(src)
  if (!m) return null
  const ref = canonicalEntityTarget(m[1] ?? '')
  if (!ref) return null
  const label = m[2] !== undefined ? sanitizeMentionLabel(m[2]) : ''
  return { raw: m[0], ref, label: label || null }
}

// ---------------------------------------------------------------------------
// markdown-it plugin (legacy `tiptap-markdown` engine)
// ---------------------------------------------------------------------------

interface InlineState {
  src: string
  pos: number
  posMax: number
  push: (type: string, tag: string, nesting: number) => { meta: unknown; content: string }
}

interface BlockState {
  src: string
  bMarks: number[]
  tShift: number[]
  eMarks: number[]
  sCount: number[]
  blkIndent: number
  line: number
  push: (type: string, tag: string, nesting: number) => { meta: unknown; map: [number, number] | null; block: boolean }
}

export interface MarkdownItLike {
  inline: { ruler: { before: (name: string, rule: string, fn: (state: InlineState, silent: boolean) => boolean) => void } }
  block: { ruler: { before: (name: string, rule: string, fn: (state: BlockState, start: number, end: number, silent: boolean) => boolean, opts?: { alt: string[] }) => void } }
  renderer: { rules: Record<string, unknown> }
  utils: { escapeHtml: (value: string) => string }
}

const installed = new WeakSet<object>()

/**
 * Install the inline mention rule and the block embed rule. Idempotent per
 * markdown-it instance. Output HTML is parsed back by the TipTap nodes.
 */
export function installEntityMarkdownRules(md: MarkdownItLike): void {
  if (installed.has(md)) return
  installed.add(md)

  md.inline.ruler.before('link', 'rox_entity_mention', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false
    // A preceding `!` belongs to an embed; leave it as text inline.
    if (state.pos > 0 && state.src.charCodeAt(state.pos - 1) === 0x21 /* ! */) return false
    const match = matchEntityMention(state.src.slice(state.pos, state.posMax))
    if (!match) return false
    if (!silent) {
      const token = state.push('rox_entity_mention', '', 0)
      token.meta = { ref: match.ref, label: match.label }
    }
    state.pos += match.raw.length
    return true
  })

  md.block.ruler.before('paragraph', 'rox_entity_embed', (state, startLine, _endLine, silent) => {
    if (state.sCount[startLine]! - state.blkIndent >= 4) return false
    const line = state.src.slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine]!).trim()
    const match = matchEntityEmbed(line)
    if (!match || match.raw.length !== line.length) return false
    if (silent) return true
    const token = state.push('rox_entity_embed', '', 0)
    token.meta = { ref: match.ref }
    token.map = [startLine, startLine + 1]
    token.block = true
    state.line = startLine + 1
    return true
  }, { alt: ['paragraph'] })

  const esc = md.utils.escapeHtml
  md.renderer.rules.rox_entity_mention = (tokens: Array<{ meta: { ref: string; label: string | null } }>, idx: number) => {
    const { ref, label } = tokens[idx]!.meta
    return `<span data-entity-mention="${esc(ref)}" data-label="${esc(label ?? '')}">${esc(label ?? ref)}</span>`
  }
  md.renderer.rules.rox_entity_embed = (tokens: Array<{ meta: { ref: string } }>, idx: number) =>
    `<div data-entity-embed="${esc(tokens[idx]!.meta.ref)}"></div>`
}
