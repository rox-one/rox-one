/**
 * Personal tasks over PersonalTaskPersistStore — the logic behind the
 * `personalTasks:*` RPC (list / put / delete / migrate / changed).
 *
 * Canonical storage: {configDir}/personal-tasks/<id>.json (+ meta + migration
 * marker). Renderer localStorage stays as a read-through cache only.
 *
 * Migration is one-time and non-destructive: every task from the renderer's
 * localStorage bundle is written unless the server already has that id (the
 * server copy wins), the marker is written last, and nothing is deleted.
 */
import type {
  PersonalTask,
  PersonalTaskDelete,
  PersonalTaskDeleteResult,
  PersonalTaskMeta,
  PersonalTaskPutResult,
  PersonalTaskWrite,
  PersonalTasksMigrateInput,
  PersonalTasksMigrateResult,
  PersonalTasksSnapshot,
} from '@rox/core/tasks/personal'
import { PersonalTaskPersistStore } from './personal-persist.ts'

export type { PersonalTasksMigrateInput, PersonalTasksMigrateResult, PersonalTasksSnapshot }

const backedUp = new WeakSet<PersonalTaskPersistStore>()

export function readPersonalTasks(store: PersonalTaskPersistStore): PersonalTasksSnapshot {
  if (!backedUp.has(store)) {
    backedUp.add(store)
    try { store.ensureSchemaBackup() } catch { /* best effort — never blocks reads */ }
  }
  const records = store.list()
  return {
    tasks: records.map((entry) => entry.task),
    revisions: Object.fromEntries(records.map(({ task, revision }) => [task.id, revision])),
    meta: store.readMeta(),
    migration: store.readMigration(),
  }
}

/** Compare each task write against its caller-observed revision before persisting. */
export function putPersonalTasks(
  store: PersonalTaskPersistStore,
  writes: readonly PersonalTaskWrite[],
  meta?: PersonalTaskMeta | null,
): PersonalTaskPutResult {
  const accepted: PersonalTaskPutResult['accepted'] = []
  const conflicts: PersonalTaskPutResult['conflicts'] = []
  const rejected: string[] = []
  for (const write of writes) {
    try {
      const result = store.putIfRevision(write)
      if (result.status === 'accepted') accepted.push(result.record)
      else conflicts.push({ id: write.task.id, current: result.current })
    } catch {
      rejected.push(String(write?.task?.id))
    }
  }
  if (meta) store.writeMeta(meta)
  return { accepted, conflicts, rejected }
}

export function deletePersonalTasks(
  store: PersonalTaskPersistStore,
  deletes: readonly PersonalTaskDelete[],
): PersonalTaskDeleteResult {
  const removed: string[] = []
  const conflicts: PersonalTaskDeleteResult['conflicts'] = []
  const rejected: string[] = []
  for (const item of deletes) {
    try {
      const result = store.deleteIfRevision(item.id, item.expectedRevision)
      if (result.status === 'removed') removed.push(item.id)
      else conflicts.push({ id: item.id, current: result.current })
    } catch {
      rejected.push(String(item?.id))
    }
  }
  return { removed, conflicts, rejected }
}

export function migratePersonalTasks(
  store: PersonalTaskPersistStore,
  input: PersonalTasksMigrateInput,
  now: number = Date.now(),
): PersonalTasksMigrateResult {
  const existingMarker = store.readMigration()
  if (existingMarker) {
    return { ...readPersonalTasks(store), status: 'already-migrated', imported: 0, skipped: 0 }
  }
  let imported = 0
  let skipped = 0
  const bundle = input.bundle
  if (bundle) {
    for (const task of bundle.tasks ?? []) {
      if (store.get(task.id)) {
        skipped += 1
        continue
      }
      try {
        store.put(task)
        imported += 1
      } catch {
        skipped += 1
      }
    }
    if (!store.readMeta()) {
      store.writeMeta({
        projects: bundle.projects ?? [],
        areas: bundle.areas ?? [],
        headings: bundle.headings ?? [],
        audit: [...(bundle.audit ?? []), { at: now, action: 'migrate.localStorage', detail: `${imported}` }],
      })
    }
  }
  store.writeMigration({
    migratedAt: now,
    imported,
    skipped,
    source: 'localStorage',
    ...(input.quarantined ? { quarantined: true } : {}),
  })
  return { ...readPersonalTasks(store), status: 'migrated', imported, skipped }
}
