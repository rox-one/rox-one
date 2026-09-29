import { describe, expect, it } from 'bun:test'
import type { FeedItem, FeedSource } from '@craft-agent/shared/feed'
import { applyAnnotations, filterView, groupOrdered, itemsPerDay, sourceHealth, suggestTags, tagsInUse } from '../feed-model'

const NOW = new Date(2026, 8, 29, 18, 0).getTime()
const H = 3_600_000
const src: FeedSource = { id: 's1', url: 'https://b.example', kind: 'rss', intervalMin: 60, addedAt: 0, lastStatus: 'ok', color: 'blue', tags: ['blog'] }
const items: FeedItem[] = [
  { id: 'a', tab: 'news', kind: 'news', title: 'Bun 1.3 released', summary: 'faster installs', at: NOW - 1 * H, sourceId: 's1' },
  { id: 'b', tab: 'news', kind: 'news', title: 'Morning post', at: NOW - 8 * H, sourceId: 's1' },
  { id: 'c', tab: 'news', kind: 'news', title: 'Yesterday news', at: NOW - 26 * H },
  { id: 'd', tab: 'agents', kind: 'session', title: 'Session', at: NOW - 2 * H },
]
const sources = new Map([[src.id, src]])

describe('feed view model', () => {
  it('applies annotations with source fallbacks', () => {
    const v = applyAnnotations(items, { a: { color: 'red', tags: ['важное'], starred: true, readAt: 1 }, c: { tags: ['x'] } }, sources)
    expect(v[0]).toMatchObject({ color: 'red', ownColor: 'red', tags: ['важное', 'blog'], ownTags: ['важное'], starred: true, read: true })
    expect(v[1]).toMatchObject({ color: 'blue', tags: ['blog'], starred: false, read: false })
    expect(v[1]!.ownColor).toBeUndefined()
    expect(v[2]).toMatchObject({ tags: ['x'] })
    expect(v[2]!.color).toBeUndefined()
  })

  it('filters by color, tag, mark and multi-word content search', () => {
    const v = applyAnnotations(items, { a: { color: 'red', starred: true }, c: { tags: ['Idea'] } }, sources)
    const base = { tab: 'news' as const, chip: 'all' as const }
    expect(filterView(v, { ...base, colors: new Set(['red'] as const) }, NOW).map((i) => i.id)).toEqual(['a'])
    expect(filterView(v, { ...base, colors: new Set(['blue'] as const) }, NOW).map((i) => i.id)).toEqual(['b'])
    expect(filterView(v, { ...base, tag: 'idea' }, NOW).map((i) => i.id)).toEqual(['c'])
    expect(filterView(v, { ...base, tag: 'blog' }, NOW).map((i) => i.id)).toEqual(['a', 'b'])
    expect(filterView(v, { ...base, mark: 'starred' }, NOW).map((i) => i.id)).toEqual(['a'])
    expect(filterView(v, { ...base, query: 'faster bun' }, NOW).map((i) => i.id)).toEqual(['a'])
    expect(filterView(v, { ...base, query: '#blog' }, NOW).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('orders days and items, with a per-day override', () => {
    const v = applyAnnotations(items.filter((i) => i.tab === 'news'), {}, sources)
    const newest = groupOrdered(v, NOW, 'newest')
    expect(newest.map((g) => g.label)).toEqual(['today', 'yesterday'])
    expect(newest[0]!.items.map((i) => i.id)).toEqual(['a', 'b'])
    const oldest = groupOrdered(v, NOW, 'oldest')
    expect(oldest.map((g) => g.label)).toEqual(['yesterday', 'today'])
    expect(oldest[1]!.items.map((i) => i.id)).toEqual(['b', 'a'])
    const mixed = groupOrdered(v, NOW, 'newest', { [newest[0]!.key]: 'oldest' })
    expect(mixed[0]!.order).toBe('oldest')
    expect(mixed[0]!.items.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('counts items per day for sparklines', () => {
    const per = itemsPerDay(items, 's1', NOW, 3)
    expect(per).toEqual([0, 0, 2])
  })

  it('suggests tags by use, then defaults', () => {
    const v = applyAnnotations(items, { a: { tags: ['rust'] }, b: { tags: ['rust', 'go'] } }, sources)
    expect(suggestTags(v, [src], ['go'], 4, ['важное', 'rust'])).toEqual(['blog', 'rust', 'важное'])
    expect(tagsInUse(v.filter((i) => i.tab === 'news'))[0]).toEqual({ tag: 'blog', count: 2 })
  })

  it('derives source health', () => {
    expect(sourceHealth(src)).toBe('ok')
    expect(sourceHealth({ ...src, checking: true })).toBe('checking')
    expect(sourceHealth({ ...src, paused: true })).toBe('paused')
    expect(sourceHealth({ ...src, lastStatus: 'error' })).toBe('error')
    expect(sourceHealth({ ...src, lastStatus: 'unsupported' })).toBe('needs-x')
    expect(sourceHealth({ ...src, lastStatus: 'pending' })).toBe('pending')
  })
})
