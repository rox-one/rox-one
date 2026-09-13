/**
 * Map → Outcomes → Reduce (ROX-AUD-054 / #337).
 *
 * Durable per-source jobs over an immutable SelectionSnapshot. This is not
 * the simulate-only canvas runner in packages/shared/src/workflows/run.ts
 * and must not call that runner. Live LLM gateway mapping is injected; without
 * a mapper/gateway, map stays fail-closed (queued, not live). Stale snapshot
 * revisions become stale jobs and never map. Local excerpt mapping is an
 * opt-in native adapter, not a default.
 */

import { formatRox2EntityId, liveResult, queuedResult, type Rox2Result } from './platform-contract.ts'

export const MAP_REDUCE_SCHEMA_VERSION = 1

export type EntityRefSnapshot = {
  entityId: string
  revision: string
  readable: boolean
}

export type SelectionSnapshot = {
  id: string
  createdAt: number
  entityRefs: readonly EntityRefSnapshot[]
  coverage: { selected: number; included: number }
}

export type PromptTemplate = {
  id: string
  version: number
  prompt: string
  outputSchema: 'excerpt' | 'json'
}

export type MapJob = {
  id: string
  sourceId: string
  revision: string
  status: 'queued' | 'running' | 'ok' | 'failed' | 'cancelled' | 'stale'
  output?: string
  error?: string
}

export type Outcome = {
  id: string
  sourceId: string
  revision: string
  text: string
  verified: boolean
}

export type ReduceResult = {
  summary: string
  outcomes: Outcome[]
  jobs: MapJob[]
  coverage: { selected: number; included: number; complete: boolean }
  errors: string[]
  lineage: { snapshotId: string; templateId: string; templateVersion: number }
}

export type MapSource = {
  id: string
  revision: string
  title: string
  preview: string
}

export type MapMapper = (source: MapSource, template: PromptTemplate) => Promise<string>

export class MapReduceCancelled extends Error {
  constructor() {
    super('map-reduce cancelled')
    this.name = 'MapReduceCancelled'
  }
}

export function snapshotSelection(sources: readonly MapSource[], selectedIds: readonly string[], now = Date.now()): SelectionSnapshot {
  const order = selectedIds.filter((id, index) => selectedIds.indexOf(id) === index)
  const known = new Map(sources.map((source) => [source.id, source]))
  const entityRefs: EntityRefSnapshot[] = []
  for (const id of order) {
    const source = known.get(id)
    if (!source) continue
    entityRefs.push({
      entityId: formatRox2EntityId('session', source.id),
      revision: source.revision,
      readable: true,
    })
  }
  return {
    id: `sel_${now.toString(16)}`,
    createdAt: now,
    entityRefs,
    coverage: { selected: order.length, included: entityRefs.length },
  }
}

export const LOCAL_EXCERPT_TEMPLATE: PromptTemplate = {
  id: 'local.excerpt.v1',
  version: 1,
  prompt: 'Extract the session title and preview.',
  outputSchema: 'excerpt',
}

export const localExcerptMapper: MapMapper = async (source) => {
  const title = source.title.trim() || source.id
  const preview = source.preview.trim()
  return preview ? `${title}: ${preview}` : title
}

export function gatewayMapper(live: boolean, run: MapMapper): MapMapper {
  if (!live) {
    return async () => {
      throw Object.assign(new Error('ROX gateway is not live'), { code: 'queued' })
    }
  }
  return run
}

export function isStaleSource(snapshot: EntityRefSnapshot, currentRevision: string | undefined): boolean {
  return currentRevision != null && currentRevision !== snapshot.revision
}

export async function runMapReduce(opts: {
  snapshot: SelectionSnapshot
  sources: readonly MapSource[]
  template: PromptTemplate
  mapper?: MapMapper
  concurrency?: number
  signal?: AbortSignal
}): Promise<ReduceResult> {
  const mapper = opts.mapper ?? gatewayMapper(false, localExcerptMapper)
  const byId = new Map(opts.sources.map((source) => [source.id, source]))
  const jobs: MapJob[] = []
  const outcomes: Outcome[] = []
  const errors: string[] = []
  const included = opts.snapshot.entityRefs.filter((ref) => ref.readable)
  const limit = Math.max(1, opts.concurrency ?? 4)
  let next = 0

  const worker = async () => {
    while (true) {
      if (opts.signal?.aborted) throw new MapReduceCancelled()
      const index = next++
      if (index >= included.length) return
      const ref = included[index]!
      const sourceId = ref.entityId.slice('session:'.length)
      const source = byId.get(sourceId)
      const job: MapJob = {
        id: `job_${index}`,
        sourceId,
        revision: ref.revision,
        status: 'running',
      }
      jobs.push(job)
      if (!source) {
        job.status = 'failed'
        job.error = 'source missing'
        errors.push(`${sourceId}: source missing`)
        continue
      }
      if (isStaleSource(ref, source.revision)) {
        job.status = 'stale'
        errors.push(`${sourceId}: stale`)
        continue
      }
      try {
        const output = await mapper(source, opts.template)
        job.status = 'ok'
        job.output = output
        outcomes.push({
          id: `out_${sourceId}`,
          sourceId,
          revision: ref.revision,
          text: output,
          verified: true,
        })
      } catch (error) {
        if (error instanceof MapReduceCancelled) throw error
        job.status = 'failed'
        job.error = error instanceof Error ? error.message : String(error)
        errors.push(`${sourceId}: ${job.error}`)
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(limit, included.length) }, () => worker()))
  } catch (error) {
    if (!(error instanceof MapReduceCancelled)) throw error
    errors.push('cancelled')
  }

  const complete =
    opts.snapshot.coverage.selected === opts.snapshot.coverage.included &&
    outcomes.length === included.length &&
    errors.length === 0

  return {
    summary: outcomes.map((outcome) => outcome.text).join('\n'),
    outcomes,
    jobs,
    coverage: {
      selected: opts.snapshot.coverage.selected,
      included: outcomes.length,
      complete,
    },
    errors,
    lineage: {
      snapshotId: opts.snapshot.id,
      templateId: opts.template.id,
      templateVersion: opts.template.version,
    },
  }
}

export function mapReduceProductResult(result: ReduceResult): Rox2Result {
  if (!result.coverage.complete) {
    return queuedResult('map-reduce.partial', 'Partial coverage is not a completed product action')
  }
  if (result.outcomes.length === 0) {
    return queuedResult('map-reduce.empty', 'No verified outcomes')
  }
  return liveResult({
    entityId: formatRox2EntityId('workflow', result.lineage.snapshotId),
    lifecycle: 'succeeded',
    verification: 'unverified',
    message: 'Reduce completed without receipt or readback',
  })
}
