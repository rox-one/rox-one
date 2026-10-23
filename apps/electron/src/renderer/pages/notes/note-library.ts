/** Notes library helpers: cover/icon meta, recents open order, template id sanitize. */

export const NOTES_COVER_PROPERTY = 'cover'
export const NOTES_ICON_PROPERTY = 'icon'

export const NOTES_COVER_PRESETS = [
  { id: 'aurora', value: 'linear-gradient(135deg, color-mix(in oklab, var(--accent) 55%, transparent), color-mix(in oklab, var(--status-success) 40%, transparent))' },
  { id: 'dusk', value: 'linear-gradient(135deg, color-mix(in oklab, var(--status-warning) 50%, transparent), color-mix(in oklab, var(--accent) 35%, transparent))' },
  { id: 'slate', value: 'linear-gradient(135deg, color-mix(in oklab, var(--muted-foreground) 35%, transparent), color-mix(in oklab, var(--border) 50%, transparent))' },
  { id: 'rose', value: 'linear-gradient(135deg, color-mix(in oklab, var(--destructive) 40%, transparent), color-mix(in oklab, var(--accent) 30%, transparent))' },
] as const

export const NOTES_ICON_PRESETS = ['📝', '💡', '🎯', '📚', '🧠', '🗂️', '✅', '🚀', '📎', '🗓️', '💬', '⭐'] as const

export function readNoteCover(properties: Record<string, unknown> | null | undefined): string | null {
  const raw = properties?.[NOTES_COVER_PROPERTY]
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > 2048) return null
  // Deny SVG data URLs (scriptable); allow other sole http(s) / data:image values.
  if (/^data:image\/svg\b/i.test(value)) return null
  if (/^https?:\/\/\S+$/i.test(value) || /^data:image\/[a-z0-9.+-]+;base64,\S+$/i.test(value) || /^data:image\/[a-z0-9.+-]+,.+/i.test(value)) {
    return value
  }
  // Reject CSS escapes (e.g. \75rl(file:///...)) that bypass the url(...) check.
  if (value.includes('\\')) return null
  if (/url\s*\(/i.test(value)) return null
  // Reject CSS image*() / element() / paint() / attr() that can smuggle urls inside gradients.
  if (/\b(?:image|image-set|cross-fade|element|paint|attr)\s*\(/i.test(value)) return null
  // Solid hex or url-free gradients only.
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value
  if (/^(linear|radial)-gradient\(/i.test(value)) return value
  return null
}

export function readNoteIcon(properties: Record<string, unknown> | null | undefined): string | null {
  const raw = properties?.[NOTES_ICON_PROPERTY]
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  // UTF-16 abuse ceiling — still allow ZWJ emoji sequences longer than 32 code units.
  if (value.length > 128) return null
  if (/[\x00-\x1f\x7f]/.test(value)) return null
  const graphemeCount = countGraphemes(value)
  if (graphemeCount > 8) return null
  return value
}

function countGraphemes(value: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length
  }
  // Fallback: code points (under-counts some ZWJ sequences but never rejects short ZWJ as >8).
  return Array.from(value).length
}

export function withNoteLibraryProperties(
  properties: Record<string, unknown>,
  patch: { cover?: string | null; icon?: string | null },
): Record<string, unknown> {
  const next = { ...properties }
  if ('cover' in patch) {
    if (patch.cover == null || patch.cover.trim() === '') delete next[NOTES_COVER_PROPERTY]
    else next[NOTES_COVER_PROPERTY] = patch.cover.trim()
  }
  if ('icon' in patch) {
    if (patch.icon == null || patch.icon.trim() === '') delete next[NOTES_ICON_PROPERTY]
    else next[NOTES_ICON_PROPERTY] = patch.icon.trim()
  }
  return next
}

/** Double-quoted YAML scalar — safe for cover URLs/gradients and emoji icons. */
function yamlDoubleQuoted(value: string): string {
  return JSON.stringify(value)
}

/**
 * Surgical cover/icon frontmatter edit: only those top-level keys change.
 * Comments, sibling keys, order, and body bytes are preserved — never a full
 * property-dictionary stringify. Returns null when sanitization fails or an
 * existing cover/icon value is not a one-line scalar we can rewrite in place.
 */
export function patchNoteLibraryChromeContent(
  content: string,
  patch: { cover?: string | null; icon?: string | null },
): string | null {
  const ops: Array<{ key: typeof NOTES_COVER_PROPERTY | typeof NOTES_ICON_PROPERTY; value: string | null }> = []
  if ('cover' in patch) {
    if (patch.cover == null || patch.cover.trim() === '') ops.push({ key: NOTES_COVER_PROPERTY, value: null })
    else {
      const safe = readNoteCover({ cover: patch.cover })
      if (!safe) return null
      ops.push({ key: NOTES_COVER_PROPERTY, value: safe })
    }
  }
  if ('icon' in patch) {
    if (patch.icon == null || patch.icon.trim() === '') ops.push({ key: NOTES_ICON_PROPERTY, value: null })
    else {
      const safe = readNoteIcon({ icon: patch.icon })
      if (!safe) return null
      ops.push({ key: NOTES_ICON_PROPERTY, value: safe })
    }
  }
  if (ops.length === 0) return content

  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : ''
  const text = bom ? content.slice(1) : content
  const match = text.match(/^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n)?/)
  if (!match) {
    const eol = '\n'
    const lines = ops.filter((op) => op.value != null).map((op) => `${op.key}: ${yamlDoubleQuoted(op.value!)}`)
    if (lines.length === 0) return content
    return `${bom}---${eol}${lines.join(eol)}${eol}---${eol}${text}`
  }

  const openEol = match[1]!
  const closeEol = match[4] ?? openEol
  const body = text.slice(match[0].length)
  const lines = match[2]!.split(/\r?\n/)

  for (const { key, value } of ops) {
    const keyLineRe = new RegExp(`^${key}\\s*:`)
    const matches: number[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      // Quoted key forms (`"cover":` / `'icon':`) — refuse rather than insert a second unquoted key.
      if (new RegExp(`^["']${key}["']\\s*:`).test(line)) return null
      // Top-level key with optional whitespace before `:` (`cover:` / `cover : …`).
      const keyMatch = keyLineRe.exec(line)
      if (!keyMatch) continue
      const rawValue = line.slice(keyMatch[0].length).trim()
      // Block/folded scalar indicators — rewriting the indicator line would orphan the body.
      if (/^[|>][+-]?\d*$/.test(rawValue)) return null
      // Skip blank lines after the key; an indented non-blank body means a multiline value.
      let j = i + 1
      while (j < lines.length && lines[j]!.trim() === '') j++
      if (j < lines.length && /^[ \t]+\S/.test(lines[j]!)) return null
      matches.push(i)
    }
    // Duplicate top-level cover:/icon: — refuse rather than leave orphans.
    if (matches.length > 1) return null
    if (matches.length === 1) {
      const foundAt = matches[0]!
      if (value === null) lines.splice(foundAt, 1)
      else lines[foundAt] = `${key}: ${yamlDoubleQuoted(value)}`
      continue
    }
    if (value === null) continue
    let insertAt = lines.length
    while (insertAt > 0 && lines[insertAt - 1] === '') insertAt--
    lines.splice(insertAt, 0, `${key}: ${yamlDoubleQuoted(value)}`)
  }

  const header = lines.join(openEol)
  return `${bom}---${openEol}${header}${openEol}---${closeEol}${body}`
}

export function sanitizeTemplateId(raw: string): string {
  const id = raw
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/\.\./g, '')
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[/\-]+|[/\-]+$/g, '')
    .slice(0, 80)
  // Match server assertSafeTemplateId — never allow a templates/ path segment.
  if (!id || id.split('/').some((part) => part === 'templates' || part === '')) return ''
  return id
}

/** Which reserved basename applies, if any (`daily` / `imports` at any path). */
export function reservedTemplateIdKind(raw: string): 'daily' | 'imports' | null {
  const id = sanitizeTemplateId(raw)
  if (!id) return null
  const parts = id.split('/')
  if (parts.some((part) => part === 'daily')) return 'daily'
  if (parts.some((part) => part === 'imports')) return 'imports'
  return null
}

/** True when any path segment is reserved (Daily notes or imports provenance). */
export function isReservedTemplateId(raw: string): boolean {
  return reservedTemplateIdKind(raw) != null
}

/** Live typing helper — keeps a single trailing `/` so nested ids like team/weekly can be entered. */
export function sanitizeTemplateIdDraft(raw: string): string {
  const keepTrailingSlash = /\/\s*$/.test(raw)
  const base = sanitizeTemplateId(raw.replace(/\/+\s*$/g, ''))
  if (!base) return ''
  if (!keepTrailingSlash) return base
  const nested = `${base}/`
  return nested.length <= 80 ? nested : base
}

/** Most-recently-opened first; keep unique ids; cap length. */
export function touchRecentOpened(opened: readonly string[], noteId: string, limit = 20): string[] {
  const id = noteId.trim()
  if (!id) return opened as string[]
  const next = [id, ...opened.filter((item) => item !== id)]
  return next.slice(0, Math.max(1, limit))
}

export function mergeRecentsByOpened(
  notes: ReadonlyArray<{ id: string; updatedAt: number }>,
  openedIds: readonly string[],
  pinnedIds: readonly string[],
  limit: number,
): string[] {
  const pinned = new Set(pinnedIds)
  const byId = new Map(notes.map((note) => [note.id, note]))
  const fromOpened: string[] = []
  const seenOpened = new Set<string>()
  for (const id of openedIds) {
    if (pinned.has(id) || !byId.has(id) || seenOpened.has(id)) continue
    seenOpened.add(id)
    fromOpened.push(id)
    if (fromOpened.length >= limit) return fromOpened
  }
  // Top-k by updatedAt without sorting the full candidate list (k = remaining slots).
  const openedSet = new Set(fromOpened)
  const candidates = notes.filter((note) => !pinned.has(note.id) && !openedSet.has(note.id))
  while (fromOpened.length < limit && candidates.length > 0) {
    let best = 0
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i]!.updatedAt > candidates[best]!.updatedAt) best = i
    }
    const [picked] = candidates.splice(best, 1)
    fromOpened.push(picked!.id)
  }
  return fromOpened
}
