/**
 * W1-08 (#1505) — Markdown serialisation for entity mentions and embeds.
 *
 * TECH-SPEC §3.9: mention → `[[kind:id|label]]`, embed → `![[kind:id]]`.
 * The syntax is wiki-link compatible, so the vault indexer and the link
 * extractor in `server-core/src/entities/extract.ts` record the refs.
 *
 * Only *explicit* syntax becomes a node. Targets are classified with the
 * shared `classifyWikilinkTarget` from `@rox/core/entities` (the same rule
 * set the link extractor uses), so `[[Встреча: итоги]]`, `[[note: итоги]]`
 * and `[[My note]]` stay plain wikilinks (note titles) and bare `kind:id`
 * prose is never touched (explicit-syntax-only policy).
 *
 * Saving never rewrites user text: nodes parsed from Markdown keep the
 * original syntax in their `source` attr and serialise it unchanged (kind
 * aliases, id encoding and label spacing included). The canonical form is
 * only used for resolving and for refs inserted from the picker.
 */
import { explicitEntityRefFromWikilinkTarget, formatEntityRef, type EntityRef } from '@rox/core/entities'

export const ENTITY_MENTION_NODE = 'mention'
export const ENTITY_EMBED_NODE = 'entityEmbed'

/** `[[target|label]]` (not preceded by `!`). Same shape as extract.ts. */
const MENTION_SOURCE = /^\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/
/** `![[target]]` / `![[target|label]]`. */
const EMBED_SOURCE = /^!\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/

/** Explicit entity ref for a wikilink target (shared classifier), or null. */
export function entityRefFromTarget(target: string): EntityRef | null {
  return explicitEntityRefFromWikilinkTarget(target.trim())
}

/** Canonical ref literal for a target, or null when it is not an explicit entity ref. */
export function canonicalEntityTarget(target: string): string | null {
  const ref = entityRefFromTarget(target)
  return ref ? formatEntityRef(ref) : null
}

/** Labels cannot contain `]` or newlines inside `[[…|label]]`. */
export function sanitizeMentionLabel(label: string): string {
  return label.replace(/[\]\n\r]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface EntityMentionMatch {
  /** The matched Markdown, verbatim (stored as the node's `source`). */
  raw: string
  /** Canonical ref literal (for resolving). */
  ref: string
  /** Display label (sanitised), or null. */
  label: string | null
}

function matchWith(re: RegExp, src: string): EntityMentionMatch | null {
  const m = re.exec(src)
  if (!m) return null
  const ref = canonicalEntityTarget(m[1] ?? '')
  if (!ref) return null
  const label = m[2] !== undefined ? sanitizeMentionLabel(m[2]) : ''
  return { raw: m[0], ref, label: label || null }
}

/** Match an entity mention at the start of `src` (null for plain wikilinks). */
export function matchEntityMention(src: string): EntityMentionMatch | null {
  return matchWith(MENTION_SOURCE, src)
}

/** Match an entity embed at the start of `src`. */
export function matchEntityEmbed(src: string): EntityMentionMatch | null {
  return matchWith(EMBED_SOURCE, src)
}

/**
 * `source` is reused verbatim only while it still describes the node: it
 * must be the whole match and resolve to the same canonical ref and label.
 * A node whose ref/label changed falls back to the canonical form.
 */
function reusableSource(
  matcher: (src: string) => EntityMentionMatch | null,
  source: string | null | undefined,
  ref: string,
  label: string | null | undefined,
): string | null {
  if (!source) return null
  const match = matcher(source)
  if (!match || match.raw !== source) return null
  if (match.ref !== (canonicalEntityTarget(ref) ?? ref)) return null
  if ((match.label ?? '') !== sanitizeMentionLabel(label ?? '')) return null
  return source
}

export function serializeEntityMention(ref: string, label?: string | null, source?: string | null): string {
  const original = reusableSource(matchEntityMention, source, ref, label)
  if (original) return original
  const canonical = canonicalEntityTarget(ref) ?? ref
  const clean = label ? sanitizeMentionLabel(label) : ''
  return clean ? `[[${canonical}|${clean}]]` : `[[${canonical}]]`
}

export function serializeEntityEmbed(ref: string, label?: string | null, source?: string | null): string {
  const original = reusableSource(matchEntityEmbed, source, ref, label)
  if (original) return original
  const canonical = canonicalEntityTarget(ref) ?? ref
  const clean = label ? sanitizeMentionLabel(label) : ''
  return clean ? `![[${canonical}|${clean}]]` : `![[${canonical}]]`
}

/**
 * Official-engine block `start`: the first `![[` that begins a line after a
 * blank line (or at the very start). Never a mid-line index, and never the
 * line right after paragraph text, so an embed is not pulled out of the
 * paragraph it belongs to.
 */
export function entityEmbedBlockStart(src: string): number {
  let from = 0
  for (;;) {
    const idx = src.indexOf('![[', from)
    if (idx === -1) return -1
    if (idx === 0) return 0
    const before = src.slice(0, idx)
    const lineStart = before.lastIndexOf('\n') + 1
    if (/^[ ]{0,3}$/.test(before.slice(lineStart))) {
      const prevEnd = lineStart - 1
      if (prevEnd < 0) return idx
      const prevStart = src.lastIndexOf('\n', prevEnd - 1) + 1
      if (src.slice(prevStart, prevEnd).trim() === '') return idx
    }
    from = idx + 3
  }
}

/**
 * Whole-line embed: `line` must be exactly `![[…]]` (up to 3 leading spaces,
 * trailing whitespace ignored; 4+ spaces is indented code).
 */
export function matchEntityEmbedLine(line: string): EntityMentionMatch | null {
  if (/^(?: {4}|\t)/.test(line)) return null
  const trimmed = line.trim()
  const match = matchEntityEmbed(trimmed)
  return match && match.raw.length === trimmed.length ? match : null
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
      token.meta = { ref: match.ref, label: match.label, source: match.raw }
    }
    state.pos += match.raw.length
    return true
  })

  // No `alt: ['paragraph']`: an embed line cannot interrupt the paragraph
  // directly above it (that text keeps its `![[…]]` verbatim).
  md.block.ruler.before('paragraph', 'rox_entity_embed', (state, startLine, _endLine, silent) => {
    if (state.sCount[startLine]! - state.blkIndent >= 4) return false
    const match = matchEntityEmbedLine(state.src.slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine]!))
    if (!match) return false
    if (silent) return true
    const token = state.push('rox_entity_embed', '', 0)
    token.meta = { ref: match.ref, label: match.label, source: match.raw }
    token.map = [startLine, startLine + 1]
    token.block = true
    state.line = startLine + 1
    return true
  })

  const esc = md.utils.escapeHtml
  type Meta = { ref: string; label: string | null; source: string }
  md.renderer.rules.rox_entity_mention = (tokens: Array<{ meta: Meta }>, idx: number) => {
    const { ref, label, source } = tokens[idx]!.meta
    return `<span data-entity-mention="${esc(ref)}" data-label="${esc(label ?? '')}" data-source="${esc(source)}">${esc(label ?? ref)}</span>`
  }
  md.renderer.rules.rox_entity_embed = (tokens: Array<{ meta: Meta }>, idx: number) => {
    const { ref, label, source } = tokens[idx]!.meta
    return `<div data-entity-embed="${esc(ref)}" data-label="${esc(label ?? '')}" data-source="${esc(source)}"></div>`
  }
}
