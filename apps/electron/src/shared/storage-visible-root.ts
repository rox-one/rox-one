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
  kind:
    | 'deferred-unmovable'
    | 'deferred-locked'
    | 'deferred-retry'
    | 'deferred-foreign'
    | 'deferred-link'
    | 'symlink-elsewhere'
    | 'relaunch-required'
    | 'failed'
  /** First diagnostic code, e.g. `storage.migration.legacyNotRenamable`. */
  diagnostic?: string
  /** All diagnostics of that launch (`rename:<code>`, `failed:<code>`, …). */
  diagnostics?: string[]
  /** ISO timestamp of that launch. */
  at: string
}

/** Rename codes of a file in use (retried at the next launch). */
const IN_USE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
/** `~/.rox` cannot leave its volume: a mount point / separate volume. */
const UNMOVABLE_CODES = new Set(['EXDEV', 'mount-point', 'volume-root', 'cross-device', 'reparse-point'])
/**
 * Mirrors `ROX_MERGE_TRANSIENT_RETRIES` (`@rox/shared/identity`, not
 * importable here): after this many consecutive failures of a merge the next
 * launch holds it for 24 hours.
 */
export const STORAGE_MERGE_TRANSIENT_RETRIES = 3

function diagnosticValue(status: StorageMigrationStatus, prefix: string): string | undefined {
  const entry = status.diagnostics?.find((d) => d.startsWith(prefix))
  return entry?.slice(prefix.length)
}

/** i18n key of the explanatory line under the toggle, when one applies. */
export function storageMigrationStatusMessageKey(state: StorageVisibleRootState): string | undefined {
  const toggleOn = state.locked ? state.activeAtLaunch : state.enabled
  const last = state.lastMigration
  if (!toggleOn || !last) return undefined
  switch (last.kind) {
    case 'deferred-locked':
      return 'storage.settings.migrationDeferredLocked'
    case 'deferred-foreign':
      return 'storage.settings.migrationDeferredForeign'
    case 'deferred-retry':
      return 'storage.settings.migrationRetryLater'
    case 'deferred-unmovable': {
      const code = diagnosticValue(last, 'rename:')
      const attempts = Number(diagnosticValue(last, 'attempts:'))
      const merge = last.diagnostics?.includes('storage.migration.mergeRenameFailed') === true
      // The data-less `~/rox` could not be moved aside (e.g. Explorer holds
      // it open): it is `~/rox` that is busy, `~/.rox` stays the home.
      if (last.diagnostics?.includes('storage.migration.visibleNotRenamable') === true) {
        return code && IN_USE_CODES.has(code) ? 'storage.settings.migrationDeferredVisibleInUse' : 'storage.settings.migrationFailed'
      }
      // The failure that starts the 24 h hold (see `_mergeRetryBlocked`).
      if (merge && Number.isFinite(attempts) && attempts >= STORAGE_MERGE_TRANSIENT_RETRIES) {
        return 'storage.settings.migrationRetryLater'
      }
      // A pre-check deferral while `~/rox` is authoritative (it holds data):
      // Rox runs on `~/rox`, only the leftovers stay in `~/.rox`.
      if (!merge && last.diagnostics?.includes('uses:visible') === true) return 'storage.settings.migrationDeferredUnmovableVisible'
      if (code && IN_USE_CODES.has(code)) return 'storage.settings.migrationDeferredInUse'
      // Any other failed merge rename is held for 24 hours right away.
      if (merge) return 'storage.settings.migrationRetryLater'
      // Older state files carry no details: they were volume/mount deferrals.
      if (!code || UNMOVABLE_CODES.has(code)) return 'storage.settings.migrationDeferredUnmovable'
      return 'storage.settings.migrationFailed'
    }
    case 'symlink-elsewhere':
      // `~/.rox` links elsewhere: Rox uses `~/rox` when it holds user data
      // (`uses:visible`), otherwise the linked legacy dir.
      return last.diagnostics?.includes('uses:visible') === true
        ? 'storage.settings.migrationSymlinkElsewhere'
        : 'storage.settings.migrationFailed'
    case 'deferred-link':
    case 'failed':
      return 'storage.settings.migrationFailed'
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
