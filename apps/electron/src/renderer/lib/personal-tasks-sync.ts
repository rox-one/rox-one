/**
 * Pure sync helpers for personal tasks: localStorage cache ⇄ personalTasks:*
 * RPC (server-core PersonalTaskPersistStore). No window access — tests inject
 * a Map-backed Kv and a fake API.
 */
import {
  PERSONAL_TASKS_STAGING_KEY,
  PERSONAL_TASKS_STORAGE_KEY,
  PersonalTaskStore,
  emptyBundle,
  loadPersonalTaskCache,
  type PersonalTask,
  type PersonalTaskBundle,
  type PersonalTaskConflict,
  type PersonalTaskDelete,
  type PersonalTaskDeleteResult,
  type PersonalTaskKv,
  type PersonalTaskMeta,
  type PersonalTasksMigrateInput,
  type PersonalTasksMigrateResult,
  type PersonalTaskPutResult,
  type PersonalTaskWrite,
  type PersonalTasksSnapshot,
  type VersionedPersonalTask,
} from '@rox/core/tasks/personal'

/** Verbatim copy of the localStorage blob taken right before the one-time migration. Never deleted. */
export const PERSONAL_TASKS_PRE_MIGRATION_KEY = 'rox.personal-tasks.v1.pre-migration'

export interface PersonalTasksApi {
  personalTasksList(): Promise<PersonalTasksSnapshot>
  personalTasksPut(writes: PersonalTaskWrite[], meta?: PersonalTaskMeta | null): Promise<PersonalTaskPutResult>
  personalTasksDelete(deletes: PersonalTaskDelete[]): Promise<PersonalTaskDeleteResult>
  personalTasksMigrate(input: PersonalTasksMigrateInput): Promise<PersonalTasksMigrateResult>
}

export function isPersonalTasksApi(value: unknown): value is PersonalTasksApi {
  const api = value as Partial<PersonalTasksApi> | null | undefined
  return Boolean(
    api
    && typeof api.personalTasksList === 'function'
    && typeof api.personalTasksPut === 'function'
    && typeof api.personalTasksDelete === 'function'
    && typeof api.personalTasksMigrate === 'function',
  )
}

export function bundleFromSnapshot(snapshot: Pick<PersonalTasksSnapshot, 'tasks' | 'meta'>): PersonalTaskBundle {
  const base = emptyBundle()
  return {
    ...base,
    tasks: [...snapshot.tasks],
    projects: snapshot.meta?.projects ?? [],
    areas: snapshot.meta?.areas ?? [],
    headings: snapshot.meta?.headings ?? [],
    audit: snapshot.meta?.audit ?? [],
  }
}

export function metaOf(bundle: PersonalTaskBundle): PersonalTaskMeta {
  return { projects: bundle.projects, areas: bundle.areas, headings: bundle.headings, audit: bundle.audit }
}

export interface PersonalTaskDiff {
  put: PersonalTask[]
  remove: string[]
  meta: PersonalTaskMeta | null
}

/** What changed between the last synced bundle and the next one. */
export function diffPersonalTaskBundles(prev: PersonalTaskBundle, next: PersonalTaskBundle): PersonalTaskDiff {
  const before = new Map(prev.tasks.map((task) => [task.id, JSON.stringify(task)]))
  const put = next.tasks.filter((task) => before.get(task.id) !== JSON.stringify(task))
  const nextIds = new Set(next.tasks.map((task) => task.id))
  const remove = prev.tasks.filter((task) => !nextIds.has(task.id)).map((task) => task.id)
  const metaChanged = JSON.stringify(metaOf(prev)) !== JSON.stringify(metaOf(next))
  return { put, remove, meta: metaChanged ? metaOf(next) : null }
}

export function isEmptyDiff(diff: PersonalTaskDiff): boolean {
  return diff.put.length === 0 && diff.remove.length === 0 && diff.meta == null
}

export interface HydrateResult {
  bundle: PersonalTaskBundle
  revisions: Record<string, number>
  migrated: PersonalTasksMigrateResult | null
  cacheStatus: 'ok' | 'empty' | 'quarantine'
}

/**
 * Read the canonical server copy; on first run migrate the localStorage
 * bundle into it. Non-destructive: the raw blob is copied to
 * PERSONAL_TASKS_PRE_MIGRATION_KEY first, a corrupt blob stays quarantined
 * (loadPersonalTaskCache) and only the post-quarantine staging bundle, if
 * any, is migrated. The server keeps its own copy of any id it already has.
 */
export async function hydratePersonalTasksFrom(api: PersonalTasksApi, kv: PersonalTaskKv): Promise<HydrateResult> {
  const snapshot = await api.personalTasksList()
  if (snapshot.migration) {
    return { bundle: bundleFromSnapshot(snapshot), revisions: snapshot.revisions, migrated: null, cacheStatus: 'ok' }
  }
  const raw = kv.getItem(PERSONAL_TASKS_STORAGE_KEY)
  const loaded = loadPersonalTaskCache(kv)
  let bundle: PersonalTaskBundle | null = null
  if (loaded.status === 'ok') {
    if (raw && kv.getItem(PERSONAL_TASKS_PRE_MIGRATION_KEY) == null) kv.setItem(PERSONAL_TASKS_PRE_MIGRATION_KEY, raw)
    bundle = loaded.store.snapshot()
  } else if (loaded.status === 'quarantine') {
    const staging = kv.getItem(PERSONAL_TASKS_STAGING_KEY)
    const parsed = staging ? PersonalTaskStore.tryFromJson(staging) : null
    if (parsed?.status === 'ok') bundle = parsed.store.snapshot()
  }
  const migrated = await api.personalTasksMigrate({ bundle, quarantined: loaded.status === 'quarantine' })
  return { bundle: bundleFromSnapshot(migrated), revisions: migrated.revisions, migrated, cacheStatus: loaded.status }
}

/** An unconfirmed response retains the exact identity and payload for retry. */
export class PersonalTaskCreationError extends Error {
  readonly task: PersonalTask

  constructor(task: PersonalTask, cause: unknown) {
    super('Personal task was not confirmed by native storage', { cause })
    this.name = 'PersonalTaskCreationError'
    this.task = structuredClone(task)
  }
}

function sameTaskPayload(left: PersonalTask, right: PersonalTask): boolean {
  const canonical = (task: PersonalTask) => JSON.stringify(task, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
      : value)
  return canonical(left) === canonical(right)
}

/** Confirm creation against native CAS; an unknown ACK retries the same identity. */
export async function putPersonalTaskConfirmed(api: PersonalTasksApi, task: PersonalTask): Promise<VersionedPersonalTask> {
  try {
    const receipt = await api.personalTasksPut([{ task, expectedRevision: null }])
    if (receipt.rejected.length) throw new Error('Native personal task creation was rejected')
    let record: VersionedPersonalTask | null = null
    if (receipt.accepted.length === 1 && receipt.conflicts.length === 0) {
      record = receipt.accepted[0]!
    } else if (receipt.accepted.length === 0 && receipt.conflicts.length === 1 && receipt.conflicts[0]!.id === task.id) {
      // Only the identical persisted payload reconciles an unknown create ACK.
      // A new/different payload never upgrades a stale retry into an overwrite.
      record = receipt.conflicts[0]!.current
    }
    if (!record || record.task.id !== task.id || !Number.isSafeInteger(record.revision) || record.revision < 1
      || !sameTaskPayload(record.task, task)) {
      throw new Error('Native personal task creation was not exactly confirmed')
    }
    return structuredClone(record)
  } catch (cause) {
    throw new PersonalTaskCreationError(task, cause)
  }
}

export interface PersonalTaskDiffPushResult {
  accepted: VersionedPersonalTask[]
  removed: string[]
  conflicts: PersonalTaskConflict[]
  rejected: string[]
  ok: boolean
}

/** Apply a snapshot-based diff with the revisions from that exact server snapshot. */
export async function pushPersonalTaskDiff(
  api: PersonalTasksApi,
  diff: PersonalTaskDiff,
  revisions: Readonly<Record<string, number>>,
): Promise<PersonalTaskDiffPushResult> {
  const accepted: VersionedPersonalTask[] = []
  const removed: string[] = []
  const conflicts: PersonalTaskConflict[] = []
  const rejected: string[] = []
  try {
    if (diff.put.length > 0 || diff.meta) {
      const writes: PersonalTaskWrite[] = diff.put.map((task) => ({
        task,
        expectedRevision: revisions[task.id] ?? null,
      }))
      const result = await api.personalTasksPut(writes, diff.meta)
      accepted.push(...result.accepted)
      conflicts.push(...result.conflicts)
      rejected.push(...result.rejected)
    }
    if (diff.remove.length > 0) {
      const deletes: PersonalTaskDelete[] = []
      for (const id of diff.remove) {
        const expectedRevision = revisions[id]
        if (expectedRevision == null) rejected.push(id)
        else deletes.push({ id, expectedRevision })
      }
      if (deletes.length > 0) {
        const result: PersonalTaskDeleteResult = await api.personalTasksDelete(deletes)
        removed.push(...result.removed)
        conflicts.push(...result.conflicts)
        rejected.push(...result.rejected)
      }
    }
  } catch {
    return { accepted, removed, conflicts, rejected, ok: false }
  }
  return {
    accepted,
    removed,
    conflicts,
    rejected,
    ok: accepted.length === diff.put.length && removed.length === diff.remove.length && conflicts.length === 0 && rejected.length === 0,
  }
}
