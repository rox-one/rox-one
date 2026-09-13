export interface EnrichmentQuery { id: string; purpose: 'subject' | 'constraints' | 'freshness'; query: string }
export interface EnrichmentSource {
  sourceId: string; title: string; url: string; retrievedAt: number; publishedAt?: number | null
  excerpt: string; contentHash: string; queryIds: string[]; provider: 'exa' | 'compound'
}
export interface EnrichmentPlan { queries: EnrichmentQuery[]; skipped: boolean; reason?: 'not-needed' | 'unsafe' | 'disabled' | 'local-only' }
export const ENRICHMENT_DEFAULT_QUERIES = 3
export const ENRICHMENT_MAX_QUERIES = 5
export const ENRICHMENT_MAX_PARALLEL = 2
export const ENRICHMENT_DEADLINE_MS = 8000
export const ENRICHMENT_MAX_RESULTS_PER_QUERY = 5
export const ENRICHMENT_MAX_SOURCES = 8
