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
const labels = { pinned: 'P', today: 'T', earlier: 'E', types: 'Ty', image: 'Image', text: 'Text', images: 'Images', empty: 'Empty', error: 'Err' }
function input(o: Partial<ClipboardSidebarInput>): ClipboardSidebarInput {
  return { entries: [], counts: { total: 0, starred: 0, text: 0, image: 0 }, now: NOW, selectedId: null, activeKind: 'all',
    loading: false, error: null, labels, onOpenEntry: mock(), onFilterKind: mock(), onRetry: mock(), ...o }
}

describe('buildClipboardSidebarGroups', () => {
  it('groups pinned / today / earlier / types and hides empty groups', () => {
    const yesterday = new Date(NOW - 26 * 3600_000).toISOString()
    const entries = [entry({ starred: true }), entry(), entry({ createdAt: yesterday })]
    const onOpenEntry = mock()
    const g = buildClipboardSidebarGroups(input({ entries, counts: { total: 3, starred: 1, text: 3, image: 0 }, selectedId: entries[1]!.id, onOpenEntry }))
    expect(g.map((x) => x.id)).toEqual(['pinned', 'today', 'earlier', 'types'])
    expect(g[1]!.items[0]!.active).toBe(true)
    g[2]!.items[0]!.onSelect()
    expect(onOpenEntry).toHaveBeenCalledWith(entries[2]!.id)
    expect(g[3]!.items.map((i) => i.id)).toEqual(['type-text'])
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
})
