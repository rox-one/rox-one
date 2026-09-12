/** Bounded research / citation contracts (Rox tracker issue 31). */

export const DEFAULT_RESEARCH_CAPS = {
  maxQueries: 6,
  maxResultsPerQuery: 8,
  maxTotalResults: 24,
  maxCostUnits: 12,
  timeoutMs: 12_000,
} as const

/** Hard ceiling — never honor 10–15×50 fan-out even if a caller asks. */
export const RESEARCH_CAP_CEILING = {
  maxQueries: 8,
  maxResultsPerQuery: 10,
  maxTotalResults: 24,
  maxCostUnits: 16,
  timeoutMs: 20_000,
} as const

export type ResearchQueryKind = 'primary_url' | 'multilingual' | 'domain' | 'dork'
export type ResearchProviderId = 'exa' | 'web_search' | 'primary_url'
export type Reliability = 'high' | 'medium' | 'low' | 'unknown'

export interface ResearchCaps {
  maxQueries: number
  maxResultsPerQuery: number
  maxTotalResults: number
  maxCostUnits: number
  timeoutMs: number
}

export interface ResearchRequest {
  message: string
  referencedUrls?: readonly string[]
  languages?: readonly string[]
  domains?: readonly string[]
  dorks?: readonly string[]
  caps?: Partial<ResearchCaps>
  preferredProvider?: Exclude<ResearchProviderId, 'primary_url'>
}

export interface PlannedQuery {
  id: string
  kind: ResearchQueryKind
  query: string
  language?: string
  domain?: string
  costUnits: number
  provider: ResearchProviderId
  primary: boolean
}

export interface ResearchPlan {
  topic: string
  queries: PlannedQuery[]
  caps: ResearchCaps
  truncated: boolean
  truncateReason?: 'cost_cap' | 'query_cap'
}

export interface SearchHit {
  title: string
  url: string
  snippet: string
  publishedAt?: string | null
  queryId: string
  provider: string
}

export interface RankedSource {
  url: string
  canonicalUrl: string
  title: string
  snippet: string
  publishedAt: string | null
  reliability: Reliability
  contradiction: boolean
  queryIds: string[]
  providers: string[]
  primary: boolean
  rank: number
}

export interface CitationSpan {
  start: number
  end: number
  sourceUrl: string
  text: string
}

export interface QueryProvenance {
  queryId: string
  query: string
  provider: ResearchProviderId
  kind: ResearchQueryKind
  hitCount: number
}

export interface ResearchConsent {
  searchCache?: boolean
  aiIndexing?: boolean
  productImprovement?: boolean
}

export type ResearchCacheDecision = 'local' | 'none'

export interface ResearchRunResult {
  sources: RankedSource[]
  provenance: QueryProvenance[]
  costUnitsUsed: number
  timedOut: boolean
  truncated: boolean
}
