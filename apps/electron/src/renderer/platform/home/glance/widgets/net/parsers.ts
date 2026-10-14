/**
 * Pure, dependency-free parsers for network widgets. Inputs are untrusted:
 * every field is type-checked, strings are length-capped and only http(s)
 * links survive.
 */

export interface FeedItem {
  id: string
  title: string
  url: string
  /** Epoch ms, when known. */
  at?: number
  /** Secondary line: source, author, score… */
  meta?: string
  /** Discussion link (HN/Lobsters/Reddit comments). */
  commentsUrl?: string
  score?: number
  comments?: number
}

const MAX_TITLE = 300

export function safeLink(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = base ? new URL(value.trim(), base) : new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function str(v: unknown, max = MAX_TITLE): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ---------------------------------------------------------------------------
// RSS 2.0 / Atom (regex-based extractor; no DOM needed, works in tests)
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function inner(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const m = block.match(re)
  if (!m) return null
  const raw = m[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
  return decodeEntities(stripTags(raw))
}

function attr(block: string, tag: string, name: string, where?: (tagText: string) => boolean): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'gi')
  for (const m of block.matchAll(re)) {
    if (where && !where(m[0])) continue
    const a = m[0].match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
    if (a) return decodeEntities(a[2] ?? a[3] ?? '')
  }
  return null
}

function parseDate(text: string | null): number | undefined {
  if (!text) return undefined
  const t = Date.parse(text)
  return Number.isFinite(t) ? t : undefined
}

export function parseFeed(xml: string, sourceUrl: string, limit = 50): { title: string; items: FeedItem[] } {
  if (typeof xml !== 'string' || xml.length > 5_000_000) return { title: '', items: [] }
  const atom = /<feed\b/i.test(xml) && !/<rss\b/i.test(xml)
  const blocks = xml.match(atom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi) ?? []
  const channel = xml.replace(atom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi, '')
  const feedTitle = str(inner(channel, 'title') ?? '', 120)
  const items: FeedItem[] = []
  for (const block of blocks.slice(0, limit)) {
    const title = str(inner(block, 'title') ?? '')
    const link = atom
      ? safeLink(attr(block, 'link', 'href', (t) => !/rel\s*=\s*["'](?!alternate)/i.test(t)), sourceUrl)
      : safeLink(inner(block, 'link') ?? attr(block, 'link', 'href'), sourceUrl)
    if (!title || !link) continue
    const at = parseDate(inner(block, atom ? 'updated' : 'pubDate') ?? inner(block, 'published') ?? inner(block, 'dc:date'))
    const id = str(inner(block, atom ? 'id' : 'guid') ?? '', 300) || link
    const comments = safeLink(inner(block, 'comments'), sourceUrl)
    items.push({ id, title, url: link, ...(at !== undefined ? { at } : {}), ...(feedTitle ? { meta: feedTitle } : {}), ...(comments ? { commentsUrl: comments } : {}) })
  }
  return { title: feedTitle, items }
}

// ---------------------------------------------------------------------------
// Hacker News (Algolia search API), Lobsters, Reddit
// ---------------------------------------------------------------------------

export function parseHackerNews(raw: unknown): FeedItem[] {
  const hits = isRecord(raw) && Array.isArray(raw.hits) ? raw.hits : []
  const out: FeedItem[] = []
  for (const h of hits) {
    if (!isRecord(h)) continue
    const id = str(h.objectID, 40)
    const title = str(h.title)
    if (!id || !title) continue
    const discuss = `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`
    const at = num(h.created_at_i)
    out.push({
      id,
      title,
      url: safeLink(h.url) ?? discuss,
      commentsUrl: discuss,
      ...(num(h.points) !== undefined ? { score: num(h.points) } : {}),
      ...(num(h.num_comments) !== undefined ? { comments: num(h.num_comments) } : {}),
      ...(at !== undefined ? { at: at * 1000 } : {}),
      ...(str(h.author, 40) ? { meta: str(h.author, 40) } : {}),
    })
  }
  return out
}

export function parseLobsters(raw: unknown): FeedItem[] {
  const list = Array.isArray(raw) ? raw : []
  const out: FeedItem[] = []
  for (const s of list) {
    if (!isRecord(s)) continue
    const id = str(s.short_id, 20)
    const title = str(s.title)
    const discuss = safeLink(s.comments_url) ?? safeLink(s.short_id_url)
    if (!id || !title || !discuss) continue
    const tags = Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string').slice(0, 4) : []
    const at = parseDate(typeof s.created_at === 'string' ? s.created_at : null)
    out.push({
      id,
      title,
      url: safeLink(s.url) ?? discuss,
      commentsUrl: discuss,
      ...(num(s.score) !== undefined ? { score: num(s.score) } : {}),
      ...(num(s.comment_count) !== undefined ? { comments: num(s.comment_count) } : {}),
      ...(at !== undefined ? { at } : {}),
      ...(tags.length ? { meta: tags.join(' · ') } : {}),
    })
  }
  return out
}

export function parseReddit(raw: unknown): FeedItem[] {
  const children = isRecord(raw) && isRecord(raw.data) && Array.isArray(raw.data.children) ? raw.data.children : []
  const out: FeedItem[] = []
  for (const c of children) {
    const d = isRecord(c) && isRecord(c.data) ? c.data : null
    if (!d || d.stickied === true || d.over_18 === true) continue
    const id = str(d.id, 20)
    const title = str(d.title)
    const permalink = typeof d.permalink === 'string' && d.permalink.startsWith('/') ? `https://www.reddit.com${d.permalink}` : null
    if (!id || !title || !permalink) continue
    const at = num(d.created_utc)
    out.push({
      id,
      title: decodeEntities(title),
      url: d.is_self === true ? permalink : safeLink(d.url) ?? permalink,
      commentsUrl: permalink,
      ...(num(d.score) !== undefined ? { score: num(d.score) } : {}),
      ...(num(d.num_comments) !== undefined ? { comments: num(d.num_comments) } : {}),
      ...(at !== undefined ? { at: at * 1000 } : {}),
      ...(str(d.subreddit_name_prefixed, 60) ? { meta: str(d.subreddit_name_prefixed, 60) } : {}),
    })
  }
  return out
}

/** Merge several lists newest-first, dedupe by url, cap. */
export function mergeFeeds(lists: readonly FeedItem[][], limit: number): FeedItem[] {
  const seen = new Set<string>()
  const all = lists.flat().sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  const out: FeedItem[] = []
  for (const item of all) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    out.push(item)
    if (out.length >= limit) break
  }
  return out
}

/** Subreddit names: letters, digits, underscore; 2–21 chars. */
export function cleanSubreddit(value: string): string | null {
  const name = value.trim().replace(/^\/?r\//i, '')
  return /^[A-Za-z0-9_]{2,21}$/.test(name) ? name : null
}
