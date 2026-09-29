/**
 * personalTasks:* RPC DTOs (list / put / delete / migrate / changed).
 * Shared by server-core (PersonalTaskPersistStore) and the renderer.
 */
import type { PersonalTask, PersonalTaskBundle } from './types.ts'

/** Bundle-level data that is not a task (projects/areas/headings/audit). */
export type PersonalTaskMeta = Omit<PersonalTaskBundle, 'version' | 'tasks'>

/** One-time localStorage → persist migration marker. */
export interface PersonalTaskMigrationMarker {
  migratedAt: number
  imported: number
  skipped: number
  source: 'localStorage'
  /** The renderer cache was corrupt; the quarantined blob stayed in localStorage. */
  quarantined?: boolean
}

export interface PersonalTasksSnapshot {
  tasks: PersonalTask[]
  meta: PersonalTaskMeta | null
  migration: PersonalTaskMigrationMarker | null
}

export interface PersonalTasksMigrateInput {
  bundle: PersonalTaskBundle | null
  quarantined?: boolean
}

export interface PersonalTasksMigrateResult extends PersonalTasksSnapshot {
  status: 'migrated' | 'already-migrated'
  imported: number
  skipped: number
}
