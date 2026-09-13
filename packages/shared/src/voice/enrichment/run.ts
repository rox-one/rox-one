import { buildQueryPlan } from './query-plan.ts'
import { dedupeSources, isBlockedUrl } from './source-policy.ts'
import { ENRICHMENT_DEADLINE_MS, ENRICHMENT_MAX_PARALLEL, ENRICHMENT_MAX_SOURCES, type EnrichmentSource } from './types.ts'
export interface SearchHit { title: string; url: string; excerpt: string }
export interface SearchAdapter { search(query: string, signal: AbortSignal): Promise<SearchHit[]> }
export async function runEnrichment(
  transcript: string, enabled: boolean, adapter: SearchAdapter, now = Date.now(),
): Promise<{ sources: EnrichmentSource[]; warnings: string[]; executedQueries: string[] }> {
  const plan = buildQueryPlan(transcript, enabled)
  if (plan.skipped) return { sources: [], warnings: plan.reason ? [plan.reason] : [], executedQueries: [] }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ENRICHMENT_DEADLINE_MS)
  const executed: string[] = []
  const hits: EnrichmentSource[] = []
  try {
    for (let i = 0; i < plan.queries.length; i += ENRICHMENT_MAX_PARALLEL) {
      const batch = plan.queries.slice(i, i + ENRICHMENT_MAX_PARALLEL)
      const results = await Promise.all(batch.map(async (query) => {
        executed.push(query.query)
        const found = await adapter.search(query.query, controller.signal)
        return found.map((hit, index) => ({
          sourceId: `${query.id}-${index}`, title: hit.title, url: hit.url, retrievedAt: now, publishedAt: null,
          excerpt: hit.excerpt, contentHash: String(hit.url.length), queryIds: [query.id], provider: 'exa' as const,
        }))
      }))
      hits.push(...results.flat())
    }
  } catch {
    clearTimeout(timer)
    return { sources: [], warnings: ['enrichment-failed'], executedQueries: executed }
  }
  clearTimeout(timer)
  const sources = dedupeSources(hits.filter((hit) => !isBlockedUrl(hit.url))).slice(0, ENRICHMENT_MAX_SOURCES)
  return { sources, warnings: [], executedQueries: executed }
}
