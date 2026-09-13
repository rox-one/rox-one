import { describe, expect, test } from 'bun:test'
import { isClaimableLive } from '../platform-contract.ts'
import {
  LOCAL_EXCERPT_TEMPLATE,
  gatewayMapper,
  localExcerptMapper,
  mapReduceProductResult,
  runMapReduce,
  snapshotSelection,
} from '../map-reduce.ts'

const sources = [
  { id: 'a', revision: '1', title: 'Alpha', preview: 'first' },
  { id: 'b', revision: '1', title: 'Beta', preview: 'second' },
]

describe('ROX-AUD-054 Map → Outcomes → Reduce', () => {
  test('snapshot coverage is not claimed complete when a selected id is missing', () => {
    const snapshot = snapshotSelection(sources, ['a', 'missing', 'b'])
    expect(snapshot.coverage).toEqual({ selected: 3, included: 2 })
    expect(snapshot.entityRefs.map((ref) => ref.entityId)).toEqual(['session:a', 'session:b'])
  })

  test('local excerpt map/reduce is not claimable live without receipt or readback', async () => {
    const snapshot = snapshotSelection(sources, ['a', 'b'])
    const result = await runMapReduce({
      snapshot,
      sources,
      template: LOCAL_EXCERPT_TEMPLATE,
      mapper: localExcerptMapper,
    })
    expect(result.coverage.complete).toBe(true)
    expect(result.outcomes).toHaveLength(2)
    expect(result.summary).toContain('Alpha: first')
    const product = mapReduceProductResult(result)
    expect(isClaimableLive(product)).toBe(false)
    expect(product).not.toMatchObject({ ok: true, state: 'live' })
  })

  test('cancel stops remaining jobs and does not claim full coverage', async () => {
    const snapshot = snapshotSelection(sources, ['a', 'b'])
    const controller = new AbortController()
    let started = 0
    const result = await runMapReduce({
      snapshot,
      sources,
      template: LOCAL_EXCERPT_TEMPLATE,
      concurrency: 1,
      signal: controller.signal,
      mapper: async (source) => {
        started += 1
        if (started === 1) controller.abort()
        return localExcerptMapper(source, LOCAL_EXCERPT_TEMPLATE)
      },
    })
    expect(result.coverage.complete).toBe(false)
    expect(isClaimableLive(mapReduceProductResult(result))).toBe(false)
    expect(result.errors).toContain('cancelled')
  })

  test('source revision change is stale; gateway mapper is fail-closed', async () => {
    const snapshot = snapshotSelection(sources, ['a'])
    const stale = await runMapReduce({
      snapshot,
      sources: [{ ...sources[0]!, revision: '2' }],
      template: LOCAL_EXCERPT_TEMPLATE,
      mapper: localExcerptMapper,
    })
    expect(stale.coverage.complete).toBe(false)
    expect(stale.errors[0]).toContain('stale')

    const queued = await runMapReduce({
      snapshot: snapshotSelection(sources, ['a']),
      sources,
      template: LOCAL_EXCERPT_TEMPLATE,
      mapper: gatewayMapper(false, localExcerptMapper),
    })
    expect(queued.coverage.complete).toBe(false)
    expect(queued.errors[0]).toContain('not live')
  })

  test('omitted mapper is fail-closed and is not live success', async () => {
    const result = await runMapReduce({
      snapshot: snapshotSelection(sources, ['a', 'b']),
      sources,
      template: LOCAL_EXCERPT_TEMPLATE,
    })
    expect(result.coverage.complete).toBe(false)
    expect(result.outcomes).toHaveLength(0)
    expect(result.errors.every((error) => error.includes('not live'))).toBe(true)
    const product = mapReduceProductResult(result)
    expect(product.ok).toBe(false)
    expect(product.state).toBe('queued')
    expect(isClaimableLive(product)).toBe(false)
  })

  test('stale revision yields a stale job and does not invoke the mapper', async () => {
    let mapped = 0
    const result = await runMapReduce({
      snapshot: snapshotSelection(sources, ['a']),
      sources: [{ ...sources[0]!, revision: '2' }],
      template: LOCAL_EXCERPT_TEMPLATE,
      mapper: async (source) => {
        mapped += 1
        return localExcerptMapper(source, LOCAL_EXCERPT_TEMPLATE)
      },
    })
    expect(result.jobs.map((job) => job.status)).toEqual(['stale'])
    expect(result.outcomes).toHaveLength(0)
    expect(mapped).toBe(0)
    expect(result.coverage.complete).toBe(false)
    expect(isClaimableLive(mapReduceProductResult(result))).toBe(false)
  })

  test('map-reduce does not invoke the simulated canvas runWorkflow runner', async () => {
    const source = await Bun.file(new URL('../map-reduce.ts', import.meta.url)).text()
    expect(/\bimport\b[\s\S]*\brunWorkflow\b/.test(source)).toBe(false)
    expect(/\brunWorkflow\s*\(/.test(source)).toBe(false)

    const result = await runMapReduce({
      snapshot: snapshotSelection(sources, ['a']),
      sources,
      template: LOCAL_EXCERPT_TEMPLATE,
    })
    expect(result.jobs.every((job) => job.status !== 'ok')).toBe(true)
    expect(isClaimableLive(mapReduceProductResult(result))).toBe(false)
  })
})
