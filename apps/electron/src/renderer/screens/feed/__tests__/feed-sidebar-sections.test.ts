import { describe, expect, it } from 'bun:test'
import { buildFeedSidebarSections } from '../feed-sidebar-sections'

const base = {
  counts: { agents: 2, team: 0, news: 10, subscriptions: 1 },
  attention: 1,
  sources: [{ id: 's1', label: 'HN', kind: 'rss', count: 10, unhealthy: false }, { id: 's2', label: 'Paused', kind: 'rss', count: 0, unhealthy: true }],
  tags: [{ tag: 'ai', count: 3 }],
  x: { connected: false },
  team: { connected: true, name: 'Rox' },
}

describe('buildFeedSidebarSections', () => {
  it('views with counts; agents flagged on attention', () => {
    const [views] = buildFeedSidebarSections(base)
    expect(views!.items.map((i) => [i.id, i.count])).toEqual([['view:agents', 2], ['view:team', undefined], ['view:news', 10], ['view:subscriptions', 1]])
    expect(views!.items[0]!.badge).toBe('attention')
  })
  it('feeds list sources then a manage row; unhealthy sources get a status badge', () => {
    const feeds = buildFeedSidebarSections(base).find((s) => s.id === 'feeds')!
    expect(feeds.items.map((i) => i.id)).toEqual(['source:s1', 'source:s2', 'manage-sources'])
    expect(feeds.items[1]!.badge).toBe('status')
    expect(feeds.items[2]!.labelKey).toBe('feed.nav.manageSources')
    const empty = buildFeedSidebarSections({ ...base, sources: [] }).find((s) => s.id === 'feeds')!
    expect(empty.items.map((i) => i.labelKey)).toEqual(['feed.nav.addFirstSource'])
  })
  it('connection rows use their own targets, never a «Виды» key', () => {
    const subs = (c: boolean) => buildFeedSidebarSections({ ...base, x: { connected: c, username: 'me' } }).find((s) => s.id === 'subscriptions')!.items
    expect(subs(false)[0]!.target).toEqual({ kind: 'filter', filterId: 'conn:x' })
    expect(subs(true)[0]).toMatchObject({ secondary: '@me', target: { kind: 'filter', filterId: 'conn:x' } })
    expect(subs(true)[1]!.target).toEqual({ kind: 'filter', filterId: 'conn:team' })
  })
})

describe('feed X connection row', () => {
  it('says "not connected" instead of a status badge', () => {
    const subs = buildFeedSidebarSections(base).find((s) => s.id === 'subscriptions')!
    const x = subs.items.find((i) => i.id === 'conn:x')!
    expect(x.badge).toBeUndefined()
    expect(x.secondaryKey).toBe('screens.feed.notConnected')
  })
})
