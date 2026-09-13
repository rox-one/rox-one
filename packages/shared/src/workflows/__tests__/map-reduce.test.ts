import { describe, expect, test } from 'bun:test'
import {
  freezeSelectionSnapshot,
  isFullCoverage,
  runMapReduce,
  type MapTransformAdapter,
} from '../map-reduce.ts'

function mapAdapter(impl: MapTransformAdapter['map']): MapTransformAdapter {
  return { map: impl }
}

describe('Map → Reduce (issue 337)', () => {
  const refs = Array.from({ length: 50 }, (_, index) => ({
    workspaceId: 'ws',
    entityId: `s${index + 1}`,
    revisionId: 'r1',
  }))

  test('49/50 is not full coverage', () => {
    const snapshot = freezeSelectionSnapshot({ id: 'sel', entityRefs: refs.slice(0, 49), total: 50 })
    expect(snapshot.coverage.complete).toBe(false)
    expect(isFullCoverage(snapshot.coverage)).toBe(false)
  })

  test('cancel stops remaining jobs', async () => {
    const snapshot = freezeSelectionSnapshot({ id: 'sel', entityRefs: refs.slice(0, 3), total: 3 })
    const abort = new AbortController()
    let started = 0
    const run = await runMapReduce({
      snapshot,
      template: { versionId: 'pt-1', prompt: 'summarize' },
      signal: abort.signal,
      adapters: {
        map: mapAdapter(async () => {
          started += 1
          if (started === 1) abort.abort()
          return { json: { title: 'ok' } }
        }),
      },
    })
    expect(run.cancelled).toBe(true)
    expect(run.jobs.some((job) => job.status === 'cancelled')).toBe(true)
    expect(run.coverage.complete).toBe(false)
  })

  test('retry retries only failed or stale jobs', async () => {
    const snapshot = freezeSelectionSnapshot({ id: 'sel', entityRefs: refs.slice(0, 2), total: 2 })
    const first = await runMapReduce({
      snapshot,
      template: { versionId: 'pt-1', prompt: 'summarize', outputSchema: { required: ['title'] } },
      adapters: {
        map: mapAdapter(async ({ entity }) => {
          if (entity.entityId === 's2') return { json: { nope: true } }
          return { json: { title: 'ok' } }
        }),
      },
    })
    expect(first.jobs[0]?.status).toBe('done')
    expect(first.jobs[1]?.status).toBe('failed')
    let mapped = 0
    const retried = await runMapReduce({
      snapshot,
      template: { versionId: 'pt-1', prompt: 'summarize', outputSchema: { required: ['title'] } },
      retry: 'failed-or-stale',
      previous: first,
      adapters: {
        map: mapAdapter(async () => {
          mapped += 1
          return { json: { title: 'fixed' } }
        }),
      },
    })
    expect(mapped).toBe(1)
    expect(retried.jobs.every((job) => job.status === 'done')).toBe(true)
    expect(retried.coverage.complete).toBe(true)
  })

  test('source revision change marks prior output stale', async () => {
    const snapshot = freezeSelectionSnapshot({ id: 'sel', entityRefs: refs.slice(0, 1), total: 1 })
    const first = await runMapReduce({
      snapshot,
      template: { versionId: 'pt-1', prompt: 'summarize' },
      adapters: { map: mapAdapter(async () => ({ json: { title: 'old' } })) },
    })
    const next = await runMapReduce({
      snapshot,
      template: { versionId: 'pt-1', prompt: 'summarize' },
      retry: 'failed-or-stale',
      previous: first,
      liveRevisions: { s1: 'r2' },
      adapters: { map: mapAdapter(async () => ({ json: { title: 'new' } })) },
    })
    expect(next.jobs[0]?.output).toEqual({ title: 'new' })
  })
})
