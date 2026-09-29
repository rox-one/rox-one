import { describe, expect, it } from 'bun:test'
import type { FeedItem, FeedSource } from '@craft-agent/shared/feed'
import type { TeamActivityEvent } from '@craft-agent/shared/team'
import {
  attentionCount,
  buildTeamItems,
  filterFeed,
  groupByDay,
  sourceErrorText,
  sourceLabel,
  sourceTone,
  tabCounts,
} from '../feed-model'

const NOW = new Date(2026, 8, 29, 15, 0).getTime()
const H = 3_600_000

const items: FeedItem[] = [
  { id: 'session:a', tab: 'agents', kind: 'session', title: 'Build', at: NOW - H, status: 'running' },
  { id: 'run:x:1', tab: 'agents', kind: 'automation-run', title: 'Digest', at: NOW - 2 * H, status: 'error', error: 'boom' },
  { id: 'session:b', tab: 'agents', kind: 'session', title: 'Plan', at: NOW - 30 * H, status: 'waiting' },
  { id: 'news:s1:1', tab: 'news', kind: 'news', title: 'Bun 2', at: NOW - 3 * H, sourceId: 's1' },
  { id: 'news:s2:1', tab: 'news', kind: 'news', title: 'Video', at: NOW - 4 * H, sourceId: 's2' },
  { id: 'news:s3:p', tab: 'news', kind: 'page-change', title: 'Changelog', at: NOW - 5 * H, sourceId: 's3' },
  { id: 'x:1', tab: 'subscriptions', kind: 'x-post', title: 'hello', at: NOW - 10 * 24 * H },
]
const sources: FeedSource[] = [
  { id: 's1', url: 'https://github.com/oven-sh/bun', kind: 'github', intervalMin: 60, addedAt: 0, lastStatus: 'ok' },
  { id: 's2', url: 'https://youtube.com/@x', kind: 'youtube', intervalMin: 60, addedAt: 0, lastStatus: 'error', lastError: 'http-404' },
  { id: 's3', url: 'https://example.com/changes', kind: 'page', intervalMin: 60, addedAt: 0, lastStatus: 'pending' },
]

describe('feed-model', () => {
  it('filters by tab and chip', () => {
    expect(filterFeed(items, { tab: 'agents', chip: 'all' }, NOW).map((i) => i.id)).toEqual(['session:a', 'run:x:1', 'session:b'])
    expect(filterFeed(items, { tab: 'agents', chip: 'errors' }, NOW).map((i) => i.id)).toEqual(['run:x:1'])
    expect(filterFeed(items, { tab: 'agents', chip: 'automations' }, NOW)).toHaveLength(1)
    expect(filterFeed(items, { tab: 'news', chip: 'releases' }, NOW, sources).map((i) => i.title)).toEqual(['Bun 2'])
    expect(filterFeed(items, { tab: 'news', chip: 'video' }, NOW, sources).map((i) => i.title)).toEqual(['Video'])
    expect(filterFeed(items, { tab: 'news', chip: 'pages' }, NOW, sources).map((i) => i.title)).toEqual(['Changelog'])
    expect(filterFeed(items, { tab: 'subscriptions', chip: 'week' }, NOW)).toHaveLength(0)
  })

  it('filters by source and query', () => {
    expect(filterFeed(items, { tab: 'news', chip: 'all', sourceId: 's2' }, NOW).map((i) => i.id)).toEqual(['news:s2:1'])
    expect(filterFeed(items, { tab: 'news', chip: 'all', query: 'bun' }, NOW)).toHaveLength(1)
  })

  it('counts tabs and attention', () => {
    expect(tabCounts(items)).toEqual({ agents: 3, team: 0, news: 3, subscriptions: 1 })
    expect(attentionCount(items)).toBe(2)
  })

  it('groups by day', () => {
    const g = groupByDay(filterFeed(items, { tab: 'agents', chip: 'all' }, NOW), NOW)
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['today', 2], ['yesterday', 1]])
  })

  it('maps team activity to team items linked to objects', () => {
    const ev: TeamActivityEvent = { id: 'e1', kind: 'assign', actorUserId: 'u1', subjectUserId: 'u2', target: { kind: 'session', id: 's9', title: 'Deploy' }, at: NOW, refId: 'r1' }
    const [item] = buildTeamItems([ev], () => 'Ann assigned Bob')
    expect(item).toMatchObject({ id: 'team:e1', tab: 'team', title: 'Ann assigned Bob', summary: 'Deploy', ref: { type: 'session', id: 's9' }, sessionId: 's9' })
  })

  it('describes sources', () => {
    const t = (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k)
    expect(sourceTone(sources[0]!)).toBe('success')
    expect(sourceTone(sources[1]!)).toBe('danger')
    expect(sourceTone(sources[2]!)).toBe('muted')
    expect(sourceErrorText('http-404', t)).toBe('feed.sources.error.http:{"status":"404"}')
    expect(sourceErrorText('x-not-connected', t)).toBe('feed.sources.error.xNotConnected')
    expect(sourceLabel(sources[2]!)).toBe('example.com/changes')
    expect(sourceLabel({ ...sources[0]!, title: 'oven-sh/bun' })).toBe('oven-sh/bun')
  })
})
