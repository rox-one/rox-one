import { describe, expect, it, mock } from 'bun:test'
import type { ClipEntrySummary } from '@rox/shared/clipboard-history'
import { buildClipboardSidebarGroups, type ClipboardSidebarInput } from '../clipboard-sidebar'

const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime()
let seq = 0
function entry(o: Partial<ClipEntrySummary> = {}): ClipEntrySummary {
  seq += 1
  return {
    id: seq, kind: 'text', preview: `clip ${seq}`, text: `clip ${seq}`, charCount: 6, imageFormat: null,
    imageWidth: null, imageHeight: null, imageByteSize: null, thumbDataUrl: null, tags: [], starred: false,
    createdAt: new Date(NOW - 60_000).toISOString(), sourceApp: null, ...o,
  } as ClipEntrySummary
}
const labels = { pinned: 'P', today: 'T', earlier: 'E', types: 'Ty', image: 'Image', text: 'Text', images: 'Images', empty: 'Empty', error: 'Err', unavailable: 'U', enable: 'En', showAll: 'All', retry: 'R' }
function input(o: Partial<ClipboardSidebarInput>): ClipboardSidebarInput {
  return { pinned: [], recent: [], more: { pinned: false, recent: false }, unavailable: false, dayStart: new Date(2026, 9, 14).getTime(), panelAlerting: false, counts: { total: 0, starred: 0, text: 0, image: 0 }, selectedId: null, activeKind: 'all',
    loading: false, error: null, labels, onOpenEntry: mock(), onFilterKind: mock(), onRetry: mock(), onOpenSettings: mock(), onShowAll: mock(), ...o }
}

describe('buildClipboardSidebarGroups', () => {
  it('groups pinned / today / earlier / types and hides empty groups', () => {
    const yesterday = new Date(NOW - 26 * 3600_000).toISOString()
    const entries = [entry({ starred: true }), entry(), entry({ createdAt: yesterday })]
    const onOpenEntry = mock()
    const g = buildClipboardSidebarGroups(input({ pinned: [entries[0]!], recent: [entries[1]!, entries[2]!], counts: { total: 3, starred: 1, text: 3, image: 0 }, selectedId: entries[1]!.id, onOpenEntry }))
    expect(g.map((x) => x.id)).toEqual(['pinned', 'today', 'earlier', 'types'])
    expect(g[1]!.items[0]!.active).toBe(true)
    g[2]!.items[0]!.onSelect()
    expect(onOpenEntry).toHaveBeenCalledWith(entries[2]!.id)
    expect(g[3]!.items.map((i) => i.id)).toEqual(['type-text'])
    expect(g[0]!.items[0]!.kind).toBe('entry')
    expect(g[3]!.items[0]!.kind).toBe('toggle')
  })
  it('type row toggles back to all when already active', () => {
    const onFilterKind = mock()
    const g = buildClipboardSidebarGroups(input({ counts: { total: 2, starred: 0, text: 1, image: 1 }, activeKind: 'image', onFilterKind }))
    g[0]!.items[1]!.onSelect()
    expect(onFilterKind).toHaveBeenCalledWith('all')
  })
  it('loading, error and empty states', () => {
    expect(buildClipboardSidebarGroups(input({ loading: true }))[0]!.state).toEqual({ kind: 'loading' })
    const onRetry = mock()
    const err = buildClipboardSidebarGroups(input({ error: 'x', onRetry }))[0]!.state
    expect(err?.kind).toBe('error')
    if (err?.kind === 'error') err.onRetry()
    expect(onRetry).toHaveBeenCalled()
    expect(buildClipboardSidebarGroups(input({}))[0]!.state).toEqual({ kind: 'empty', label: 'Empty' })
  })
  it('error with entries keeps groups and adds a non-alert retry row; panel alert suppresses sidebar alert', () => {
    const onRetry = mock()
    const g = buildClipboardSidebarGroups(input({ recent: [entry()], error: 'x', onRetry }))
    expect(g[0]!.id).toBe('error')
    expect(g[0]!.state).toBeUndefined()
    g[0]!.items[0]!.onSelect()
    expect(onRetry).toHaveBeenCalled()
    expect(g.some((x) => x.id === 'today')).toBe(true)
    const st = buildClipboardSidebarGroups(input({ error: 'x', panelAlerting: true }))[0]!.state
    expect(st?.kind === 'error' && st.announce).toBe(false)
  })
  it('unavailable shows enable-in-settings', () => {
    const onOpenSettings = mock()
    const st = buildClipboardSidebarGroups(input({ unavailable: true, onOpenSettings }))[0]!.state
    expect(st?.kind).toBe('empty')
    if (st?.kind === 'empty') st.action?.onSelect()
    expect(onOpenSettings).toHaveBeenCalled()
  })
  it('caps groups and offers show-all into the panel', () => {
    const onShowAll = mock()
    const recent = Array.from({ length: 14 }, () => entry())
    const g = buildClipboardSidebarGroups(input({ recent, more: { pinned: true, recent: false }, pinned: Array.from({ length: 5 }, () => entry({ starred: true })), onShowAll }))
    const today = g.find((x) => x.id === 'today')!
    expect(today.items).toHaveLength(10)
    today.actions![0]!.onSelect()
    expect(onShowAll).toHaveBeenCalledWith('history')
    g.find((x) => x.id === 'pinned')!.actions![0]!.onSelect()
    expect(onShowAll).toHaveBeenCalledWith('starred')
  })
})
