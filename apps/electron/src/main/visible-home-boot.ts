/**
 * W1-13 (#1510) review 2: the only automatic trigger of the visible-home
 * migration, plus the desktop app lifetime lock and the one-shot notice.
 *
 * - `runBootMigration` runs ONLY in the primary Electron main process, after
 *   `app.requestSingleInstanceLock()` succeeded (never in numbered instances,
 *   a second instance, craft-cli, the headless server or scripts — those only
 *   resolve the config dir, read-only). This process keeps the config dir it
 *   resolved at import time; a moved `~/.rox` is the compat link, so every
 *   path stays valid until the next launch resolves `~/rox`.
 * - `holdAppLock` writes `{pid,startedAt}` for the app's lifetime: a runtime
 *   twin in tmpdir always, and `.app.lock` in the config dir only with the
 *   flag ON (flag OFF leaves the config dir exactly as main). The migrator
 *   (`migrate-config` included) defers while it is live.
 * - The notice is taken once by a managed window (toast + conflicts list, or
 *   the foreign-folder warning).
 */
import { isVisibleRoxHomeActive, runVisibleHomeAutoMigration, type VisibleHomeAutoMigration } from '@rox/shared/config'
import { holdDesktopAppLock } from '@rox/shared/identity'
import { STORAGE_MIGRATION_NOTICE_CHANNELS, type StorageMigrationNotice } from '../shared/storage-visible-root'

type SenderEvent = { sender: { id: number } }

export function migrationNoticeFromBoot(boot: VisibleHomeAutoMigration | undefined): StorageMigrationNotice | null {
  const result = boot?.result
  if (!result || result.dryRun) return null
  if (result.outcome === 'migrated' || result.outcome === 'merged') {
    return { kind: result.outcome, conflicts: [...result.conflicts] }
  }
  if (result.outcome === 'deferred-foreign') return { kind: 'deferred-foreign', conflicts: [] }
  return null
}

export interface VisibleHomeBootDependencies {
  /** Primary instance that holds the single-instance lock (not numbered). */
  primary: boolean
  configDir: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  homeDir?: string
  migrate?: typeof runVisibleHomeAutoMigration
  holdLock?: typeof holdDesktopAppLock
  flagActive?: () => boolean
}

export interface VisibleHomeBoot {
  notice: StorageMigrationNotice | null
  /** Release the app lock (call on will-quit). */
  release(): void
}

export function runVisibleHomeBoot(deps: VisibleHomeBootDependencies): VisibleHomeBoot {
  const migrate = deps.migrate ?? runVisibleHomeAutoMigration
  const boot = deps.primary ? migrate({ env: deps.env, homeDir: deps.homeDir }) : undefined
  const flagActive = deps.flagActive ?? (() => isVisibleRoxHomeActive(deps.env, deps.homeDir))
  // After the migration: the lock never becomes migration data itself.
  const release = (deps.holdLock ?? holdDesktopAppLock)(deps.configDir, { inConfigDir: flagActive() })
  return { notice: migrationNoticeFromBoot(boot), release }
}

export function registerStorageMigrationNoticeIpc(deps: {
  ipcMain: { handle(channel: string, listener: (event: SenderEvent) => unknown): void }
  isTrustedSender(event: SenderEvent): boolean
  notice: StorageMigrationNotice | null
}): void {
  let pending = deps.notice
  deps.ipcMain.handle(STORAGE_MIGRATION_NOTICE_CHANNELS.TAKE, (event) => {
    if (!deps.isTrustedSender(event)) throw new Error('STORAGE_MIGRATION_NOTICE_DENIED')
    const notice = pending
    pending = null // shown once per launch
    return notice
  })
}
