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

/** True when any path segment is reserved for system Daily notes (…/daily). */
export function isReservedTemplateId(raw: string): boolean {
  const id = sanitizeTemplateId(raw)
  return !!id && id.split('/').some((part) => part === 'daily')
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
  for (const id of openedIds) {
    if (pinned.has(id) || !byId.has(id)) continue
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
