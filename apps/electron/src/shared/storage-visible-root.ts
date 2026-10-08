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
  /**
   * Last boot migration the user should know about (review 5): a deferral or
   * a move that needed a relaunch. Absent after a successful move and while
   * the flag is OFF.
   */
  lastMigration?: StorageMigrationStatus
}

export interface StorageMigrationStatus {
  kind: 'deferred-unmovable' | 'deferred-locked' | 'relaunch-required'
  /** First diagnostic code, e.g. `storage.migration.legacyNotRenamable`. */
  diagnostic?: string
  /** ISO timestamp of that launch. */
  at: string
}

/** i18n key of the explanatory line under the toggle, when one applies. */
export function storageMigrationStatusMessageKey(state: StorageVisibleRootState): string | undefined {
  const toggleOn = state.locked ? state.activeAtLaunch : state.enabled
  if (!toggleOn) return undefined
  switch (state.lastMigration?.kind) {
    case 'deferred-unmovable':
      return 'storage.settings.deferredUnmovable'
    case 'deferred-locked':
      return 'storage.settings.deferredLocked'
    default:
      return undefined
  }
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
