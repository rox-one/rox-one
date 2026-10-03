import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'bun:test'
import type { FeedItem, FeedSource } from '@rox/shared/feed'
import { applyAnnotations, filterView, groupByDay, groupOrdered, itemsPerDay, matchesChip, sourceHealth, suggestTags, tagsInUse, visibleMarkCounts } from '../feed-model'

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

  it('uses local calendar days across DST changes, non-hour offsets, and year rollover', () => {
    const script = `
      const { groupOrdered, itemsPerDay, matchesChip } = await import(${JSON.stringify(new URL('../feed-model.ts', import.meta.url).href)})
      const item = (id, at) => ({ id, at, title: id, tab: 'news', kind: 'news', sourceId: 's' })
      const dayLabels = (now, timestamps) => groupOrdered(timestamps.map((at, i) => item(String(i), at)), now, 'newest').map(g => [g.label, g.items.map(x => x.id)])
      const today = new Date(2026, 2, 9, 0, 30).getTime()
      const spring = dayLabels(today, [new Date(2026, 2, 8, 23, 30).getTime(), today])
      const springWeek = [matchesChip(item('y', new Date(2026, 2, 3, 23, 59).getTime()), 'week', today), matchesChip(item('old', new Date(2026, 2, 2, 23, 59).getTime()), 'week', today)]
      const futureToday = matchesChip(item('future', today + 60_000), 'today', today)
      const fallNow = new Date(2026, 10, 2, 0, 30).getTime()
      const fall = dayLabels(fallNow, [new Date(2026, 10, 1, 0, 30).getTime(), new Date(2026, 10, 1, 23, 30).getTime()])
      const monthEnd = new Date(2026, 0, 1, 0, 15).getTime()
      const rollover = dayLabels(monthEnd, [new Date(2025, 11, 31, 23, 45).getTime()])
      const sparklineNow = new Date(2026, 2, 9, 12).getTime()
      const sparkline = itemsPerDay([
        item('yesterday', new Date(2026, 2, 8, 23, 59).getTime()),
        item('today', sparklineNow),
        item('future', sparklineNow + 60_000),
      ], 's', sparklineNow, 2)
      console.log(JSON.stringify({ spring, springWeek, futureToday, fall, rollover, sparkline }))
    `
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ: 'America/New_York' },
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      spring: [['today', ['1']], ['yesterday', ['0']]],
      springWeek: [true, false],
      futureToday: false,
      fall: [['yesterday', ['1', '0']]],
      rollover: [['yesterday', ['0']]],
      sparkline: [1, 1],
    })
  })

  it('uses local calendar dates across a non-hour DST transition', () => {
    const script = `
      const { groupOrdered, itemsPerDay } = await import(${JSON.stringify(new URL('../feed-model.ts', import.meta.url).href)})
      const now = new Date(2026, 3, 6, 0, 15).getTime()
      const yesterday = new Date(2026, 3, 5, 23, 45).getTime()
      const item = { id: 'y', at: yesterday, title: 'y', tab: 'news', kind: 'news', sourceId: 's' }
      console.log(JSON.stringify({ labels: groupOrdered([item], now, 'newest').map(g => g.label), sparkline: itemsPerDay([item], 's', now, 2) }))
    `
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ: 'Australia/Lord_Howe' },
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ labels: ['yesterday'], sparkline: [1, 0] })
  })

  it('derives badge counts only from filtered rows', () => {
    const viewItems = applyAnnotations(items, { a: { starred: true } }, sources)
    const visible = filterView(viewItems, { tab: 'news', chip: 'all', query: 'bun' }, NOW)
    expect(visible.map((i) => i.id)).toEqual(['a'])
    expect(visibleMarkCounts(visible)).toEqual({ unread: 1, starred: 1 })
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
