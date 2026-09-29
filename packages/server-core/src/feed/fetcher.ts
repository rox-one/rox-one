/**
 * Bounded HTTP GET for the feed poller: timeout, size cap, conditional
 * requests (ETag / Last-Modified). No cookies, no credentials — sources are
 * fetched anonymously; X goes through the API adapter instead.
 */

export interface FetchTextResult {
  status: number
  notModified: boolean
  text: string
  contentType: string
  finalUrl: string
  etag?: string
  lastModified?: string
}

export interface FetchTextOptions {
  etag?: string
  lastModified?: string
  timeoutMs?: number
  maxBytes?: number
  headers?: Record<string, string>
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export const FEED_USER_AGENT = 'Mozilla/5.0 (compatible; RoxFeed/1.0; +https://rox.one)'

export async function fetchText(url: string, opts: FetchTextOptions = {}, fetchImpl: FetchLike = fetch): Promise<FetchTextResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000)
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024
  try {
    const headers: Record<string, string> = {
      'user-agent': FEED_USER_AGENT,
      accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
      ...(opts.headers ?? {}),
    }
    if (opts.etag) headers['if-none-match'] = opts.etag
    if (opts.lastModified) headers['if-modified-since'] = opts.lastModified
    const res = await fetchImpl(url, { headers, redirect: 'follow', signal: ctrl.signal, credentials: 'omit' })
    const base = {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      finalUrl: res.url || url,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    }
    if (res.status === 304) return { ...base, notModified: true, text: '' }
    if (!res.ok) return { ...base, notModified: false, text: '' }
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > maxBytes) throw new Error(`too-large:${declared}`)
    let text: string
    if (res.body && typeof (res.body as ReadableStream<Uint8Array>).getReader === 'function') {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel().catch(() => {})
          break
        }
        chunks.push(value)
      }
      const buf = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
      let off = 0
      for (const c of chunks) { buf.set(c, off); off += c.byteLength }
      text = new TextDecoder('utf-8').decode(buf)
    } else {
      text = (await res.text()).slice(0, maxBytes)
    }
    return { ...base, notModified: false, text }
  } finally {
    clearTimeout(timer)
  }
}
