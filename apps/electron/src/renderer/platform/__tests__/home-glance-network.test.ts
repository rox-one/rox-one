import { describe, expect, it } from 'bun:test'
import { cleanSubreddit, decodeEntities, mergeFeeds, parseFeed, parseHackerNews, parseLobsters, parseReddit, safeLink } from '../home/glance/widgets/net/parsers'
import { hackerNewsUrl } from '../home/glance/widgets/HackerNewsWidget'
import { lobstersUrl } from '../home/glance/widgets/LobstersWidget'
import { redditUrl } from '../home/glance/widgets/RedditWidget'

describe('glance network parsers', () => {
  it('parses RSS 2.0 with CDATA, entities and drops unsafe links', () => {
    const xml = `<rss><channel><title>Blog &amp; Co</title>
      <item><title><![CDATA[Hello <b>world</b>]]></title><link>https://a.test/1</link><pubDate>Tue, 13 Oct 2026 10:00:00 GMT</pubDate><guid>g1</guid></item>
      <item><title>Bad</title><link>javascript:alert(1)</link></item>
      <item><title>Rel</title><link>/2</link></item></channel></rss>`
    const { title, items } = parseFeed(xml, 'https://a.test/feed')
    expect(title).toBe('Blog & Co')
    expect(items.map((i) => i.url)).toEqual(['https://a.test/1', 'https://a.test/2'])
    expect(items[0]!.title).toBe('Hello world')
    expect(items[0]!.at).toBe(Date.parse('2026-10-13T10:00:00Z'))
  })

  it('parses Atom alternate links', () => {
    const xml = `<feed><title>F</title><entry><title>E</title><link rel="self" href="https://x.test/self"/><link rel="alternate" href="https://x.test/e"/><id>e1</id><updated>2026-10-01T00:00:00Z</updated></entry></feed>`
    const { items } = parseFeed(xml, 'https://x.test/atom')
    expect(items).toHaveLength(1)
    expect(items[0]!.url).toBe('https://x.test/e')
  })

  it('parses HN, Lobsters and Reddit defensively', () => {
    expect(parseHackerNews({ hits: [{ objectID: '1', title: 'T', url: 'https://e.test', points: 5, num_comments: 2, created_at_i: 10 }, { title: 'no id' }, 7] })).toEqual([
      { id: '1', title: 'T', url: 'https://e.test/', commentsUrl: 'https://news.ycombinator.com/item?id=1', score: 5, comments: 2, at: 10_000 },
    ])
    expect(parseHackerNews({ hits: [{ objectID: '2', title: 'Ask' }] })[0]!.url).toBe('https://news.ycombinator.com/item?id=2')
    expect(parseLobsters([{ short_id: 'ab', title: 'L', url: '', comments_url: 'https://lobste.rs/s/ab', tags: ['rust'], score: 3 }])[0]).toMatchObject({ url: 'https://lobste.rs/s/ab', meta: 'rust', score: 3 })
    const reddit = parseReddit({ data: { children: [
      { data: { id: 'r1', title: 'A &amp; B', permalink: '/r/x/1', url: 'https://img.test/a', score: 9 } },
      { data: { id: 'r2', title: 'Pinned', permalink: '/r/x/2', stickied: true } },
      { data: { id: 'r3', title: 'NSFW', permalink: '/r/x/3', over_18: true } },
      { data: { id: 'r4', title: 'Self', permalink: '/r/x/4', is_self: true, url: 'https://www.reddit.com/r/x/4' } },
    ] } })
    expect(reddit.map((r) => r.id)).toEqual(['r1', 'r4'])
    expect(reddit[0]!.title).toBe('A & B')
    expect(reddit[1]!.url).toBe('https://www.reddit.com/r/x/4')
    expect(parseReddit(null)).toEqual([])
  })

  it('merges newest first and dedupes', () => {
    const a = { id: 'a', title: 'a', url: 'https://1', at: 1 }
    const b = { id: 'b', title: 'b', url: 'https://2', at: 3 }
    expect(mergeFeeds([[a, b], [{ ...a, id: 'dup' }]], 10).map((i) => i.id)).toEqual(['b', 'a'])
    expect(mergeFeeds([[a, b]], 1)).toHaveLength(1)
  })

  it('validates inputs and builds URLs', () => {
    expect(safeLink('file:///etc/passwd')).toBeNull()
    expect(decodeEntities('&#x41;&#66;&lt;')).toBe('AB<')
    expect(cleanSubreddit('r/selfhosted')).toBe('selfhosted')
    expect(cleanSubreddit('../etc')).toBeNull()
    expect(redditUrl('x/../y', 'hot', 10)).toBeNull()
    expect(redditUrl('/r/rust', 'top', 10)).toBe('https://www.reddit.com/r/rust/top.json?limit=10&t=day&raw_json=1')
    expect(redditUrl('rust', 'evil', 5)).toContain('/hot.json')
    expect(lobstersUrl('new', '')).toBe('https://lobste.rs/newest.json')
    expect(lobstersUrl('hot', 'Rust')).toBe('https://lobste.rs/t/rust.json')
    expect(lobstersUrl('hot', '../x')).toBe('https://lobste.rs/hottest.json')
    expect(hackerNewsUrl('new', 5)).toBe('https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=5')
    expect(hackerNewsUrl('bogus', 5)).toContain('tags=front_page')
  })
})
