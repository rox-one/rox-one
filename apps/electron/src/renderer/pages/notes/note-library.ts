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
  if (/^data:image\/svg\+xml/i.test(value)) return null
  if (/^https?:\/\/\S+$/i.test(value) || /^data:image\/[a-z0-9.+-]+;base64,\S+$/i.test(value) || /^data:image\/[a-z0-9.+-]+,.+/i.test(value)) {
    return value
  }
  // Reject CSS escapes (e.g. \75rl(file:///...)) that bypass the url(...) check.
  if (value.includes('\\')) return null
  if (/url\s*\(/i.test(value)) return null
  // Reject CSS image*() functions that can smuggle urls inside gradients.
  if (/\b(?:image|image-set|cross-fade)\s*\(/i.test(value)) return null
  // Solid hex or url-free gradients only.
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value
  if (/^(linear|radial)-gradient\(/i.test(value)) return value
  return null
}

export function readNoteIcon(properties: Record<string, unknown> | null | undefined): string | null {
  const raw = properties?.[NOTES_ICON_PROPERTY]
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > 32) return null
  if (/[\x00-\x1f\x7f]/.test(value)) return null
  return value
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
  const rest = notes
    .filter((note) => !pinned.has(note.id) && !fromOpened.includes(note.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  for (const note of rest) {
    fromOpened.push(note.id)
    if (fromOpened.length >= limit) break
  }
  return fromOpened
}
