import {
  DEFAULT_RESEARCH_CAPS,
  RESEARCH_CAP_CEILING,
  type PlannedQuery,
  type ResearchCaps,
  type ResearchPlan,
  type ResearchProviderId,
  type ResearchRequest,
} from './types.ts'

const URL_RE = /https?:\/\/[^\s<>)"']+/gi
const MAX_LANGUAGES = 3
const MAX_DOMAINS = 3
const MAX_DORKS = 2

export function clampResearchCaps(input?: Partial<ResearchCaps>): ResearchCaps {
  const pick = (key: keyof ResearchCaps, fallback: number): number => {
    const raw = input?.[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return fallback
    return Math.min(Math.floor(raw), RESEARCH_CAP_CEILING[key])
  }
  return {
    maxQueries: pick('maxQueries', DEFAULT_RESEARCH_CAPS.maxQueries),
    maxResultsPerQuery: pick('maxResultsPerQuery', DEFAULT_RESEARCH_CAPS.maxResultsPerQuery),
    maxTotalResults: pick('maxTotalResults', DEFAULT_RESEARCH_CAPS.maxTotalResults),
    maxCostUnits: pick('maxCostUnits', DEFAULT_RESEARCH_CAPS.maxCostUnits),
    timeoutMs: pick('timeoutMs', DEFAULT_RESEARCH_CAPS.timeoutMs),
  }
}

export function extractReferencedUrls(message: string, extra: readonly string[] = []): string[] {
  const found = message.match(URL_RE) ?? []
  const all = [...extra, ...found]
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of all) {
    const url = raw.replace(/[.,;]+$/, '')
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

export function inferTopicLanguage(message: string): string {
  if (/[а-яё]/i.test(message)) return 'ru'
  if (/[\u4e00-\u9fff]/.test(message)) return 'zh'
  return 'en'
}

export function stripUrls(message: string): string {
  return message.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim()
}

function uniqueTrimmed(values: readonly string[] | undefined, limit: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values ?? []) {
    const next = value.trim()
    if (!next || seen.has(next)) continue
    seen.add(next)
    out.push(next)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Evidence planner: primary-source URLs first, then bounded multilingual /
 * domain / dork queries. Caps are explicit; fan-out is never 10–15×50.
 */
export function planEvidenceSearch(request: ResearchRequest): ResearchPlan {
  const caps = clampResearchCaps(request.caps)
  const urls = extractReferencedUrls(request.message, request.referencedUrls)
  const topic = stripUrls(request.message)
  const inferred = inferTopicLanguage(request.message)
  const languages = uniqueTrimmed(
    [inferred, ...(request.languages ?? [])],
    MAX_LANGUAGES,
  )
  const domains = uniqueTrimmed(request.domains, MAX_DOMAINS)
  const dorks = uniqueTrimmed(request.dorks, MAX_DORKS)
  const webProvider: Exclude<ResearchProviderId, 'primary_url'> =
    request.preferredProvider ?? 'exa'

  const queries: PlannedQuery[] = []
  let cost = 0
  let truncated = false
  let truncateReason: ResearchPlan['truncateReason']

  const tryPush = (query: PlannedQuery): boolean => {
    if (queries.length >= caps.maxQueries) {
      truncated = true
      truncateReason = 'query_cap'
      return false
    }
    if (cost + query.costUnits > caps.maxCostUnits) {
      truncated = true
      truncateReason = 'cost_cap'
      return false
    }
    queries.push(query)
    cost += query.costUnits
    return true
  }

  let seq = 0
  const nextId = (kind: string) => `${kind}-${++seq}`

  for (const url of urls) {
    const ok = tryPush({
      id: nextId('primary'),
      kind: 'primary_url',
      query: url,
      costUnits: 1,
      provider: 'primary_url',
      primary: true,
    })
    if (!ok) break
  }

  if (topic) {
    for (const language of languages) {
      const query = language === inferred ? topic : `${topic} ${language}`
      const ok = tryPush({
        id: nextId('lang'),
        kind: 'multilingual',
        query,
        language,
        costUnits: 1,
        provider: webProvider,
        primary: false,
      })
      if (!ok) break
    }

    for (const domain of domains) {
      const ok = tryPush({
        id: nextId('domain'),
        kind: 'domain',
        query: `site:${domain} ${topic}`,
        domain,
        costUnits: 1,
        provider: webProvider,
        primary: false,
      })
      if (!ok) break
    }

    for (const dork of dorks) {
      const ok = tryPush({
        id: nextId('dork'),
        kind: 'dork',
        query: `${topic} ${dork}`,
        costUnits: 1,
        provider: webProvider,
        primary: false,
      })
      if (!ok) break
    }
  }

  return { topic, queries, caps, truncated, truncateReason }
}
