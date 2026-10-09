import { describe, expect, it } from 'bun:test'
import type { ClipEntrySummary, ClipTagCount } from '@rox/shared/clipboard-history'
import { formatAcceleratorDisplay } from '@/lib/platform'
import {
  CLIPBOARD_PAGE_SIZE,
  clipboardFiltersReducer,
  collapsePreviewText,
  detectTextKind,
  EMPTY_CLIPBOARD_FILTERS,
  emptyStateKind,
  formatBytes,
  formatChars,
  formatImageMeta,
  formatKeysHint,
  formatRelativeTime,
  hasActiveFilters,
  imageFormatBadge,
  mapClipboardKey,
  moveSelection,
  previewText,
  relativeTime,
  usesMonoPreview,
  visibleEntryTags,
  visibleTagCounts,
} from '../clipboard-history-model'

const NOW = Date.parse('2026-10-09T12:00:00.000Z')
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString()

function entry(overrides: Partial<ClipEntrySummary> = {}): ClipEntrySummary {
  return {
    id: 1,
    kind: 'text',
    preview: 'hello',
    text: 'hello',
    charCount: 5,
    imageFormat: null,
    imageWidth: null,
    imageHeight: null,
    imageByteSize: null,
    thumbDataUrl: null,
    tags: [],
    starred: false,
    createdAt: at(0),
    sourceApp: null,
    ...overrides,
  }
}

describe('clipboard history model', () => {
  it('labels relative time from the plan keys', () => {
    expect(relativeTime(at(5), NOW)).toEqual({ key: 'clipboard.time.justNow', count: 0 })
    expect(relativeTime(at(120), NOW)).toEqual({ key: 'clipboard.time.minutesAgo', count: 2 })
    expect(relativeTime(at(3 * 3600), NOW)).toEqual({ key: 'clipboard.time.hoursAgo', count: 3 })
    expect(relativeTime(at(2 * 86400), NOW)).toEqual({ key: 'clipboard.time.daysAgo', count: 2 })
    // Invalid timestamps never render NaN.
    expect(relativeTime('not-a-date', NOW)).toEqual({ key: 'clipboard.time.justNow', count: 0 })
  })

  it('interpolates the translated label with a count', () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${String(options.count)}` : key
    expect(formatRelativeTime(t, at(5), NOW)).toBe('clipboard.time.justNow')
    expect(formatRelativeTime(t, at(120), NOW)).toBe('clipboard.time.minutesAgo:2')
  })

  it('hides the internal classification tags and sorts chips by count', () => {
    const counts: ClipTagCount[] = [
      { tag: 'code', count: 9 },
      { tag: 'otp', count: 8 },
      { tag: 'token', count: 7 },
      { tag: 'log', count: 6 },
      { tag: 'links', count: 2 },
      { tag: 'work', count: 5 },
      { tag: 'links', count: 1 },
    ]
    expect(visibleTagCounts(counts)).toEqual([
      { tag: 'work', count: 5 },
      { tag: 'links', count: 2 },
      { tag: 'links', count: 1 },
    ])
    expect(visibleEntryTags(['work', 'code', 'work', ' token ', ''])).toEqual(['work'])
  })

  it('formats byte sizes through the house Cyrillic units', () => {
    expect(formatBytes(0)).toBe('0 Б')
    expect(formatBytes(512)).toBe('512 Б')
    expect(formatBytes(2048)).toBe('2.0 КБ')
    expect(formatBytes(200 * 1024)).toBe('200.0 КБ')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 МБ')
  })

  it('formats a char count through the shared key, never as bytes', () => {
    const t = (key: string, options?: Record<string, unknown>) => `${key}:${String(options?.count)}`
    expect(formatChars(t, 12)).toBe('clipboard.charCount:12')
  })

  it('interpolates the search chord into the keys-hint line', () => {
    const t = (key: string, options?: Record<string, unknown>) => `${key}:${String(options?.search)}`
    expect(formatKeysHint(t, '⌘F')).toBe('clipboard.screen.keysHint:⌘F')
  })

  it('resolves the image format badge from meta or thumbnail magic bytes', () => {
    expect(imageFormatBadge('jpeg', null)).toBe('JPG')
    expect(imageFormatBadge('png', null)).toBe('PNG')
    expect(imageFormatBadge(null, 'data:image/gif;base64,R0lGODlh')).toBe('GIF')
    expect(imageFormatBadge(null, 'data:image/jpeg;base64,/9j/4AAQ')).toBe('JPG')
    expect(imageFormatBadge(null, 'data:image/png;base64,iVBORw0KGgo')).toBe('PNG')
    expect(imageFormatBadge(null, null)).toBeNull()
  })

  it('renders the image footer meta with grouped dimensions and house bytes', () => {
    const n = (value: number) => new Intl.NumberFormat('ru').format(value)
    const t = (key: string, options?: Record<string, unknown>) =>
      `${key}|${String(options?.width)}x${String(options?.height)}|${String(options?.size)}`
    expect(formatImageMeta(t, entry({ kind: 'image', imageWidth: 1920, imageHeight: 1080, imageByteSize: 1_200_000 }), 'ru'))
      .toBe(`clipboard.image.meta|${n(1920)}x${n(1080)}|1.1 МБ`)
    expect(formatImageMeta(t, entry({ kind: 'image', imageWidth: 800, imageHeight: 600 }), 'ru')).toBe(`${n(800)}×${n(600)}`)
    expect(formatImageMeta(t, entry({ kind: 'image', imageByteSize: 2048 }), 'ru')).toBe('2.0 КБ')
    expect(formatImageMeta(t, entry({ kind: 'image' }), 'ru')).toBeNull()
  })

  it('collapses blank lines and clamps the preview', () => {
    expect(collapsePreviewText('a\n\n\n b')).toBe('a\n b')
    expect(previewText('l1\nl2\nl3\nl4', 2)).toBe('l1\nl2…')
    expect(previewText(null)).toBe('')
  })

  it('detects code-ish text for the monospace preview', () => {
    expect(detectTextKind('{"a":1}')).toBe('JSON')
    expect(detectTextKind('SELECT * FROM t')).toBe('SQL')
    expect(detectTextKind('https://example.com')).toBe('URL')
    expect(detectTextKind('just a sentence')).toBe('Text')
    expect(usesMonoPreview('JSON')).toBe(true)
    expect(usesMonoPreview('Text')).toBe(false)
  })

  it('reduces filters and reports activity', () => {
    let state = EMPTY_CLIPBOARD_FILTERS
    state = clipboardFiltersReducer(state, { type: 'tab', tab: 'starred' })
    state = clipboardFiltersReducer(state, { type: 'query', query: 'a' })
    state = clipboardFiltersReducer(state, { type: 'kind', kind: 'image' })
    state = clipboardFiltersReducer(state, { type: 'format', format: 'png' })
    state = clipboardFiltersReducer(state, { type: 'tag', tag: 'work' })
    expect(state).toEqual({ tab: 'starred', query: 'a', kind: 'image', format: 'png', tag: 'work' })
    expect(hasActiveFilters(state)).toBe(true)
    expect(emptyStateKind(state)).toBe('search')
    expect(clipboardFiltersReducer(state, { type: 'reset' })).toEqual({
      tab: 'starred', query: '', kind: 'all', format: 'all', tag: null,
    })
    expect(emptyStateKind(EMPTY_CLIPBOARD_FILTERS)).toBe('history')
    // Unchanged actions preserve the same object identity.
    expect(clipboardFiltersReducer(EMPTY_CLIPBOARD_FILTERS, { type: 'query', query: '' })).toBe(EMPTY_CLIPBOARD_FILTERS)
    expect(clipboardFiltersReducer(EMPTY_CLIPBOARD_FILTERS, { type: 'format', format: 'all' })).toBe(EMPTY_CLIPBOARD_FILTERS)
  })

  it('maps list keyboard input to pure actions', () => {
    const base = { overlayOpen: false, hasQuery: false, hasSelection: true, inField: false }
    const mods = { metaKey: false, ctrlKey: false, altKey: false }
    expect(mapClipboardKey('ArrowDown', mods, base)).toBe('select-next')
    expect(mapClipboardKey('ArrowLeft', mods, base)).toBe('select-prev')
    expect(mapClipboardKey('Enter', mods, base)).toBe('copy')
    expect(mapClipboardKey(' ', mods, base)).toBe('quick-look')
    expect(mapClipboardKey('Backspace', mods, base)).toBe('delete')
    expect(mapClipboardKey('s', mods, base)).toBe('star')
    expect(mapClipboardKey('Escape', mods, { ...base, hasQuery: true })).toBe('clear-search')
    expect(mapClipboardKey('Escape', mods, base)).toBeNull()
    expect(mapClipboardKey(' ', mods, { ...base, hasSelection: false })).toBeNull()
    expect(mapClipboardKey('f', { ...mods, metaKey: true }, base)).toBe('focus-search')
    // Typing in a field never triggers list actions.
    expect(mapClipboardKey(' ', mods, { ...base, inField: true })).toBeNull()
    expect(mapClipboardKey('Escape', mods, { ...base, inField: true, hasQuery: true })).toBe('clear-search')
    // The overlay only closes / copies.
    const overlay = { ...base, overlayOpen: true }
    expect(mapClipboardKey('Escape', mods, overlay)).toBe('close-overlay')
    expect(mapClipboardKey(' ', mods, overlay)).toBe('close-overlay')
    expect(mapClipboardKey('Enter', mods, overlay)).toBe('copy')
    expect(mapClipboardKey('ArrowDown', mods, overlay)).toBeNull()
  })

  it('clamps selection movement at both ends', () => {
    expect(moveSelection(-1, 1, 3)).toBe(0)
    expect(moveSelection(-1, -1, 3)).toBe(2)
    expect(moveSelection(0, -1, 3)).toBe(0)
    expect(moveSelection(2, 1, 3)).toBe(2)
    expect(moveSelection(1, 1, 3)).toBe(2)
    expect(moveSelection(0, 1, 0)).toBe(-1)
  })

  it('keeps the page size at 50', () => {
    expect(CLIPBOARD_PAGE_SIZE).toBe(50)
  })

  it('renders the persisted Electron accelerator as a platform chord', () => {
    // The stored shortcut is an Electron accelerator, not a registry chord.
    expect(formatAcceleratorDisplay('CommandOrControl+Shift+V', true)).toBe('⌘⇧V')
    expect(formatAcceleratorDisplay('CommandOrControl+Shift+V', false)).toBe('Ctrl+Shift+V')
    expect(formatAcceleratorDisplay('CmdOrCtrl+Alt+F1', true)).toBe('⌘⌥F1')
    expect(formatAcceleratorDisplay('Control+K', false)).toBe('Ctrl+K')
    // Never throws; an empty value passes through unchanged.
    expect(formatAcceleratorDisplay('', true)).toBe('')
  })
})