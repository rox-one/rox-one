/**
 * URL decomposition shared by the ingest path and the unfurl worker.
 *
 * The pipeline stores both the raw URL Hindsight reported and a normalized form
 * used for deduplication, plus the domain used by every aggregation query. All
 * three come from here so `dim_urls` and the timeline rollups can never disagree
 * about what "the same URL" means.
 */

export interface UrlParts {
  /** Deduplication key: scheme + lowercased host + path + query + fragment. */
  normalizedUrl: string
  rawUrl: string
  scheme: string | null
  host: string | null
  /** Registrable-ish domain: host without a leading `www.`, lowercased. */
  domain: string | null
  path: string | null
  query: string | null
  fragment: string | null
}

/** Query parameter names that carry a user-typed search phrase. */
const SEARCH_QUERY_PARAMS = [
  'q',
  'query',
  'p',
  'search',
  'text',
  'keyword',
  'keywords',
  'wd',
  'k',
  'search_query',
  'sq',
  'qt',
] as const

/** Pages whose `q`-style parameter is a redirect target rather than a search. */
const NON_SEARCH_HOSTS = [
  'google.com',
  'google.ru',
  'bing.com',
  'duckduckgo.com',
  'yandex.ru',
  'yandex.com',
  'search.brave.com',
  'ecosia.org',
  'startpage.com',
  'perplexity.ai',
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'www.google.com',
] as const

export function describeUrl(rawUrl: string): UrlParts | null {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase() || null
  const domain = host ? host.replace(/^www\./, '') : null
  const path = parsed.pathname || null
  const query = parsed.search ? parsed.search.slice(1) : null
  const fragment = parsed.hash ? parsed.hash.slice(1) : null
  const normalizedUrl = `${parsed.protocol}//${host ?? ''}${path ?? ''}${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`
  return { normalizedUrl, rawUrl: trimmed, scheme: parsed.protocol.replace(/:$/, '') || null, host, domain, path, query, fragment }
}

/**
 * Best-effort search phrase for a visit.
 *
 * Hindsight's timeline does not surface Chrome's `keyword_search_terms` table,
 * so the phrase is recovered from the query parameters of the visited URL when
 * the host is a known search surface. Values are decoded and whitespace
 * collapsed; anything longer than {@link SEARCH_QUERY_MAX_LENGTH} is rejected so
 * an opaque payload is never mistaken for a human query.
 */
export const SEARCH_QUERY_MAX_LENGTH = 512

export function deriveSearchQuery(rawUrl: string): string | null {
  const parts = describeUrl(rawUrl)
  if (!parts?.query || !parts.domain) return null
  if (!(NON_SEARCH_HOSTS as readonly string[]).includes(parts.domain)) return null
  const params = new URLSearchParams(parts.query)
  for (const name of SEARCH_QUERY_PARAMS) {
    const value = params.get(name)
    if (!value) continue
    let decoded = value
    if (/%[0-9a-f]{2}/i.test(decoded)) {
      try {
        decoded = decodeURIComponent(decoded)
      } catch {
        // Keep the raw value: a malformed escape is still evidence of intent.
      }
    }
    decoded = decoded.replace(/\+/g, ' ').replace(/\s+/g, ' ').trim()
    if (decoded.length === 0 || decoded.length > SEARCH_QUERY_MAX_LENGTH) continue
    return decoded
  }
  return null
}