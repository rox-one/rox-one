import type { RankedSource, Reliability, SearchHit } from './types.ts'

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|ref|mc_)/i
const HIGH_HOSTS = /(\.gov|\.edu|wikipedia\.org|rfc-editor\.org|w3\.org|ietf\.org)$/i
const YEAR_RE = /\b(19|20)\d{2}\b/g

export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase()
    const params = new URLSearchParams(parsed.search)
    for (const key of [...params.keys()]) {
      if (TRACKING_PARAMS.test(key)) params.delete(key)
    }
    parsed.search = params.toString()
    let path = parsed.pathname
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    parsed.pathname = path
    return parsed.toString()
  } catch {
    return url.trim()
  }
}

export function sourceReliability(hit: {
  url: string
  primary?: boolean
  publishedAt?: string | null
}): Reliability {
  if (hit.primary) return 'high'
  try {
    const host = new URL(hit.url).hostname.replace(/^www\./i, '')
    if (HIGH_HOSTS.test(host)) return 'high'
    const https = hit.url.startsWith('https:')
    if (https && hit.publishedAt) return 'medium'
    if (!https) return 'low'
    return 'medium'
  } catch {
    return 'unknown'
  }
}

function yearsIn(text: string): Set<string> {
  return new Set(text.match(YEAR_RE) ?? [])
}

function sharedToken(a: string, b: string): boolean {
  const tokens = new Set(
    a
      .toLowerCase()
      .split(/[^a-zа-яё0-9]+/i)
      .filter((t) => t.length >= 5),
  )
  for (const token of b.toLowerCase().split(/[^a-zа-яё0-9]+/i)) {
    if (token.length >= 5 && tokens.has(token)) return true
  }
  return false
}

export function flagContradictions(sources: RankedSource[]): RankedSource[] {
  return sources.map((source) => {
    const years = yearsIn(`${source.title} ${source.snippet}`)
    if (years.size === 0) return { ...source, contradiction: false }
    const contradiction = sources.some((other) => {
      if (other.canonicalUrl === source.canonicalUrl) return false
      if (!sharedToken(source.snippet, other.snippet) && !sharedToken(source.title, other.title)) {
        return false
      }
      const otherYears = yearsIn(`${other.title} ${other.snippet}`)
      if (otherYears.size === 0) return false
      for (const year of years) {
        if (!otherYears.has(year)) return true
      }
      return false
    })
    return { ...source, contradiction }
  })
}

export function dedupeAndRank(
  hits: readonly SearchHit[],
  primaryUrls: ReadonlySet<string> = new Set(),
): RankedSource[] {
  const grouped = new Map<string, RankedSource>()
  for (const hit of hits) {
    if (!hit.url) continue
    const canonical = canonicalUrl(hit.url)
    const primary = primaryUrls.has(canonical) || primaryUrls.has(hit.url)
    const existing = grouped.get(canonical)
    if (existing) {
      if (!existing.queryIds.includes(hit.queryId)) existing.queryIds.push(hit.queryId)
      if (!existing.providers.includes(hit.provider)) existing.providers.push(hit.provider)
      if (primary) existing.primary = true
      if (!existing.publishedAt && hit.publishedAt) existing.publishedAt = hit.publishedAt
      if (hit.snippet.length > existing.snippet.length) existing.snippet = hit.snippet
      continue
    }
    grouped.set(canonical, {
      url: hit.url,
      canonicalUrl: canonical,
      title: hit.title || canonical,
      snippet: hit.snippet,
      publishedAt: hit.publishedAt ?? null,
      reliability: sourceReliability({ url: hit.url, primary, publishedAt: hit.publishedAt }),
      contradiction: false,
      queryIds: [hit.queryId],
      providers: [hit.provider],
      primary,
      rank: 0,
    })
  }

  const ranked = [...grouped.values()].sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1
    const rel = reliabilityWeight(b.reliability) - reliabilityWeight(a.reliability)
    if (rel !== 0) return rel
    return a.canonicalUrl.localeCompare(b.canonicalUrl)
  })

  const withRank = ranked.map((source, index) => ({ ...source, rank: index + 1 }))
  return flagContradictions(withRank)
}

function reliabilityWeight(value: Reliability): number {
  if (value === 'high') return 3
  if (value === 'medium') return 2
  if (value === 'low') return 1
  return 0
}
