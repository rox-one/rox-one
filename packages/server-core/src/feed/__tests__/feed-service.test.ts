import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FEED_STATE_FILE, FeedService } from '../feed-service'
import { createXApiAdapter, notConnectedXAdapter, type XSubscriptionsAdapter } from '../x-adapter'

type Route = { status?: number; body: string; type?: string; etag?: string }

function fakeFetch(routes: Record<string, Route | (() => Route)>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const r0 = routes[url]
    const r = typeof r0 === 'function' ? r0() : r0
    if (!r) return new Response('nope', { status: 404 })
    const headers: Record<string, string> = { 'content-type': r.type ?? 'text/html' }
    if (r.etag) headers.etag = r.etag
    return new Response(r.status === 304 ? null : r.body, { status: r.status ?? 200, headers })
  }
  return { impl, calls }
}

const RSS = (n: number) => `<rss><channel><title>Blog</title>${Array.from({ length: n }, (_, i) => `<item><title>Post ${i}</title><link>https://b.example/${i}</link><guid>p${i}</guid><pubDate>Mon, 28 Sep 2026 1${i}:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'feed-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function make(routes: Record<string, Route | (() => Route)>, x: XSubscriptionsAdapter = notConnectedXAdapter, now = () => Date.parse('2026-09-29T12:00:00Z')) {
  const f = fakeFetch(routes)
  let changes = 0
  const svc = new FeedService({ configDir: dir, fetch: f.impl as never, now, getXAdapter: async () => x, onChange: () => { changes++ } })
  return { svc, calls: f.calls, changes: () => changes }
}

describe('FeedService', () => {
  it('rejects invalid and duplicate URLs', () => {
    const { svc } = make({})
    expect(svc.addSource('nonsense')).toEqual({ ok: false, error: 'invalid-url' })
    expect(svc.addSource('https://b.example/feed').ok).toBe(true)
    expect(svc.addSource('b.example/feed/')).toEqual({ ok: false, error: 'duplicate' })
  })

  it('polls a direct RSS feed, dedupes and persists', async () => {
    const { svc, changes } = make({ 'https://b.example/feed': { body: RSS(2), type: 'application/rss+xml', etag: '"v1"' } })
    const res = svc.addSource('https://b.example/feed', 30)
    if (!res.ok) throw new Error('add failed')
    await svc.pollSource(res.source.id)
    await svc.pollSource(res.source.id)
    const src = svc.listSources()[0]!
    expect(src).toMatchObject({ kind: 'rss', title: 'Blog', lastStatus: 'ok', intervalMin: 30, itemCount: 2 })
    expect(svc.listItems().map((i) => i.title)).toEqual(['Post 1', 'Post 0'])
    expect(svc.listItems()[0]).toMatchObject({ tab: 'news', kind: 'news', url: 'https://b.example/1', sourceTitle: 'Blog' })
    expect(changes()).toBeGreaterThan(0)
    const persisted = JSON.parse(readFileSync(join(dir, FEED_STATE_FILE), 'utf-8'))
    expect(persisted.items).toHaveLength(2)
    // private validators never leak to the renderer
    expect((src as unknown as Record<string, unknown>).etag).toBeUndefined()
  })

  it('sends conditional headers and handles 304', async () => {
    let n = 0
    const { svc, calls } = make({ 'https://b.example/feed': () => (n++ === 0 ? { body: RSS(1), etag: '"v1"' } : { status: 304, body: '' }) })
    const res = svc.addSource('https://b.example/feed')
    if (!res.ok) throw new Error()
    await svc.pollSource(res.source.id)
    await svc.pollSource(res.source.id)
    expect(calls.filter((c) => c.url === 'https://b.example/feed').at(-1)!.headers['if-none-match']).toBe('"v1"')
    expect(svc.listSources()[0]!.lastStatus).toBe('ok')
  })

  it('autodiscovers the feed from an HTML page', async () => {
    const { svc } = make({
      'https://s.example/': { body: '<html><head><title>Site</title><link rel="alternate" type="application/atom+xml" href="/atom.xml"></head><body>x</body></html>' },
      'https://s.example/atom.xml': { body: '<feed xmlns="http://www.w3.org/2005/Atom"><title>Site feed</title><entry><id>e1</id><title>Entry</title><link href="https://s.example/e1"/><updated>2026-09-28T00:00:00Z</updated></entry></feed>' },
    })
    const res = svc.addSource('s.example')
    if (!res.ok) throw new Error()
    await svc.pollSource(res.source.id)
    expect(svc.listSources()[0]).toMatchObject({ kind: 'atom', feedUrl: 'https://s.example/atom.xml', title: 'Site' })
    expect(svc.listItems()[0]!.title).toBe('Entry')
  })

  it('falls back to page diff when no feed exists', async () => {
    let body = '<html><head><title>Changelog</title></head><body><main><p>v1 released</p></main></body></html>'
    const { svc } = make({ 'https://p.example/changes': () => ({ body }) })
    const res = svc.addSource('https://p.example/changes')
    if (!res.ok) throw new Error()
    await svc.pollSource(res.source.id)
    expect(svc.listItems()).toHaveLength(0) // first fetch = baseline
    expect(svc.listSources()[0]!.kind).toBe('page')
    body = body.replace('<p>v1 released</p>', '<p>v2 released</p><p>v1 released</p>')
    await svc.pollSource(res.source.id)
    const [item] = svc.listItems()
    expect(item).toMatchObject({ kind: 'page-change', title: 'Changelog', summary: 'v2 released', tab: 'news' })
  })

  it('reports HTTP errors and keeps the source', async () => {
    const { svc } = make({ 'https://b.example/feed': { status: 500, body: '' } })
    const res = svc.addSource('https://b.example/feed')
    if (!res.ok) throw new Error()
    await svc.pollSource(res.source.id)
    expect(svc.listSources()[0]).toMatchObject({ lastStatus: 'error', lastError: 'http-500' })
  })

  it('marks X sources unsupported without a token (no scraping)', async () => {
    const { svc, calls } = make({})
    const res = svc.addSource('https://x.com/rox_one')
    if (!res.ok) throw new Error()
    await svc.pollSource(res.source.id)
    expect(svc.listSources()[0]).toMatchObject({ kind: 'x', lastStatus: 'unsupported', lastError: 'x-not-connected' })
    expect(calls).toHaveLength(0)
    expect(await svc.xStatus()).toEqual({ state: 'not-connected' })
  })

  it('pulls the X home timeline into «Подписки» with a token', async () => {
    const api = fakeFetch({
      'https://api.x.com/2/users/me': { body: JSON.stringify({ data: { id: '1', username: 'mark' } }) },
      'https://api.x.com/2/users/1/timelines/reverse_chronological?max_results=50&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,name': {
        body: JSON.stringify({ data: [{ id: '99', text: 'hello', author_id: '2', created_at: '2026-09-29T08:00:00Z' }], includes: { users: [{ id: '2', name: 'Ann', username: 'ann' }] } }),
      },
    })
    const x = createXApiAdapter('tok', api.impl as never)
    const { svc } = make({}, x)
    await svc.pollX()
    expect(svc.listItems()[0]).toMatchObject({ id: 'x:99', tab: 'subscriptions', kind: 'x-post', title: 'hello', author: 'Ann @ann', url: 'https://x.com/ann/status/99' })
    expect((await svc.xStatus()).state).toBe('connected')
    expect(api.calls[0]!.headers.authorization).toBe('Bearer tok')
  })

  it('removes a source with its items and respects intervals', async () => {
    const { svc } = make({ 'https://b.example/feed': { body: RSS(1) } })
    const res = svc.addSource('https://b.example/feed', 60)
    if (!res.ok) throw new Error()
    await svc.pollSource(res.source.id)
    const s = svc.listSources()[0]!
    expect(svc.isDue(s, s.lastFetchAt! + 59 * 60_000)).toBe(false)
    expect(svc.isDue(s, s.lastFetchAt! + 60 * 60_000)).toBe(true)
    expect(svc.updateSource(s.id, { intervalMin: 1 })!.intervalMin).toBe(5)
    expect(svc.removeSource(s.id)).toBe(true)
    expect(svc.listItems()).toHaveLength(0)
  })
  it('rejects an add when the durable state cannot be written and allows a retry', async () => {
    const { svc, calls, changes } = make({ 'https://b.example/feed': { body: RSS(1) } })
    mkdirSync(join(dir, FEED_STATE_FILE))
    expect(() => svc.addSource('https://b.example/feed')).toThrow()
    expect(svc.listSources()).toHaveLength(0)
    expect(changes()).toBe(0)
    expect(calls).toHaveLength(0)
    rmSync(join(dir, FEED_STATE_FILE), { recursive: true, force: true })

    const retry = svc.addSource('https://b.example/feed')
    expect(retry.ok).toBe(true)
    if (retry.ok) await svc.pollSource(retry.source.id)
    expect(new FeedService({ configDir: dir }).listSources()).toHaveLength(1)
  })

  it('deduplicates repeated ids from one poll response', async () => {
    const repeated = `<rss><channel><title>Blog</title><item><title>First</title><guid>same</guid></item><item><title>Duplicate</title><guid>same</guid></item></channel></rss>`
    const { svc } = make({ 'https://b.example/feed': { body: repeated } })
    const source = svc.addSource('https://b.example/feed')
    if (!source.ok) throw new Error()
    await svc.pollSource(source.source.id)
    expect(svc.listItems()).toHaveLength(1)
  })

  it('propagates poll persistence failure without losing prior memory or notifying', async () => {
    const { svc, changes } = make({ 'https://b.example/feed': { body: RSS(1) } })
    const source = svc.addSource('https://b.example/feed')
    if (!source.ok) throw new Error()
    await svc.pollSource(source.source.id)
    const before = svc.listItems()
    const stateFile = join(dir, FEED_STATE_FILE)
    const backupFile = `${stateFile}.backup`
    renameSync(stateFile, backupFile)
    mkdirSync(stateFile)
    const notifiedBefore = changes()
    await expect(svc.refresh(source.source.id)).rejects.toThrow()
    expect(svc.listItems()).toEqual(before)
    expect(changes()).toBe(notifiedBefore)
    rmSync(stateFile, { recursive: true, force: true })
    renameSync(backupFile, stateFile)
    expect(new FeedService({ configDir: dir }).listItems()).toEqual(before)
    await svc.refresh(source.source.id)
  })

  it('reports checking transitions without reporting a failed poll as a durable change', async () => {
    let releaseFetch!: () => void
    const blocked = new Promise<void>((resolve) => { releaseFetch = resolve })
    const checking: boolean[] = []
    let changes = 0
    const svc = new FeedService({
      configDir: dir,
      fetch: async () => {
        await blocked
        return new Response(RSS(1), { headers: { 'content-type': 'application/rss+xml' } })
      },
      onChange: () => { changes++ },
      onStatusChange: () => { checking.push(svc.listSources()[0]?.checking === true) },
    })
    const source = svc.addSource('https://b.example/feed')
    if (!source.ok) throw new Error('add failed')
    const poll = svc.pollSource(source.source.id)
    const stateFile = join(dir, FEED_STATE_FILE)
    const backupFile = `${stateFile}.backup`
    renameSync(stateFile, backupFile)
    mkdirSync(stateFile)
    releaseFetch()
    await expect(poll).rejects.toThrow()
    expect(checking).toEqual([true, false])
    expect(changes).toBe(1)
    expect(svc.listSources()[0]).toMatchObject({ id: source.source.id, lastStatus: 'pending' })
    expect(svc.listItems()).toEqual([])
    rmSync(stateFile, { recursive: true, force: true })
    renameSync(backupFile, stateFile)
    expect(new FeedService({ configDir: dir }).listSources()[0]).toMatchObject({ id: source.source.id, lastStatus: 'pending' })
  })

  it('keeps a concurrent source edit when a poll commits', async () => {
    let releaseFetch!: () => void
    let notifyStarted!: () => void
    const started = new Promise<void>((resolve) => { notifyStarted = resolve })
    const blocked = new Promise<void>((resolve) => { releaseFetch = resolve })
    const svc = new FeedService({
      configDir: dir,
      fetch: async () => {
        notifyStarted()
        await blocked
        return new Response(RSS(1), { headers: { 'content-type': 'application/rss+xml' } })
      },
    })
    const source = svc.addSource('https://b.example/feed')
    if (!source.ok) throw new Error()
    await started
    svc.updateSource(source.source.id, { title: 'Concurrent edit', intervalMin: 30 })
    releaseFetch()
    await svc.pollSource(source.source.id)
    expect(svc.listSources()[0]).toMatchObject({ title: 'Concurrent edit', intervalMin: 30, lastStatus: 'ok' })
    expect(svc.listItems()).toHaveLength(1)
  })
})
