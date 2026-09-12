import { describe, expect, it } from 'bun:test'
import { planEvidenceSearch, runBoundedResearch } from '../index.ts'

describe('research cost / time caps', () => {
  it('does not execute more cost units than the plan allows', async () => {
    const plan = planEvidenceSearch({
      message: 'bounded topic',
      languages: ['en', 'ru', 'zh'],
      domains: ['a.test', 'b.test'],
      caps: { maxQueries: 8, maxCostUnits: 3, maxResultsPerQuery: 8, timeoutMs: 200 },
    })
    expect(plan.queries.length).toBeLessThanOrEqual(3)
    expect(plan.truncated).toBe(true)
    expect(plan.truncateReason).toBe('cost_cap')

    let calls = 0
    const result = await runBoundedResearch(plan, async (query, count) => {
      calls += 1
      expect(count).toBeLessThanOrEqual(10)
      return [
        { title: query.query, url: `https://hit.test/${query.id}`, snippet: query.query },
      ]
    })
    expect(calls).toBe(plan.queries.length)
    expect(result.costUnitsUsed).toBeLessThanOrEqual(3)
    expect(result.provenance.every((p) => p.query.length > 0)).toBe(true)
  })

  it('clamps per-query results and preserves query provenance', async () => {
    const plan = planEvidenceSearch({
      message: 'https://source.test/doc topic',
      caps: { maxQueries: 2, maxResultsPerQuery: 2, maxTotalResults: 3, maxCostUnits: 4 },
    })
    const result = await runBoundedResearch(plan, async (query) => {
      return [1, 2, 3, 4].map((n) => ({
        title: `${query.id}-${n}`,
        url: query.primary ? query.query : `https://source.test/${query.id}/${n}`,
        snippet: `hit ${n}`,
      }))
    })
    expect(result.sources.length).toBeLessThanOrEqual(3)
    expect(result.provenance[0]?.queryId).toBe(plan.queries[0]?.id)
    expect(result.sources[0]?.primary).toBe(true)
  })

  it('marks timeout when the search exceeds the cap', async () => {
    const plan = planEvidenceSearch({
      message: 'slow',
      caps: { maxQueries: 1, timeoutMs: 20, maxCostUnits: 2 },
    })
    const result = await runBoundedResearch(plan, async (_query, _count, signal) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 80)
        signal.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
      return []
    })
    expect(result.timedOut).toBe(true)
  })
})
