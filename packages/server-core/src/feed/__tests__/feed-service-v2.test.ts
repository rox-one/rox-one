import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FEED_STATE_FILE, FeedService } from '../feed-service'

type Route = { status?: number; body: string; type?: string }
const RSS = `<rss><channel><title>Blog</title><item><title>Post A</title><link>https://b.example/a</link><guid>a</guid><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate></item><item><title>Post B</title><link>https://b.example/b</link><guid>b</guid></item></channel></rss>`

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'feed2-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function make(routes: Record<string, Route>) {
  const calls: string[] = []
  const impl = async (url: string) => {
    calls.push(url)
    const r = routes[url]
    if (!r) return new Response('nope', { status: 404 })
    return new Response(r.body, { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'text/html' } })
  }
  const svc = new FeedService({ configDir: dir, fetch: impl as never, now: () => Date.parse('2026-09-29T12:00:00Z') })
  return { svc, calls }
}

describe('FeedService v2 (labels, preview, pause)', () => {
  it('loads a v1 file unchanged and writes v2 with annotations', () => {
    writeFileSync(join(dir, FEED_STATE_FILE), JSON.stringify({ version: 1, sources: [{ id: 's', url: 'https://b.example/feed', kind: 'rss', intervalMin: 60, addedAt: 1, lastStatus: 'ok' }], items: [{ id: 'news:s:1', tab: 'news', kind: 'news', title: 'x', at: 5, sourceId: 's' }] }))
    const { svc } = make({})
    expect(svc.listSources()).toHaveLength(1)
    expect(svc.listAnnotations()).toEqual({})
    svc.annotate(['news:s:1'], { color: 'red', tags: [' #важное ', 'Важное', 'idea'], starred: true, read: true })
    const persisted = JSON.parse(readFileSync(join(dir, FEED_STATE_FILE), 'utf-8'))
    expect(persisted.version).toBe(2)
    expect(persisted.items).toHaveLength(1)
    expect(persisted.annotations['news:s:1']).toMatchObject({ color: 'red', tags: ['важное', 'idea'], starred: true })
    expect(typeof persisted.annotations['news:s:1'].readAt).toBe('number')
  })

  it('clears annotations and drops invalid values', () => {
    const { svc } = make({})
    svc.annotate(['i1'], { color: 'red', starred: true })
    svc.annotate(['i1'], { color: null, starred: false })
    expect(svc.listAnnotations()).toEqual({})
    svc.annotate(['i2'], { color: 'pink' as never, tags: 'nope' as never })
    expect(svc.listAnnotations()).toEqual({})
  })

  it('stores source color, default tags and pause; paused sources are not polled by tick', async () => {
    const { svc, calls } = make({ 'https://b.example/feed': { body: RSS, type: 'application/rss+xml' } })
    const res = svc.addSource('https://b.example/feed', { intervalMin: 30, title: 'Мой блог', color: 'green', tags: ['blog'] })
    if (!res.ok) throw new Error('add failed')
    expect(res.source).toMatchObject({ title: 'Мой блог', color: 'green', tags: ['blog'], intervalMin: 30 })
    await svc.pollSource(res.source.id)
    expect(svc.listSources()[0]).toMatchObject({ lastStatus: 'ok', itemCount: 2 })
    expect(svc.listSources()[0]!.lastOkAt).toBeNumber()
    expect(svc.listSources()[0]!.checking).toBeUndefined()
    svc.updateSource(res.source.id, { paused: true, color: null, tags: [] })
    const s = svc.listSources()[0]!
    expect(s.paused).toBe(true)
    expect(s.color).toBeUndefined()
    expect(s.tags).toBeUndefined()
    const before = calls.length
    await svc.tick()
    expect(calls.length).toBe(before)
  })

  it('previews a feed without saving anything', async () => {
    const { svc } = make({ 'https://b.example/feed': { body: RSS, type: 'application/rss+xml' } })
    const p = await svc.preview('b.example/feed')
    expect(p).toMatchObject({ ok: true, kind: 'rss', title: 'Blog', via: 'feed', itemCount: 2, duplicate: false })
    if (p.ok) expect(p.items.map((i) => i.title)).toEqual(['Post A', 'Post B'])
    expect(svc.listSources()).toHaveLength(0)
  })

  it('previews via autodiscovery, page fallback, errors and duplicates', async () => {
    const html = `<html><head><title>Site</title><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head><body>hi</body></html>`
    const { svc } = make({
      'https://s.example/': { body: html },
      'https://s.example/rss.xml': { body: RSS, type: 'application/rss+xml' },
      'https://p.example/': { body: '<html><head><title>Plain</title></head><body><p>A long enough paragraph of page text here.</p></body></html>' },
    })
    expect(await svc.preview('https://s.example/')).toMatchObject({ ok: true, via: 'autodiscovery', feedUrl: 'https://s.example/rss.xml', itemCount: 2 })
    expect(await svc.preview('https://p.example/')).toMatchObject({ ok: true, kind: 'page', via: 'page', title: 'Plain' })
    expect(await svc.preview('https://missing.example/x')).toMatchObject({ ok: false, error: 'http-404' })
    expect(await svc.preview('nonsense')).toMatchObject({ ok: false, error: 'invalid-url' })
    expect(await svc.preview('https://x.com/jack')).toMatchObject({ ok: false, error: 'x-not-connected', kind: 'x' })
    svc.addSource('https://s.example/')
    expect(await svc.preview('https://s.example')).toMatchObject({ duplicate: true })
  })

  it('removing a source drops its annotations', () => {
    const { svc } = make({})
    const res = svc.addSource('https://b.example/feed')
    if (!res.ok) throw new Error('add failed')
    svc.annotate([`news:${res.source.id}:abc`, 'session:1'], { starred: true })
    svc.removeSource(res.source.id)
    expect(Object.keys(svc.listAnnotations())).toEqual(['session:1'])
  })
  it('keeps the prior durable and in-memory annotations when an annotation write fails', () => {
    const { svc } = make({})
    svc.annotate(['item-1'], { starred: true })
    const stateFile = join(dir, FEED_STATE_FILE)
    const backupFile = `${stateFile}.backup`
    renameSync(stateFile, backupFile)
    mkdirSync(stateFile)
    expect(() => svc.annotate(['item-1'], { starred: false, read: true })).toThrow()
    expect(svc.listAnnotations()['item-1']).toEqual({ starred: true })
    rmSync(stateFile, { recursive: true, force: true })
    renameSync(backupFile, stateFile)
    expect(new FeedService({ configDir: dir }).listAnnotations()['item-1']).toEqual({ starred: true })
    expect(svc.annotate(['item-1'], { starred: false, read: true })).toBe(1)
    expect(svc.listAnnotations()['item-1']?.readAt).toBeNumber()
  })

  it('does not expose source updates or removals when their state writes fail', () => {
    writeFileSync(join(dir, FEED_STATE_FILE), JSON.stringify({
      version: 2,
      sources: [{ id: 'source-1', url: 'https://b.example/feed', kind: 'rss', intervalMin: 60, addedAt: 1, lastStatus: 'ok' }],
      items: [],
      annotations: {},
    }))
    const { svc } = make({})
    expect(svc.listSources().map((source) => source.id)).toEqual(['source-1'])
    const stateFile = join(dir, FEED_STATE_FILE)
    const backupFile = `${stateFile}.backup`
    renameSync(stateFile, backupFile)
    mkdirSync(stateFile)
    expect(() => svc.updateSource('source-1', { title: 'Not saved' })).toThrow()
    expect(svc.listSources()[0]?.title).toBeUndefined()
    rmSync(stateFile, { recursive: true, force: true })
    renameSync(backupFile, stateFile)

    renameSync(stateFile, backupFile)
    mkdirSync(stateFile)
    expect(() => svc.removeSource('source-1')).toThrow()
    expect(svc.listSources()).toHaveLength(1)
    rmSync(stateFile, { recursive: true, force: true })
    renameSync(backupFile, stateFile)
    expect(new FeedService({ configDir: dir }).listSources()).toHaveLength(1)
  })
})
