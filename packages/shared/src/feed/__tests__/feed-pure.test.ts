import { describe, expect, it } from 'bun:test'
import {
  addedLines,
  buildAutomationRunItems,
  buildSessionFeedItems,
  detectFeedSource,
  discoverFeedLinks,
  mergeFeedItems,
  normalizeFeedUrl,
  pageText,
  pageTitle,
  parseFeed,
  textHash,
} from '../index'

describe('normalizeFeedUrl', () => {
  it('adds https and rejects junk', () => {
    expect(normalizeFeedUrl('example.com/blog')).toBe('https://example.com/blog')
    expect(normalizeFeedUrl('@jack')).toBe('https://x.com/jack')
    expect(normalizeFeedUrl('ftp://example.com')).toBeNull()
    expect(normalizeFeedUrl('not a url')).toBeNull()
    expect(normalizeFeedUrl('')).toBeNull()
  })
})

describe('detectFeedSource', () => {
  it('detects X profiles', () => {
    expect(detectFeedSource('https://twitter.com/rox_one')).toMatchObject({ kind: 'x', handle: 'rox_one', url: 'https://x.com/rox_one' })
    expect(detectFeedSource('x.com/home')?.handle).toBeUndefined()
  })
  it('derives YouTube feeds', () => {
    expect(detectFeedSource('https://www.youtube.com/channel/UC123')?.feedUrl).toBe('https://www.youtube.com/feeds/videos.xml?channel_id=UC123')
    expect(detectFeedSource('https://youtube.com/playlist?list=PL9')?.feedUrl).toContain('playlist_id=PL9')
    const handle = detectFeedSource('https://www.youtube.com/@veritasium')
    expect(handle?.kind).toBe('youtube')
    expect(handle?.feedUrl).toBeUndefined()
  })
  it('derives GitHub releases/user feeds', () => {
    expect(detectFeedSource('github.com/oven-sh/bun')).toMatchObject({ kind: 'github', feedUrl: 'https://github.com/oven-sh/bun/releases.atom' })
    expect(detectFeedSource('https://github.com/oven-sh/bun/commits/main')?.feedUrl).toBe('https://github.com/oven-sh/bun/commits.atom')
    expect(detectFeedSource('https://github.com/torvalds')?.feedUrl).toBe('https://github.com/torvalds.atom')
  })
  it('treats feed-looking paths as rss and others as unknown', () => {
    expect(detectFeedSource('https://blog.example.com/feed')?.kind).toBe('rss')
    expect(detectFeedSource('https://example.com/index.xml')?.feedUrl).toBe('https://example.com/index.xml')
    expect(detectFeedSource('https://example.com/news')?.kind).toBe('unknown')
  })
})

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog &amp; Co</title><link>https://b.example</link>
<item><title><![CDATA[Hello <b>world</b>]]></title><link>https://b.example/1</link><guid>g1</guid><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;First post&lt;/p&gt;</description><dc:creator>Ann</dc:creator></item>
<item><title>Second</title><link>https://b.example/2</link></item></channel></rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><link rel="alternate" href="https://github.com/o/r/releases"/>
<entry><id>tag:github.com,2008:Repository/1/v1.2.0</id><title>v1.2.0</title><updated>2026-09-27T12:00:00Z</updated><link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/v1.2.0"/><content type="html">&lt;p&gt;Fixes&lt;/p&gt;</content><author><name>octo</name></author></entry></feed>`

describe('parseFeed', () => {
  it('parses RSS 2.0', () => {
    const f = parseFeed(RSS)!
    expect(f.format).toBe('rss')
    expect(f.title).toBe('Blog & Co')
    expect(f.items).toHaveLength(2)
    expect(f.items[0]).toMatchObject({ id: 'g1', title: 'Hello world', url: 'https://b.example/1', summary: 'First post', author: 'Ann' })
    expect(f.items[0]!.at).toBe(Date.parse('2026-09-28T10:00:00Z'))
    expect(f.items[1]!.id).toBe('https://b.example/2')
  })
  it('parses Atom', () => {
    const f = parseFeed(ATOM)!
    expect(f.format).toBe('atom')
    expect(f.title).toBe('Releases')
    expect(f.items[0]).toMatchObject({ title: 'v1.2.0', url: 'https://github.com/o/r/releases/tag/v1.2.0', summary: 'Fixes', author: 'octo' })
  })
  it('returns null for HTML', () => {
    expect(parseFeed('<html><body>hi</body></html>')).toBeNull()
  })
})

describe('html helpers', () => {
  const html = `<html><head><title>Site</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="stylesheet" href="/a.css"></head>
<body><nav>menu</nav><main><h1>News</h1><p>One</p><script>x()</script></main></body></html>`
  it('discovers feeds relative to the page', () => {
    expect(discoverFeedLinks(html, 'https://s.example/blog/')).toEqual(['https://s.example/feed.xml'])
  })
  it('extracts title and readable text', () => {
    expect(pageTitle(html)).toBe('Site')
    const t = pageText(html)
    expect(t).toContain('News')
    expect(t).not.toContain('menu')
    expect(t).not.toContain('x()')
  })
  it('diffs pages by added lines and hashes stably', () => {
    expect(addedLines('a line\nold one', 'a line\nnew one\nold one')).toEqual(['new one'])
    expect(textHash('abc')).toBe(textHash('abc'))
    expect(textHash('abc')).not.toBe(textHash('abd'))
  })
})

describe('agent items + merge', () => {
  it('maps sessions with status and skips hidden/archived', () => {
    const items = buildSessionFeedItems([
      { id: 's1', name: 'Build', lastMessageAt: 3, isProcessing: true },
      { id: 's2', preview: 'Plan please', lastMessageAt: 2, lastMessageRole: 'plan' },
      { id: 's3', name: 'x', lastMessageAt: 5, hidden: true },
      { id: 's4', name: 'y', lastMessageAt: 4, isArchived: true },
      { id: 's5', name: 'Oops', lastMessageAt: 1, lastMessageRole: 'error' },
    ])
    expect(items.map((i) => [i.id, i.status])).toEqual([['session:s1', 'running'], ['session:s2', 'waiting'], ['session:s5', 'error']])
    expect(items[1]!.title).toBe('Plan please')
    expect(items.every((i) => i.tab === 'agents')).toBe(true)
  })
  it('maps automation runs with retry target and error', () => {
    const [bad, good] = buildAutomationRunItems([
      { id: 'a1', ts: 10, ok: true, sessionId: 's9', prompt: 'Daily digest' },
      { id: 'a2', ts: 20, ok: false, error: 'boom' },
    ], { a2: 'Nightly' }, 'ws')
    expect(bad).toMatchObject({ id: 'run:a2:20', title: 'Nightly', status: 'error', error: 'boom', automationId: 'a2' })
    expect(good).toMatchObject({ title: 'Daily digest', status: 'ok', sessionId: 's9', ref: { type: 'automation', id: 'a1', workspaceId: 'ws' } })
  })
  it('merges newest-first with first-wins dedupe and cap', () => {
    const a = { id: 'x', tab: 'news' as const, kind: 'news' as const, title: 'A', at: 1 }
    const b = { ...a, title: 'B', at: 9 }
    const c = { ...a, id: 'y', at: 5 }
    expect(mergeFeedItems([[a], [b, c]]).map((i) => i.title + i.at)).toEqual(['A5', 'A1'])
    expect(mergeFeedItems([[a, c]], 1)).toHaveLength(1)
  })
})
