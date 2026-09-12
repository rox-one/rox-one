import { canonicalUrl } from './rank.ts'
import { dedupeAndRank } from './rank.ts'
import type {
  PlannedQuery,
  QueryProvenance,
  ResearchPlan,
  ResearchRunResult,
  SearchHit,
} from './types.ts'

export type ResearchSearchFn = (
  query: PlannedQuery,
  count: number,
  signal: AbortSignal,
) => Promise<Array<Pick<SearchHit, 'title' | 'url' | 'snippet' | 'publishedAt'>>>

/**
 * Run a planner output with explicit result/cost/time caps.
 * Parallel within the plan; never expands past `plan.caps`.
 */
export async function runBoundedResearch(
  plan: ResearchPlan,
  search: ResearchSearchFn,
): Promise<ResearchRunResult> {
  const caps = plan.caps
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), caps.timeoutMs)
  const primaryUrls = new Set(
    plan.queries.filter((q) => q.primary).map((q) => canonicalUrl(q.query)),
  )

  let timedOut = false
  let costUnitsUsed = 0
  const hits: SearchHit[] = []
  const provenance: QueryProvenance[] = []

  try {
    const settled = await Promise.allSettled(
      plan.queries.map(async (query) => {
        const raw = await search(query, caps.maxResultsPerQuery, controller.signal)
        return { query, raw: raw.slice(0, caps.maxResultsPerQuery) }
      }),
    )

    for (const item of settled) {
      if (item.status !== 'fulfilled') {
        if (controller.signal.aborted) timedOut = true
        continue
      }
      const { query, raw } = item.value
      if (costUnitsUsed + query.costUnits > caps.maxCostUnits) {
        provenance.push({
          queryId: query.id,
          query: query.query,
          provider: query.provider,
          kind: query.kind,
          hitCount: 0,
        })
        continue
      }
      costUnitsUsed += query.costUnits
      const remaining = caps.maxTotalResults - hits.length
      const accepted = remaining <= 0 ? [] : raw.slice(0, remaining)
      for (const hit of accepted) {
        hits.push({
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          publishedAt: hit.publishedAt ?? null,
          queryId: query.id,
          provider: query.provider,
        })
      }
      provenance.push({
        queryId: query.id,
        query: query.query,
        provider: query.provider,
        kind: query.kind,
        hitCount: accepted.length,
      })
    }
  } finally {
    clearTimeout(timer)
  }

  return {
    sources: dedupeAndRank(hits, primaryUrls).slice(0, caps.maxTotalResults),
    provenance,
    costUnitsUsed,
    timedOut,
    truncated: plan.truncated || hits.length >= caps.maxTotalResults,
  }
}
