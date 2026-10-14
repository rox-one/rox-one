/**
 * Plain-text projection of a message for OS notifications.
 *
 * Boot-closure: this used `remark().use(stripMarkdown)`, which pulled the whole
 * unified/mdast/micromark pipeline (~100 modules: `remark-parse` →
 * `mdast-util-from-markdown` → `micromark*`, `remark-stringify` →
 * `mdast-util-to-markdown`, `vfile`) into `index.html`'s eager closure for one
 * synchronous call per finished turn. The preview only needs "readable text, no
 * markdown syntax, no emoji, single line", so it is computed by a small scanner
 * instead. The exact contract is pinned in `__tests__/text.test.ts`.
 *
 * Parity with the remark implementation on realistic message prose is total;
 * the deliberate improvements are documented in the test file (escaped
 * punctuation, task-list and footnote markers, inline-code content, entities).
 */

/**
 * Emoji + pictographs are dropped from notification previews. Joiners and
 * variation selectors go with them: the remark pipeline left the invisible
 * tail of `👨‍👩‍👧` / `❤️` behind, which reads as stray characters in a
 * notification.
 */
const EMOJI_REGEX = /\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Join_Control}|\uFE0F|\u20E3/gu

/** Opening/closing fence of a fenced code block. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/
/** HTML comment (CommonMark HTML block type 2: the rest of the line belongs to it). */
const HTML_COMMENT_LINE = /^\s*<!--/
/** Inline HTML comment. */
const HTML_COMMENT_INLINE = /<!--[\s\S]*?-->/g
/** A line that opens a block-level element is an HTML block, not prose. */
const HTML_BLOCK_OPEN = /^ {0,3}<\/?(?:address|article|aside|blockquote|details|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|main|nav|ol|p|pre|script|section|style|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b/i
/** Any leftover inline tag. */
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g
/** ATX heading: `### title ###`. */
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const ATX_CLOSING = /[ \t]+#+[ \t]*$/
/** Setext heading underline. */
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/
/** Horizontal rule (three or more markers on one line). */
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
/** Blockquote marker, one per nesting level. */
const BLOCKQUOTE_MARKER = /^ {0,3}> ?/
/** Bullet or ordered list marker plus an optional GFM task checkbox. */
const LIST_MARKER = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)(?:\[[ xX]\][ \t]+)?/
/** Footnote definition line — the note body is not part of a message preview. */
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]]*\]:/
/** Image: keep the alt text (mdast `image` renders its alt). */
const IMAGE = /!\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:[ \t]+"[^"]*")?\)/g
/** Link: keep the label, drop the destination (one level of parens allowed inside the URL). */
const LINK = /\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:[ \t]+"[^"]*")?\)/g
/** Reference-style link/image leftovers: `[label][ref]` → `label`. */
const REFERENCE_LINK = /\[([^\]]*)\]\[[^\]]*\]/g
/** Autolink: `<https://…>` / `<user@host>` keep the address itself. */
const AUTOLINK = /<((?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|mailto:)[^>\s]+|[^\s<>@]+@[^\s<>@]+)>/g
/** Footnote reference `[^id]` — carries no inline reading value. */
const FOOTNOTE_REF = /\[\^[^\]]*\]/g
/** Emphasis / strong / strikethrough markers. */
const EMPHASIS = /(\*{1,3}|~~)(?=\S)([\s\S]*?\S)\1/g
/**
 * `_` emphasis never opens or closes inside a word (CommonMark flanking), so
 * identifiers like `snake_case_name` and URLs survive untouched.
 */
const EMPHASIS_UNDERSCORE = /(?<![\p{L}\p{N}_])(_{1,3})(?=\S)([\s\S]*?\S)\1(?![\p{L}\p{N}_])/gu
/** Backslash escape before punctuation. */
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!>~|])/g
/** Inline code span (`` ` `` or longer fence), content kept as literal text. */
const CODE_SPAN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g
/** Numeric and the named entities markdown emits. */
const ENTITY = /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
}

const PLACEHOLDER = '\u0000'

/** Literal text (code spans, escapes, autolinks) is parked here until the end. */
function park(store: string[], value: string): string {
  store.push(value)
  return `${PLACEHOLDER}${store.length - 1}${PLACEHOLDER}`
}

function restore(text: string, store: readonly string[]): string {
  return text.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_match, index: string) => store[Number(index)] ?? '')
}

/** Fenced code blocks disappear whole — a preview has no room for them. */
function dropFencedCode(text: string): string {
  const kept: string[] = []
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const match = FENCE_LINE.exec(line)
    if (match) {
      const marker = match[1]!
      if (fence === null) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (fence === null) kept.push(line)
  }
  return kept.join('\n')
}

/** Strip every nesting level of blockquote marker. */
function stripBlockquotes(line: string): string {
  let current = line
  for (;;) {
    const next = current.replace(BLOCKQUOTE_MARKER, '')
    if (next === current) return current
    current = next
  }
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (match, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec) return String.fromCodePoint(Number(dec))
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    const named = name ? NAMED_ENTITIES[name.toLowerCase()] : undefined
    return named ?? match
  })
}

/**
 * Strip markdown formatting and emojis.
 *
 * Block constructs a notification cannot use (fenced code, HTML blocks,
 * comments, footnote definitions) are dropped whole. Inline constructs keep
 * their text: `**bold**` → `bold`, `[label](url)` → `label`, `` `code` `` →
 * `code`, `![alt](src)` → `alt`.
 */
export function stripMarkdown(text: string): string {
  if (!text) return ''

  const literal: string[] = []
  let out = dropFencedCode(String(text).replace(/\r\n?/g, '\n'))

  // Code spans are literal text: park them before anything can read their content as markup.
  out = out.replace(CODE_SPAN, (_match, _fence: string, content: string) => park(literal, content))
  // Escaped punctuation is literal too.
  out = out.replace(ESCAPE, (_match, char: string) => park(literal, char))
  // Autolinks keep their address (before the generic tag stripper runs).
  out = out.replace(AUTOLINK, (_match, address: string) => park(literal, address))

  const kept: string[] = []
  for (const line of out.split('\n')) {
    if (HTML_COMMENT_LINE.test(line)) continue
    if (HTML_BLOCK_OPEN.test(line)) continue
    if (FOOTNOTE_DEFINITION.test(line)) continue
    if (THEMATIC_BREAK.test(line)) continue
    // A setext underline turns the previous line into a heading; drop the rule.
    if (SETEXT_UNDERLINE.test(line) && kept.length > 0) continue
    kept.push(
      stripBlockquotes(line)
        .replace(HTML_COMMENT_INLINE, '')
        .replace(ATX_HEADING, '')
        .replace(ATX_CLOSING, '')
        .replace(LIST_MARKER, '$1')
        .replace(HTML_TAG, ''),
    )
  }
  out = kept.join('\n')

  out = out
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(REFERENCE_LINK, '$1')
    .replace(FOOTNOTE_REF, '')
    // Run emphasis twice so `**bold _italic_**` unwraps both levels.
    .replace(EMPHASIS, '$2')
    .replace(EMPHASIS, '$2')
    .replace(EMPHASIS_UNDERSCORE, '$2')
    .replace(EMPHASIS_UNDERSCORE, '$2')

  return decodeEntities(restore(out, literal))
    .replace(EMOJI_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim()
}
