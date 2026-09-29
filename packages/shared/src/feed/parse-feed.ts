/**
 * Minimal, dependency-free RSS 2.0 / RSS 1.0 (RDF) / Atom parser plus HTML
 * helpers for autodiscovery and page-diff. Tolerant by design: feeds in the
 * wild are messy; anything unparseable returns null rather than throwing.
 */

export interface ParsedFeedItem {
  id: string
  title: string
  url?: string
  at?: number
  summary?: string
  author?: string
}

export interface ParsedFeed {
  format: 'rss' | 'atom'
  title?: string
  link?: string
  items: ParsedFeedItem[]
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return NAMED[e.toLowerCase()] ?? m
  })
}

function unCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

/** Strip tags + collapse whitespace; for summaries and page text. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim()
}

function tagText(block: string, names: string[]): string | undefined {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')
    const m = re.exec(block)
    if (m) {
      const v = unCdata(m[1]!).trim()
      if (v) return v
    }
  }
  return undefined
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : undefined
}

function parseDate(s: string | undefined): number | undefined {
  if (!s) return undefined
  const t = Date.parse(s.trim())
  return Number.isFinite(t) ? t : undefined
}

function clip(s: string | undefined, n = 280): string | undefined {
  if (!s) return undefined
  const text = htmlToText(s).replace(/\n+/g, ' ').trim()
  if (!text) return undefined
  return text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text
}

function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`, 'gi')
  return xml.match(re) ?? []
}

export function parseFeed(xml: string): ParsedFeed | null {
  if (!xml || typeof xml !== 'string') return null
  const head = xml.slice(0, 2048)
  if (/<feed[\s>]/i.test(head) || (/<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml))) {
    const feedOpen = /<feed[\s>]/i.exec(xml)
    if (!feedOpen) return null
    const header = xml.slice(feedOpen.index, (/<entry[\s>]/i.exec(xml)?.index ?? xml.length))
    const items: ParsedFeedItem[] = blocks(xml, 'entry').map((b) => {
      const links = b.match(/<link\b[^>]*>/gi) ?? []
      const alt = links.find((l) => !attr(l, 'rel') || attr(l, 'rel') === 'alternate') ?? links[0]
      const url = alt ? attr(alt, 'href') : undefined
      const title = decodeEntities(htmlToText(tagText(b, ['title']) ?? '')) || url || ''
      const id = decodeEntities(tagText(b, ['id']) ?? url ?? title)
      return {
        id,
        title,
        url,
        at: parseDate(tagText(b, ['published', 'updated'])),
        summary: clip(decodeEntities(tagText(b, ['summary', 'content', 'media:description']) ?? '')),
        author: tagText(tagText(b, ['author']) ?? '', ['name']) ? decodeEntities(tagText(tagText(b, ['author'])!, ['name'])!) : undefined,
      }
    })
    const hLinks = header.match(/<link\b[^>]*>/gi) ?? []
    const hAlt = hLinks.find((l) => !attr(l, 'rel') || attr(l, 'rel') === 'alternate')
    return {
      format: 'atom',
      title: tagText(header, ['title']) ? decodeEntities(htmlToText(tagText(header, ['title'])!)) : undefined,
      link: hAlt ? attr(hAlt, 'href') : undefined,
      items: items.filter((i) => i.title || i.url),
    }
  }
  if (/<rss[\s>]/i.test(xml) || /<rdf:RDF[\s>]/i.test(xml) || /<channel[\s>]/i.test(head)) {
    const channel = tagText(xml, ['channel']) ?? xml
    const firstItem = /<item[\s>]/i.exec(channel)?.index ?? channel.length
    const header = channel.slice(0, firstItem)
    const items: ParsedFeedItem[] = blocks(xml, 'item').map((b) => {
      const url = tagText(b, ['link']) ? decodeEntities(tagText(b, ['link'])!) : attr(/<link\b[^>]*>/i.exec(b)?.[0] ?? '', 'href')
      const guid = tagText(b, ['guid'])
      const title = decodeEntities(htmlToText(tagText(b, ['title']) ?? '')) || url || ''
      return {
        id: decodeEntities(guid ?? url ?? title),
        title,
        url,
        at: parseDate(tagText(b, ['pubDate', 'dc:date', 'published', 'updated'])),
        summary: clip(decodeEntities(tagText(b, ['description', 'content:encoded']) ?? '')),
        author: tagText(b, ['dc:creator', 'author']) ? decodeEntities(htmlToText(tagText(b, ['dc:creator', 'author'])!)) : undefined,
      }
    })
    return {
      format: 'rss',
      title: tagText(header, ['title']) ? decodeEntities(htmlToText(tagText(header, ['title'])!)) : undefined,
      link: tagText(header, ['link']) ? decodeEntities(tagText(header, ['link'])!) : undefined,
      items: items.filter((i) => i.title || i.url),
    }
  }
  return null
}

/** RSS/Atom autodiscovery: <link rel="alternate" type="application/rss+xml|atom+xml" href>. */
export function discoverFeedLinks(html: string, baseUrl: string): string[] {
  const out: string[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/)
    const type = (attr(tag, 'type') ?? '').toLowerCase()
    const href = attr(tag, 'href')
    if (!href || !rel.includes('alternate')) continue
    if (!/application\/(rss|atom|rdf)\+xml|application\/feed\+json|text\/xml/.test(type)) continue
    if (type.includes('json')) continue
    try {
      const abs = new URL(href, baseUrl).toString()
      if (!out.includes(abs)) out.push(abs)
    } catch {
      // ignore bad href
    }
  }
  return out
}

export function pageTitle(html: string): string | undefined {
  const og = /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*>/i.exec(html)?.[0]
  const ogv = og ? attr(og, 'content') : undefined
  if (ogv?.trim()) return ogv.trim()
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const v = t ? decodeEntities(htmlToText(t)).trim() : ''
  return v || undefined
}

/** Main readable text of a page for diffing (body only, capped). */
export function pageText(html: string, max = 40_000): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body)?.[2] ?? body
  const text = htmlToText(main.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' '))
  return text.slice(0, max)
}

/** Lines present in `next` but not in `prev` — the page-diff summary. */
export function addedLines(prev: string, next: string, limit = 5): string[] {
  const before = new Set(prev.split('\n').map((l) => l.trim()).filter(Boolean))
  const out: string[] = []
  for (const raw of next.split('\n')) {
    const l = raw.trim()
    if (l.length < 3 || before.has(l)) continue
    out.push(l.length > 200 ? `${l.slice(0, 199)}…` : l)
    if (out.length >= limit) break
  }
  return out
}

/** Small stable non-crypto hash (FNV-1a, hex) for change detection. */
export function textHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
