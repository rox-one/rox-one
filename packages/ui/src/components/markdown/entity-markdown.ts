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

/**
 * Characters a ref literal cannot carry inside `[[…]]` / `![[…]]`: `|`
 * starts the label, `]` closes the link, `[[` opens another one and line
 * breaks end it. `formatEntityRef` only escapes `%` and `#`, so such a ref
 * would re-parse as a different entity (or none) after saving.
 */
const UNSAFE_REF_LITERAL = /[|\]\n\r]|\[\[/

/** True when `literal` survives `[[literal]]` → parse unchanged. */
export function isWikilinkSafeRefLiteral(literal: string): boolean {
  return literal.length > 0 && !UNSAFE_REF_LITERAL.test(literal)
}

/**
 * Canonical ref literal for a target, or null when it is not an explicit
 * entity ref or its canonical literal cannot be written inside `[[…]]`.
 */
export function canonicalEntityTarget(target: string): string | null {
  const ref = entityRefFromTarget(target)
  if (!ref) return null
  const literal = formatEntityRef(ref)
  return isWikilinkSafeRefLiteral(literal) ? literal : null
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
 * True when `src[end - 1]` is a `!` that is not backslash-escaped (an even
 * number of `\\` directly before it). Such a `!` directly before `[[…]]`
 * would read back as an embed/text instead of a mention. `end` defaults to
 * the whole string; parsers pass their position instead of slicing, so the
 * check only looks at the `!` and the backslash run before it.
 */
export function endsWithUnescapedBang(src: string, end: number = src.length): boolean {
  if (end < 1 || src.charCodeAt(end - 1) !== 0x21 /* ! */) return false
  let i = end - 2
  while (i >= 0 && src.charCodeAt(i) === 0x5c /* \\ */) i--
  return (end - 2 - i) % 2 === 0
}

/**
 * Legacy serializer helper: escape a trailing unescaped `!` to `\!` so a
 * mention written right after it (`Done!` + chip) reloads as a mention.
 * Returns `text` unchanged in every other case.
 */
export function escapeTrailingBang(text: string): string {
  return endsWithUnescapedBang(text) ? `${text.slice(0, -1)}\\!` : text
}

/** True when the line after the one ending at `lineEnd` (index of its `\n`, or -1 for EOF) is blank or absent. */
function nextLineIsBlank(src: string, lineEnd: number): boolean {
  if (lineEnd === -1) return true
  const nextEnd = src.indexOf('\n', lineEnd + 1)
  return src.slice(lineEnd + 1, nextEnd === -1 ? src.length : nextEnd).trim() === ''
}

/**
 * Official-engine block `start`: the first `![[` that begins a line with a
 * blank line before it and a blank line (or the end) after it. Never a
 * mid-line index, never a line touching paragraph text, so an embed is not
 * pulled out of the paragraph it belongs to.
 *
 * marked only calls block `start` to cut a top-level paragraph, and passes
 * the paragraph source minus its first character (`src.slice(1)`). So the
 * first line of `src` is the truncated tail of a paragraph line: an `![[` on
 * it is always mid-line (`a![[…]]`, `!![[…]]`), and it is never the blank
 * line an embed needs above it. Embeds that start the document or follow a
 * blank line are still tokenized: marked tries block tokenizers at every
 * block start regardless of `start`.
 */
export function entityEmbedBlockStart(src: string): number {
  let from = 0
  for (;;) {
    const idx = src.indexOf('![[', from)
    if (idx === -1) return -1
    const before = src.slice(0, idx)
    const lineStart = before.lastIndexOf('\n') + 1
    if (lineStart > 0 && /^[ ]{0,3}$/.test(before.slice(lineStart)) && nextLineIsBlank(src, src.indexOf('\n', idx))) {
      const prevEnd = lineStart - 1
      const prevNewline = prevEnd > 0 ? src.lastIndexOf('\n', prevEnd - 1) : -1
      // prevNewline === -1: the line above is the truncated first line (paragraph text).
      if (prevNewline !== -1 && src.slice(prevNewline + 1, prevEnd).trim() === '') return idx
    }
    from = idx + 3
  }
}

/**
 * Official-engine block tokenizer core: the embed on the first line of
 * `src`, only when the line after it is blank or the end of the input (the
 * line before is guaranteed by marked: block tokenizers run at block starts).
 */
export function matchEntityEmbedBlock(src: string): { match: EntityMentionMatch; raw: string } | null {
  const lineEnd = src.indexOf('\n')
  const line = lineEnd === -1 ? src : src.slice(0, lineEnd)
  const match = matchEntityEmbedLine(line)
  if (!match || !nextLineIsBlank(src, lineEnd)) return null
  return { match, raw: lineEnd === -1 ? line : `${line}\n` }
}

/**
 * Official engine (marked): true when a block tokenizer runs at the top
 * level. marked's root `blockTokens` call receives the lexer's own token list,
 * which carries the `links` map; list items and blockquotes are tokenized into
 * fresh arrays without it. (Pinned by the round-trip tests: an upgrade that
 * changes this fails them instead of silently embedding inside lists.)
 */
export function isMarkedRootTokenList(tokens: unknown): boolean {
  return Array.isArray(tokens) && typeof (tokens as { links?: unknown }).links === 'object' && (tokens as { links?: unknown }).links !== null
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
  /** markdown-it token nesting level: 0 at the top level, > 0 inside lists / blockquotes. */
  level?: number
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
  renderer: {
    rules: Record<string, unknown>
    renderInlineAsText: (tokens: Array<{ type: string; meta?: unknown }>, options: unknown, env: unknown) => string
  }
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
    // Never consume in silent mode. markdown-it only scans silently to skip
    // over tokens, e.g. parseLinkLabel(…, disableNested) for a link label:
    // a `[` consumed there reads as a nested link and aborts the whole link,
    // so `[x [[task:1]] y](http://z)` would lose its link and be escaped on
    // save. Returning false lets the scan step over `[[` as plain brackets;
    // the label is then tokenized normally and the mention lands inside the
    // link (carrying the link mark).
    if (silent) return false
    if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false
    // A preceding unescaped `!` belongs to an embed; leave it as text inline.
    // `\![[…]]` (written by the serializer after a literal `!`) is a mention.
    if (endsWithUnescapedBang(state.src, state.pos)) return false
    const match = matchEntityMention(state.src.slice(state.pos, state.posMax))
    if (!match) return false
    const token = state.push('rox_entity_mention', '', 0)
    token.meta = { ref: match.ref, label: match.label, source: match.raw }
    state.pos += match.raw.length
    return true
  })

  // No `alt: ['paragraph']`: an embed line cannot interrupt the paragraph
  // directly above it (that text keeps its `![[…]]` verbatim).
  // Top level only: markdown-it runs this rule inside list items and
  // blockquotes too, where an embed block would be hoisted out of the item by
  // ProseMirror (listItem content is `paragraph block*`) and the next save
  // would rewrite the list. There the line stays paragraph text.
  // (`state.level`, not `state.parentType`: markdown-it's lheading rule
  // leaves parentType set to 'paragraph' when it does not match.)
  // The next line must be blank or the end too: `![[…]]\nPara` is one
  // paragraph with a soft break (as with the flag off), not embed + paragraph.
  md.block.ruler.before('paragraph', 'rox_entity_embed', (state, startLine, endLine, silent) => {
    if ((state.level ?? 0) > 0) return false
    if (state.sCount[startLine]! - state.blkIndent >= 4) return false
    const next = startLine + 1
    if (next < endLine && state.bMarks[next]! + state.tShift[next]! < state.eMarks[next]!) return false
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
  // Image alt text is built by `renderInlineAsText`, which keeps only text-like
  // tokens and skips every other type. A mention in the alt
  // (`![alt [[task:1]]](src.png)`) would vanish from the alt and the next save
  // would rewrite it. Contribute the mention's original Markdown instead, so
  // the alt is exactly what it is with the flag off.
  const renderInlineAsText = md.renderer.renderInlineAsText.bind(md.renderer)
  md.renderer.renderInlineAsText = (tokens, options, env) => {
    if (!tokens.some((token) => token.type === 'rox_entity_mention')) return renderInlineAsText(tokens, options, env)
    let out = ''
    for (const token of tokens) {
      out += token.type === 'rox_entity_mention' ? (token.meta as Meta).source : renderInlineAsText([token], options, env)
    }
    return out
  }
}
