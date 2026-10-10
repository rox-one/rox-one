/**
 * Pure model for the Rox History surface (clipboard history). No DOM, no React:
 * time labels, format/size formatting, hidden-tag rules, the filter/query
 * reducer and the keyboard mapping are all testable in isolation.
 *
 * Semantics are ported from the donor clipboard manager (`overlay-filters.ts`,
 * `image-meta.ts`, `text-kind.ts`, `quick-look-keyboard.ts`) and re-expressed
 * against the Rox DTOs in `@rox/shared/clipboard-history`.
 */
import type { ClipEntryKind, ClipEntrySummary, ClipTagCount } from '@rox/shared/clipboard-history'
import { formatBytes } from '@/pages/drive/format'

// The house byte formatter (Cyrillic `Б/КБ/МБ`) is reused so every Rox surface
// reports sizes identically; re-exported for the card/quick-look consumers that
// still import it from this module.
export { formatBytes }

export type ClipboardTab = 'history' | 'starred'
export type ClipboardKindFilter = ClipEntryKind | 'all'
export type ClipFormatFilter = 'all' | 'png' | 'gif' | 'jpg'

/** Internal classification tags. They are never surfaced as filter chips. */
export const HIDDEN_TAGS: ReadonlySet<string> = new Set(['code', 'otp', 'token', 'log'])

export function isHiddenTag(tag: string): boolean {
  return HIDDEN_TAGS.has(tag.trim().toLowerCase())
}

/** Tag chips ordered by count (desc) then name; hidden tags dropped. */
export function visibleTagCounts(counts: readonly ClipTagCount[]): ClipTagCount[] {
  return counts
    .filter((item) => !isHiddenTag(item.tag))
    .slice()
    .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag))
}

/** Tags shown on a card/filter row: hidden classification tags are stripped. */
export function visibleEntryTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (!trimmed || isHiddenTag(trimmed) || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export const CLIPBOARD_PAGE_SIZE = 50

// ── filters ────────────────────────────────────────────────────────────────

export interface ClipboardFilters {
  tab: ClipboardTab
  query: string
  kind: ClipboardKindFilter
  format: ClipFormatFilter
  tag: string | null
}

export const EMPTY_CLIPBOARD_FILTERS: ClipboardFilters = {
  tab: 'history',
  query: '',
  kind: 'all',
  format: 'all',
  tag: null,
}

export type ClipboardFilterAction =
  | { type: 'tab'; tab: ClipboardTab }
  | { type: 'query'; query: string }
  | { type: 'kind'; kind: ClipboardKindFilter }
  | { type: 'format'; format: ClipFormatFilter }
  | { type: 'tag'; tag: string | null }
  | { type: 'reset' }

/** Reset keeps the active tab; it only clears query, kind, format and tag. */
export function clipboardFiltersReducer(
  state: ClipboardFilters,
  action: ClipboardFilterAction,
): ClipboardFilters {
  switch (action.type) {
    case 'tab':
      return state.tab === action.tab ? state : { ...state, tab: action.tab }
    case 'query':
      return state.query === action.query ? state : { ...state, query: action.query }
    case 'kind':
      return state.kind === action.kind ? state : { ...state, kind: action.kind }
    case 'format':
      return state.format === action.format ? state : { ...state, format: action.format }
    case 'tag':
      return state.tag === action.tag ? state : { ...state, tag: action.tag }
    case 'reset':
      return state.query === '' && state.kind === 'all' && state.format === 'all' && state.tag === null
        ? state
        : { ...state, query: '', kind: 'all', format: 'all', tag: null }
  }
}

export function hasActiveFilters(state: ClipboardFilters): boolean {
  return state.query.trim() !== '' || state.kind !== 'all' || state.format !== 'all' || state.tag !== null
}

/** Which empty state to show when the list has no entries. */
export function emptyStateKind(state: ClipboardFilters): 'search' | 'history' {
  return state.query.trim() !== '' || state.tag !== null || state.kind !== 'all' || state.format !== 'all'
    ? 'search'
    : 'history'
}

// ── time ───────────────────────────────────────────────────────────────────

export type ClipboardTimeDescriptor =
  | { key: 'clipboard.time.justNow'; count: 0 }
  | { key: 'clipboard.time.minutesAgo' | 'clipboard.time.hoursAgo' | 'clipboard.time.daysAgo'; count: number }

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** Relative-time descriptor for an ISO-8601 timestamp. */
export function relativeTime(iso: string, now: number): ClipboardTimeDescriptor {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return { key: 'clipboard.time.justNow', count: 0 }
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < MINUTE) return { key: 'clipboard.time.justNow', count: 0 }
  if (seconds < HOUR) return { key: 'clipboard.time.minutesAgo', count: Math.floor(seconds / MINUTE) }
  if (seconds < DAY) return { key: 'clipboard.time.hoursAgo', count: Math.floor(seconds / HOUR) }
  if (seconds < WEEK) return { key: 'clipboard.time.daysAgo', count: Math.floor(seconds / DAY) }
  return { key: 'clipboard.time.daysAgo', count: Math.floor(seconds / DAY) }
}

export type Translate = (key: string, options?: Record<string, unknown>) => string

export function formatRelativeTime(t: Translate, iso: string, now: number): string {
  const descriptor = relativeTime(iso, now)
  if (descriptor.key === 'clipboard.time.justNow') return t(descriptor.key)
  return t(descriptor.key, { count: descriptor.count })
}

// ── formatting ─────────────────────────────────────────────────────────────

/** Char-count footer via the `clipboard.charCount` key (`{{count}} симв.`). */
export function formatChars(t: Translate, count: number): string {
  return t('clipboard.charCount', { count })
}

/** Grouped integer for image dimensions; falls back to the raw value on bad locales. */
export function formatInteger(value: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value)
  } catch {
    return String(value)
  }
}

/**
 * Keyboard hint line via the `clipboard.screen.keysHint` key. The search chord
 * is interpolated from the house `formatHotkeyDisplay('mod+f')` helper by the
 * caller; the rest of the line is literal Russian inside the locale string.
 */
export function formatKeysHint(t: Translate, searchChord: string): string {
  return t('clipboard.screen.keysHint', { search: searchChord })
}

const GIF_PREFIX = 'R0lGOD'
const JPG_PREFIX = '/9j/'
const DATA_URL_PREFIX = /^data:[^;]*;base64,/

function base64Payload(dataUrl: string): string {
  const match = dataUrl.match(DATA_URL_PREFIX)
  return match ? dataUrl.slice(match[0].length) : dataUrl
}

/** PNG / GIF / JPG badge from stored meta or thumbnail magic bytes. */
export function imageFormatBadge(
  format: string | null | undefined,
  thumbDataUrl: string | null | undefined,
): string | null {
  const normalized = format?.trim()
  if (normalized) return normalized.toUpperCase() === 'JPEG' ? 'JPG' : normalized.toUpperCase()
  if (!thumbDataUrl) return null
  const payload = base64Payload(thumbDataUrl)
  if (payload.startsWith(GIF_PREFIX)) return 'GIF'
  if (payload.startsWith(JPG_PREFIX)) return 'JPG'
  return 'PNG'
}

/** `1 920 × 1 080 · 1.2 МБ`-style image footer via the `clipboard.image.meta` key. */
export function formatImageMeta(t: Translate, entry: ClipEntrySummary, locale?: string): string | null {
  const width = entry.imageWidth ?? 0
  const height = entry.imageHeight ?? 0
  const size = entry.imageByteSize && entry.imageByteSize > 0 ? formatBytes(entry.imageByteSize) : null
  const hasDimensions = width > 0 && height > 0
  const dimensions = hasDimensions ? `${formatInteger(width, locale)}×${formatInteger(height, locale)}` : ''
  if (hasDimensions && size) {
    return t('clipboard.image.meta', { width: formatInteger(width, locale), height: formatInteger(height, locale), size })
  }
  if (hasDimensions) return dimensions
  return size
}

// ── errors ─────────────────────────────────────────────────────────────────

export type ClipboardErrorAction = 'copy' | 'delete' | 'clear' | 'save'

/** Per-action toast keys so a failed mutation names what actually failed. */
export const CLIPBOARD_ERROR_KEYS: Record<ClipboardErrorAction, string> = {
  copy: 'clipboard.error.copy',
  delete: 'clipboard.error.delete',
  clear: 'clipboard.error.clear',
  save: 'clipboard.error.save',
}

// ── text preview ───────────────────────────────────────────────────────────

/** Collapse runs of blank lines so a clamped preview shows real content rows. */
export function collapsePreviewText(text: string | null): string {
  if (!text) return ''
  return text.replace(/\n{2,}/g, '\n').trim()
}

export function previewText(text: string | null, maxLines = 6): string {
  const collapsed = collapsePreviewText(text)
  if (!collapsed) return ''
  const lines = collapsed.split('\n')
  if (lines.length <= maxLines) return collapsed
  return `${lines.slice(0, maxLines).join('\n')}…`
}

/** Text kinds rendered in the monospace font (card preview + quick look). */
export const MONO_TEXT_KINDS: ReadonlySet<string> = new Set([
  'JSON',
  'Shell',
  'Bash',
  'SQL',
  'HTML',
  'JavaScript',
  'TypeScript',
  'Python',
  'Rust',
])

/** Heuristic kind label for copied text — drives mono vs system font in previews. */
export function detectTextKind(text: string | null): string {
  if (!text) return 'Text'
  const sample = text.trim()
  const lower = sample.toLowerCase()

  if (/^(https?:\/\/|www\.)/.test(lower)) return 'URL'
  if (
    sample.length < 10000 &&
    ((sample.startsWith('{') && sample.endsWith('}')) ||
      (sample.startsWith('[') && sample.endsWith(']')))
  ) {
    try {
      JSON.parse(sample)
      return 'JSON'
    } catch {
      // Not JSON — fall through to the remaining heuristics.
    }
  }
  if (/^#!\/.*\b(bash|sh|zsh)\b/.test(lower)) return 'Shell'
  if (
    /^(\$|#)\s+\S+/.test(sample) ||
    /\b(curl|git|npm|pnpm|yarn|brew|ssh|docker|kubectl)\b/.test(lower)
  ) {
    return 'Bash'
  }
  if (/(^|\n)\s*(select|insert|update|delete|create table|alter table)\b/.test(lower)) return 'SQL'
  if (/<[a-z][\s\S]*>/.test(lower)) return 'HTML'
  if (/\b(function|const|let|import|export|=>)\b/.test(lower)) return 'JavaScript'
  if (/\b(interface|type\s+\w+|implements|enum)\b/.test(lower)) return 'TypeScript'
  if (/(^|\n)\s*(def |class |import |from .+ import )/.test(sample)) return 'Python'
  if (/(^|\n)\s*(fn |let mut |impl |pub struct )/.test(sample)) return 'Rust'

  return 'Text'
}

export function usesMonoPreview(textKind: string): boolean {
  return MONO_TEXT_KINDS.has(textKind)
}

// ── keyboard ───────────────────────────────────────────────────────────────

export interface ClipboardKeyModifiers {
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

export interface ClipboardKeyContext {
  /** Quick look (or the clear-history dialog) is open. */
  overlayOpen: boolean
  hasQuery: boolean
  hasSelection: boolean
  /** Focus is inside an input/textarea/select/contenteditable. */
  inField: boolean
}

export type ClipboardKeyAction =
  | 'focus-search'
  | 'clear-search'
  | 'close-overlay'
  | 'select-next'
  | 'select-prev'
  | 'copy'
  | 'quick-look'
  | 'delete'
  | 'star'

/**
 * Pure keyboard mapping for the Rox History list. DOM-aware guards (typing in a
 * field, ownership of the focused panel) are resolved by the caller and passed
 * in through `context`.
 */
export function mapClipboardKey(
  key: string,
  modifiers: ClipboardKeyModifiers,
  context: ClipboardKeyContext,
): ClipboardKeyAction | null {
  if (modifiers.metaKey || modifiers.ctrlKey) {
    return key.toLowerCase() === 'f' && !modifiers.altKey ? 'focus-search' : null
  }
  if (modifiers.altKey) return null

  if (context.overlayOpen) {
    if (key === 'Escape' || key === ' ') return 'close-overlay'
    if (key === 'Enter') return 'copy'
    return null
  }

  if (context.inField) {
    return key === 'Escape' && context.hasQuery ? 'clear-search' : null
  }

  switch (key) {
    case 'Escape':
      return context.hasQuery ? 'clear-search' : null
    case ' ':
      return context.hasSelection ? 'quick-look' : null
    case 'Enter':
      return context.hasSelection ? 'copy' : null
    case 'Backspace':
    case 'Delete':
      return context.hasSelection ? 'delete' : null
    case 'ArrowDown':
    case 'ArrowRight':
    case 'j':
      return 'select-next'
    case 'ArrowUp':
    case 'ArrowLeft':
    case 'k':
      return 'select-prev'
    case 's':
    case 'S':
      return context.hasSelection ? 'star' : null
    default:
      return null
  }
}

/** Clamp an index after moving it by `delta` within `length` items. */
export function moveSelection(index: number, delta: number, length: number): number {
  if (length <= 0) return -1
  if (index < 0) return delta >= 0 ? 0 : length - 1
  const next = index + delta
  if (next < 0) return 0
  if (next >= length) return length - 1
  return next
}