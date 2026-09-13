/**
 * Map → Outcomes → Reduce over a frozen SelectionSnapshot (issue #337).
 * Production jobs use injected adapters. This is not workflows/run.ts simulate.
 */

import { createHash } from 'node:crypto'

export type MapEntityRef = {
  workspaceId: string
  entityId: string
  revisionId: string
}

export type SelectionSnapshot = {
  id: string
  entityRefs: readonly MapEntityRef[]
  revisions: Readonly<Record<string, string>>
  acl: Readonly<Record<string, readonly string[]>>
  coverage: {
    selected: number
    total: number
    complete: boolean
  }
}

export type PromptTemplate = {
  versionId: string
  parentVersionId?: string | null
  prompt: string
  outputSchema?: Record<string, unknown>
  budgetTokens?: number
}

export type MapJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'stale'

export type MapJob = {
  id: string
  entityId: string
  revisionId: string
  status: MapJobStatus
  output?: unknown
  error?: string
}

export type MapReduceRun = {
  id: string
  snapshotId: string
  templateVersionId: string
  jobs: MapJob[]
  reduced?: unknown
  cancelled: boolean
  coverage: { mapped: number; selected: number; total: number; complete: boolean }
}

export type MapTransformAdapter = {
  map(input: {
    entity: MapEntityRef
    prompt: string
    templateVersionId: string
  }): Promise<{ json: unknown }>
}

export type ReduceAdapter = {
  reduce(input: { outputs: unknown[]; templateVersionId: string }): Promise<{ json: unknown }>
}

function refKey(ref: MapEntityRef): string {
  return `${ref.workspaceId}:${ref.entityId}`
}

export function freezeSelectionSnapshot(input: {
  id: string
  entityRefs: readonly MapEntityRef[]
  total: number
  acl?: Readonly<Record<string, readonly string[]>>
}): SelectionSnapshot {
  const revisions: Record<string, string> = {}
  for (const ref of input.entityRefs) revisions[refKey(ref)] = ref.revisionId
  const selected = input.entityRefs.length
  return {
    id: input.id,
    entityRefs: input.entityRefs,
    revisions,
    acl: input.acl ?? {},
    coverage: {
      selected,
      total: input.total,
      complete: selected === input.total,
    },
  }
}

export function isFullCoverage(coverage: { mapped?: number; selected: number; total: number }): boolean {
  const mapped = coverage.mapped ?? coverage.selected
  return mapped === coverage.selected && coverage.selected === coverage.total && coverage.total > 0
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function matchesSchema(value: unknown, schema: Record<string, unknown> | undefined): boolean {
  if (!schema) return isObjectRecord(value)
  if (!isObjectRecord(value)) return false
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : []
  return required.every((key) => key in value)
}

function sourceBecameStale(job: MapJob, liveRevisions: Readonly<Record<string, string>>): boolean {
  const live = liveRevisions[job.entityId]
  return Boolean(live && live !== job.revisionId)
}

export async function runMapReduce(input: {
  snapshot: SelectionSnapshot
  template: PromptTemplate
  adapters: { map: MapTransformAdapter; reduce?: ReduceAdapter }
  signal?: AbortSignal
  retry?: 'failed-or-stale'
  previous?: MapReduceRun
  liveRevisions?: Readonly<Record<string, string>>
  now?: number
}): Promise<MapReduceRun> {
  const now = input.now ?? Date.now()
  const previousJobs = input.previous?.jobs ?? []
  const jobs: MapJob[] = input.snapshot.entityRefs.map((ref) => {
    const prior = previousJobs.find((job) => job.entityId === ref.entityId)
    const stale = sourceBecameStale(
      prior ?? { id: '', entityId: ref.entityId, revisionId: ref.revisionId, status: 'queued' },
      input.liveRevisions ?? {},
    )
    if (prior && input.retry === 'failed-or-stale' && prior.status === 'done' && !stale) return { ...prior }
    return {
      id: `${ref.entityId}:${ref.revisionId}`,
      entityId: ref.entityId,
      revisionId: ref.revisionId,
      status: stale ? 'stale' : 'queued',
    }
  })

  const run: MapReduceRun = {
    id: `map:${input.snapshot.id}:${now}`,
    snapshotId: input.snapshot.id,
    templateVersionId: input.template.versionId,
    jobs,
    cancelled: false,
    coverage: {
      mapped: 0,
      selected: input.snapshot.coverage.selected,
      total: input.snapshot.coverage.total,
      complete: false,
    },
  }

  for (const job of jobs) {
    if (input.signal?.aborted) {
      run.cancelled = true
      if (job.status === 'queued' || job.status === 'stale') job.status = 'cancelled'
      continue
    }
    if (job.status === 'done') continue
    job.status = 'running'
    try {
      const mapped = await input.adapters.map.map({
        entity: {
          workspaceId: input.snapshot.entityRefs.find((ref) => ref.entityId === job.entityId)!.workspaceId,
          entityId: job.entityId,
          revisionId: job.revisionId,
        },
        prompt: input.template.prompt,
        templateVersionId: input.template.versionId,
      })
      if (!matchesSchema(mapped.json, input.template.outputSchema)) {
        job.status = 'failed'
        job.error = 'invalid-json'
        continue
      }
      job.output = mapped.json
      job.status = 'done'
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
    }
  }

  if (input.signal?.aborted) run.cancelled = true
  const mapped = jobs.filter((job) => job.status === 'done').length
  run.coverage = {
    mapped,
    selected: input.snapshot.coverage.selected,
    total: input.snapshot.coverage.total,
    complete: isFullCoverage({ mapped, selected: input.snapshot.coverage.selected, total: input.snapshot.coverage.total }),
  }
  if (!run.cancelled && input.adapters.reduce) {
    const outputs = jobs.filter((job) => job.status === 'done').map((job) => job.output)
    run.reduced = (await input.adapters.reduce.reduce({ outputs, templateVersionId: input.template.versionId })).json
  }
  return run
}

export function snapshotFingerprint(snapshot: SelectionSnapshot): string {
  return createHash('sha256').update(JSON.stringify({
    id: snapshot.id,
    refs: snapshot.entityRefs,
    revisions: snapshot.revisions,
    coverage: snapshot.coverage,
  })).digest('hex')
}
