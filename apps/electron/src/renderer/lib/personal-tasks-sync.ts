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
  type PersonalTaskKv,
  type PersonalTaskMeta,
  type PersonalTasksMigrateInput,
  type PersonalTasksMigrateResult,
  type PersonalTasksSnapshot,
} from '@craft-agent/core/tasks/personal'

/** Verbatim copy of the localStorage blob taken right before the one-time migration. Never deleted. */
export const PERSONAL_TASKS_PRE_MIGRATION_KEY = 'rox.personal-tasks.v1.pre-migration'

export interface PersonalTasksApi {
  personalTasksList(): Promise<PersonalTasksSnapshot>
  personalTasksPut(tasks: PersonalTask[], meta?: PersonalTaskMeta | null): Promise<{ written: number; rejected: string[] }>
  personalTasksDelete(ids: string[]): Promise<{ removed: number }>
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
    return { bundle: bundleFromSnapshot(snapshot), migrated: null, cacheStatus: 'ok' }
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
  return { bundle: bundleFromSnapshot(migrated), migrated, cacheStatus: loaded.status }
}

/** A failed/unknown native receipt retains the exact attempted task for retry. */
export class PersonalTaskCreationError extends Error {
  readonly task: PersonalTask

  constructor(task: PersonalTask, cause: unknown) {
    super('Personal task was not confirmed by native storage', { cause })
    this.name = 'PersonalTaskCreationError'
    this.task = structuredClone(task)
  }
}

/** A resolved RPC is insufficient: native storage can reject individual IDs. */
export async function putPersonalTaskConfirmed(api: PersonalTasksApi, task: PersonalTask): Promise<void> {
  try {
    const receipt = await api.personalTasksPut([task])
    if (receipt.rejected.length > 0 || receipt.written !== 1) {
      throw new Error('Native personal task write was rejected or incomplete')
    }
  } catch (cause) {
    throw new PersonalTaskCreationError(task, cause)
  }
}

/** Push a diff to the server. Returns false when the RPC failed (the cache still has the change). */
export async function pushPersonalTaskDiff(api: PersonalTasksApi, diff: PersonalTaskDiff): Promise<boolean> {
  try {
    if (diff.put.length > 0 || diff.meta) {
      const receipt = await api.personalTasksPut(diff.put, diff.meta)
      if (receipt.rejected.length > 0 || receipt.written !== diff.put.length) return false
    }
    if (diff.remove.length > 0) await api.personalTasksDelete(diff.remove)
    return true
  } catch {
    return false
  }
}
