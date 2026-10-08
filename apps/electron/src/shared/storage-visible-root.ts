/** W1-13 (#1510): Settings toggle for `storage.visible-root.v1` (direct IPC). */
export const STORAGE_VISIBLE_ROOT_CHANNELS = {
  GET: 'storage:visibleRoot:get',
  SET: 'storage:visibleRoot:set',
} as const

export interface StorageVisibleRootState {
  /** Persisted toggle in `workbench-flags.json` (applies on next launch). */
  enabled: boolean
  /** Flag state this app process launched with. */
  activeAtLaunch: boolean
  /** ROX_CONFIG_DIR / ROX_STORAGE_VISIBLE_ROOT env decides; the toggle is read-only. */
  locked: boolean
  /** The persisted value differs from the running one: relaunch to apply. */
  restartRequired: boolean
}

/** W1-13 review 2: one-shot notice about this launch's home migration. */
export const STORAGE_MIGRATION_NOTICE_CHANNELS = {
  TAKE: 'storage:migrationNotice:take',
} as const

export interface StorageMigrationNotice {
  /** migrated/merged: files moved to the visible home; deferred-foreign: left alone. */
  kind: 'migrated' | 'merged' | 'deferred-foreign'
  /** Relative paths kept under `.migration/conflicts/` (merges only). */
  conflicts: string[]
}
