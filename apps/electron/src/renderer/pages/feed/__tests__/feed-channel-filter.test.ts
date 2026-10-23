import { describe, expect, it } from 'bun:test'
import type { FeedItem } from '@rox/shared/feed'
import { filterFeed, filterView, type FeedViewItem } from '../feed-model'

const base: FeedItem = {
  id: 'team:1',
  tab: 'team',
  kind: 'team-activity',
  title: 'msg',
  at: 1,
  channelId: 'ch-releases',
}

describe('Лента messenger channel filter', () => {
  it('keeps matching channelId and untagged team activity', () => {
    const items: FeedItem[] = [
      base,
      { ...base, id: 'team:2', channelId: 'ch-other' },
      { ...base, id: 'team:3', channelId: undefined },
    ]
    expect(filterFeed(items, { tab: 'team', chip: 'all', channelId: 'ch-releases' }, 10).map((i) => i.id).sort()).toEqual(['team:1', 'team:3'])
    expect(filterFeed(items, { tab: 'team', chip: 'all' }, 10)).toHaveLength(3)
  })

  it('filterView keeps untagged rows when channelId is set', () => {
    const items = [
      { ...base, tags: [], ownTags: [], starred: false, read: false },
      { ...base, id: 'team:2', channelId: 'ch-other', tags: [], ownTags: [], starred: false, read: false },
      { ...base, id: 'team:3', channelId: undefined, tags: [], ownTags: [], starred: false, read: false },
    ] as FeedViewItem[]
    expect(filterView(items, { tab: 'team', chip: 'all', channelId: 'ch-releases' }, 10).map((i) => i.id).sort()).toEqual(['team:1', 'team:3'])
  })
})
