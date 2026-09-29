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
  PersonalTaskMeta,
  PersonalTasksMigrateInput,
  PersonalTasksMigrateResult,
  PersonalTasksSnapshot,
} from '@craft-agent/core/tasks/personal'
import { PersonalTaskPersistStore } from './personal-persist.ts'

export type { PersonalTasksMigrateInput, PersonalTasksMigrateResult, PersonalTasksSnapshot }

export function readPersonalTasks(store: PersonalTaskPersistStore): PersonalTasksSnapshot {
  return {
    tasks: store.list().map((entry) => entry.task),
    meta: store.readMeta(),
    migration: store.readMigration(),
  }
}

/** Upsert tasks (and optionally meta). Invalid ids are skipped, never thrown to the renderer. */
export function putPersonalTasks(
  store: PersonalTaskPersistStore,
  tasks: readonly PersonalTask[],
  meta?: PersonalTaskMeta | null,
): { written: number; rejected: string[] } {
  let written = 0
  const rejected: string[] = []
  for (const task of tasks) {
    try {
      store.put(task)
      written += 1
    } catch {
      rejected.push(String(task?.id))
    }
  }
  if (meta) store.writeMeta(meta)
  return { written, rejected }
}

export function deletePersonalTasks(store: PersonalTaskPersistStore, ids: readonly string[]): number {
  let removed = 0
  for (const id of ids) if (store.delete(id)) removed += 1
  return removed
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
