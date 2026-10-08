/**
 * Craft-era → Rox config-directory migration with rollback (Issue 33).
 *
 * Copy-only: the original ~/.craft-agent tree is never deleted. Rollback
 * removes the Rox destination that this process created. Explicit env
 * overrides (ROX_CONFIG_DIR / CRAFT_CONFIG_DIR) skip auto-migration.
 */

import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ROX_BRAND_MIGRATION_VERSION,
  ROX_COMPAT_SYMLINK_NAME,
  ROX_CONFIG_DIR_NAME,
  ROX_HOME_DIR_NAME,
  ROX_LEGACY_CONFIG_DIR_NAME,
} from './manifest.ts'

export const ROX_MIGRATION_STAMP_NAME = '.rox-brand-migration.json'

export type BrandMigrationOutcome =
  | 'clean-install'
  | 'already-migrated'
  | 'migrated'
  | 'legacy-only'
  | 'skipped-env-override'
  | 'noop'

export interface BrandMigrationStamp {
  version: number
  source: string
  destination: string
  migratedAt: string
  originalPreserved: true
}

export interface BrandMigrationResult {
  outcome: BrandMigrationOutcome
  configDir: string
  stamp?: BrandMigrationStamp
  diagnostics: string[]
}

export interface BrandMigrationPaths {
  homeDir: string
  roxDir: string
  legacyDir: string
}

export function defaultBrandMigrationPaths(homeDir: string = homedir()): BrandMigrationPaths {
  return {
    homeDir,
    roxDir: join(homeDir, ROX_CONFIG_DIR_NAME),
    legacyDir: join(homeDir, ROX_LEGACY_CONFIG_DIR_NAME),
  }
}

export function stampPath(roxDir: string): string {
  return join(roxDir, ROX_MIGRATION_STAMP_NAME)
}

export function readMigrationStamp(roxDir: string): BrandMigrationStamp | undefined {
  const path = stampPath(roxDir)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BrandMigrationStamp
    if (
      parsed &&
      parsed.version === ROX_BRAND_MIGRATION_VERSION &&
      typeof parsed.source === 'string' &&
      typeof parsed.destination === 'string' &&
      parsed.originalPreserved === true
    ) {
      return parsed
    }
  } catch {
    return undefined
  }
  return undefined
}

function writeStamp(stamp: BrandMigrationStamp): void {
  mkdirSync(stamp.destination, { recursive: true })
  writeFileSync(stampPath(stamp.destination), `${JSON.stringify(stamp, null, 2)}\n`, 'utf8')
}

function hasEnvOverride(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  const rox = env.ROX_CONFIG_DIR?.trim()
  const craft = env.CRAFT_CONFIG_DIR?.trim()
  return Boolean(rox || craft)
}

function copyTree(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: false,
    force: true,
  })
}

/**
 * Copy ~/.craft-agent → ~/.rox once. Safe to call at boot.
 */
export function runBrandConfigMigration(options?: {
  homeDir?: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  now?: string
}): BrandMigrationResult {
  const env = options?.env ?? process.env
  const paths = defaultBrandMigrationPaths(options?.homeDir)
  const diagnostics: string[] = []

  if (hasEnvOverride(env)) {
    diagnostics.push('branding.migration.craftConfigDeprecated')
    return {
      outcome: 'skipped-env-override',
      configDir: (env.ROX_CONFIG_DIR?.trim() || env.CRAFT_CONFIG_DIR?.trim()) as string,
      diagnostics,
    }
  }

  const existingStamp = existsSync(paths.roxDir) ? readMigrationStamp(paths.roxDir) : undefined
  if (existingStamp) {
    return { outcome: 'already-migrated', configDir: paths.roxDir, stamp: existingStamp, diagnostics }
  }

  const hasRox = existsSync(paths.roxDir)
  const hasLegacy = existsSync(paths.legacyDir)

  if (!hasLegacy && !hasRox) {
    mkdirSync(paths.roxDir, { recursive: true })
    return { outcome: 'clean-install', configDir: paths.roxDir, diagnostics }
  }

  if (hasRox && !hasLegacy) {
    return { outcome: 'noop', configDir: paths.roxDir, diagnostics }
  }

  if (hasLegacy && !hasRox) {
    copyTree(paths.legacyDir, paths.roxDir)
    const stamp: BrandMigrationStamp = {
      version: ROX_BRAND_MIGRATION_VERSION,
      source: paths.legacyDir,
      destination: paths.roxDir,
      migratedAt: options?.now ?? new Date().toISOString(),
      originalPreserved: true,
    }
    writeStamp(stamp)
    diagnostics.push('branding.migration.completed')
    diagnostics.push('branding.migration.craftConfigDeprecated')
    return { outcome: 'migrated', configDir: paths.roxDir, stamp, diagnostics }
  }

  diagnostics.push('branding.migration.craftConfigDeprecated')
  return { outcome: 'legacy-only', configDir: paths.legacyDir, diagnostics }
}

/**
 * Remove the Rox destination created by a successful copy. Original Craft
 * data is left untouched.
 */
export function rollbackBrandConfigMigration(options?: {
  homeDir?: string
}): BrandMigrationResult {
  const paths = defaultBrandMigrationPaths(options?.homeDir)
  const stamp = existsSync(paths.roxDir) ? readMigrationStamp(paths.roxDir) : undefined
  if (!stamp) {
    return { outcome: 'noop', configDir: existsSync(paths.legacyDir) ? paths.legacyDir : paths.roxDir, diagnostics: [] }
  }
  rmSync(paths.roxDir, { recursive: true, force: true })
  return {
    outcome: 'legacy-only',
    configDir: paths.legacyDir,
    diagnostics: ['branding.migration.rollbackDone'],
  }
}

/** Copy the active Rox (or legacy) tree to an export directory. */
export function exportBrandConfig(destinationDir: string, options?: { homeDir?: string }): string {
  const paths = defaultBrandMigrationPaths(options?.homeDir)
  const source = existsSync(paths.roxDir) ? paths.roxDir : paths.legacyDir
  if (!existsSync(source)) {
    throw new Error('No Rox or Craft config directory to export')
  }
  copyTree(source, destinationDir)
  return destinationDir
}

/** Uninstall Rox data. Legacy Craft data stays unless `removeLegacy` is set. */
export function uninstallBrandConfig(options?: {
  homeDir?: string
  removeLegacy?: boolean
}): void {
  const paths = defaultBrandMigrationPaths(options?.homeDir)
  if (existsSync(paths.roxDir)) {
    rmSync(paths.roxDir, { recursive: true, force: true })
  }
  if (options?.removeLegacy && existsSync(paths.legacyDir)) {
    rmSync(paths.legacyDir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// W1-13 (#1510): hidden → visible Rox home migration, `~/.rox` → `~/rox`
// (MIG-13, TECH-SPEC §10.3, PRD D-v2-1 / D-v2-11 / D-v2-12).
//
// Safety contract:
// - Never deletes user data. The hidden tree is moved/renamed, never removed;
//   after a merge the original is kept as `.rox.migrated-<ts>`. A legacy dir
//   that cannot be renamed (mount point, file in use) defers; nothing is
//   copied into `~/rox` while `~/.rox` is the live tree. Only byte-identical
//   duplicates of a data-less `~/rox` moved aside are dropped.
// - With both trees present the authoritative one is the one the read-only
//   resolution uses (`~/rox` when it holds user data), before, during and
//   after a failed attempt.
// - `~/.rox` is left as a symlink (Windows: directory junction) to `~/rox`.
// - Live locked files (server-core / storage writers) defer the migration;
//   stale locks (dead PID, previous boot, expired TTL) do not.
// - A `~/.rox` symlink pointing elsewhere is a no-op with a warning.
// - Every run is executed with a temp HOME in tests (`mkdtemp`) and an
//   injected `homeDir` — never against the real home directory.
// ---------------------------------------------------------------------------

import { createHash as _createMigrationHash } from 'node:crypto'
import {
  appendFileSync as _appendMigrationFile,
  chmodSync as _chmodMigration,
  copyFileSync as _copyMigrationFile,
  lstatSync as _lstatMigration,
  openSync as _openMigrationLock,
  closeSync as _closeMigrationLock,
  linkSync as _linkMigration,
  readdirSync as _readdirMigration,
  readFileSync as _readMigrationFile,
  readlinkSync as _readlinkMigration,
  readSync as _readMigrationFd,
  renameSync as _renameMigration,
  rmdirSync as _rmdirMigration,
  statSync as _statMigration,
  symlinkSync as _symlinkMigration,
  unlinkSync as _unlinkMigration,
  utimesSync as _utimesMigration,
  writeFileSync as _writeMigrationFile,
  writeSync as _writeMigrationFd,
} from 'node:fs'
import { uptime as _osUptime } from 'node:os'
import { basename as _basenameMigration, dirname as _dirnameMigration, isAbsolute as _isAbsoluteMigration, relative as _relativeMigration, resolve as _resolveMigration, sep as _pathSep, posix as _posixPath, win32 as _win32Path } from 'node:path'
import { createHash as _createLockHash, randomBytes as _randomLockBytes } from 'node:crypto'
import { accessSync as _accessMigration, constants as _fsConstants, realpathSync as _realpathMigration } from 'node:fs'

/** Name of the visible Rox home inside a home directory. */
export const ROX_VISIBLE_HOME_DIR_NAME = ROX_HOME_DIR_NAME
/** Name left behind as a compatibility symlink. */
export const ROX_HIDDEN_HOME_LINK_NAME = ROX_COMPAT_SYMLINK_NAME

/** Workbench flag id (mirrors `WORKBENCH_FLAG.storageVisibleRootV1`). */
export const ROX_STORAGE_VISIBLE_ROOT_FLAG_ID = 'storage.visible-root.v1'

/**
 * Persisted workbench-flag file inside the current config dir.
 * Shape: `{ "enabled": ["storage.visible-root.v1", ...] }`.
 * Written atomically by Electron main when the user toggles the flag in
 * Settings (takes effect on next launch); read before the config dir is
 * resolved (see `visibleRootFlagFilePath`).
 */
export const ROX_WORKBENCH_FLAGS_FILE_NAME = 'workbench-flags.json'

/** A directory holding at least one Rox marker (config.json, workspaces, ...). */
function _isRoxHomeDir(dir: string): boolean {
  try {
    return _readdirMigration(dir).some((name) => ROX_HOME_MARKER_NAMES.includes(name))
  } catch {
    return false
  }
}

/**
 * The single `workbench-flags.json` that decides `storage.visible-root.v1`.
 * `~/rox/workbench-flags.json` counts only once `~/rox` is a Rox home (has a
 * marker); otherwise the legacy file. Whichever of the two exists is used
 * (visible first), so a foreign or freshly created `~/rox` (a checkout, a
 * stray mkdir) never flips the persisted flag. Reader and writer share this
 * path so a toggle always lands in the file `resolveConfigDir()` reads.
 */
export function visibleRootFlagFilePath(homeDir: string = homedir()): string {
  const visibleDir = join(homeDir, ROX_VISIBLE_HOME_DIR_NAME)
  const visibleFile = join(visibleDir, ROX_WORKBENCH_FLAGS_FILE_NAME)
  const legacyFile = join(homeDir, ROX_HIDDEN_HOME_LINK_NAME, ROX_WORKBENCH_FLAGS_FILE_NAME)
  const visibleIsHome = _isRoxHomeDir(visibleDir)
  if (visibleIsHome && existsSync(visibleFile)) return visibleFile
  if (existsSync(legacyFile)) return legacyFile
  return visibleIsHome ? visibleFile : legacyFile
}

/**
 * Last migration outcome the user should know about (Settings → Storage):
 * a deferral, or a move that needs a relaunch. A small per-user state file
 * next to `workbench-flags.json`, written atomically by the app's boot
 * migration; cleared on success and when the flag goes OFF.
 */
export const ROX_STORAGE_MIGRATION_STATE_FILE_NAME = 'storage-migration-state.json'

export type StorageMigrationStateKind =
  | 'deferred-unmovable'
  | 'deferred-locked'
  | 'deferred-retry'
  | 'deferred-foreign'
  | 'deferred-link'
  | 'symlink-elsewhere'
  | 'relaunch-required'
  | 'failed'

export interface StorageMigrationState {
  kind: StorageMigrationStateKind
  /** First diagnostic code (e.g. `storage.migration.legacyNotRenamable`). */
  diagnostic?: string
  /** All diagnostics of that run (codes and details). */
  diagnostics: string[]
  /** ISO timestamp of the run. */
  at: string
}

/** Non-usable migration outcomes that are recorded for Settings. */
const _RECORDED_MIGRATION_OUTCOMES: ReadonlySet<string> = new Set([
  'deferred-unmovable',
  'deferred-locked',
  'deferred-retry',
  'deferred-foreign',
  'deferred-link',
  'symlink-elsewhere',
])

const _STORAGE_MIGRATION_STATE_KINDS: ReadonlySet<string> = new Set([
  ..._RECORDED_MIGRATION_OUTCOMES,
  'relaunch-required',
  'failed',
])

export function storageMigrationStateFilePath(homeDir: string = homedir()): string {
  return join(_dirnameMigration(visibleRootFlagFilePath(homeDir)), ROX_STORAGE_MIGRATION_STATE_FILE_NAME)
}

/** Best effort; a missing or malformed file reads as no state. */
export function readStorageMigrationState(homeDir: string = homedir()): StorageMigrationState | undefined {
  try {
    const parsed = JSON.parse(readFileSync(storageMigrationStateFilePath(homeDir), 'utf8')) as Partial<StorageMigrationState>
    if (typeof parsed?.kind !== 'string' || !_STORAGE_MIGRATION_STATE_KINDS.has(parsed.kind)) return undefined
    if (typeof parsed.at !== 'string') return undefined
    const diagnostics = Array.isArray(parsed.diagnostics)
      ? parsed.diagnostics.filter((value): value is string => typeof value === 'string')
      : []
    return {
      kind: parsed.kind as StorageMigrationStateKind,
      ...(typeof parsed.diagnostic === 'string' ? { diagnostic: parsed.diagnostic } : {}),
      diagnostics,
      at: parsed.at,
    }
  } catch {
    return undefined
  }
}

/** Atomic (no-follow temp + rename). Never creates a home dir: skipped when the dir is missing. */
export function writeStorageMigrationState(state: StorageMigrationState, homeDir: string = homedir()): void {
  const file = storageMigrationStateFilePath(homeDir)
  if (!existsSync(_dirnameMigration(file))) return
  _writeFileAtomicNoFollow(file, `${JSON.stringify(state, null, 2)}\n`)
}

export function clearStorageMigrationState(homeDir: string = homedir()): void {
  try {
    _unlinkMigration(storageMigrationStateFilePath(homeDir))
  } catch {
    // absent
  }
}

/**
 * Persist what Settings should explain after a boot migration: every
 * non-usable outcome (deferrals, a foreign `~/rox`, a link elsewhere) and
 * `relaunchRequired`. Every other outcome clears it, so a stale message
 * never outlives the run that produced it. Thrown errors: see
 * `recordStorageMigrationFailure`.
 */
export function recordStorageMigrationOutcome(
  result: Pick<VisibleHomeMigrationResult, 'outcome' | 'diagnostics' | 'dryRun' | 'relaunchRequired'> | undefined,
  homeDir: string = homedir(),
  now: number = Date.now(),
): void {
  if (!result || result.dryRun) return
  const kind: StorageMigrationStateKind | undefined = result.relaunchRequired
    ? 'relaunch-required'
    : _RECORDED_MIGRATION_OUTCOMES.has(result.outcome)
      ? (result.outcome as StorageMigrationStateKind)
      : undefined
  if (kind) {
    writeStorageMigrationState(
      {
        kind,
        ...(result.diagnostics[0] ? { diagnostic: result.diagnostics[0] } : {}),
        diagnostics: [...result.diagnostics],
        at: new Date(now).toISOString(),
      },
      homeDir,
    )
    return
  }
  clearStorageMigrationState(homeDir)
}

/** A boot migration that threw: recorded as `failed` with the error code. */
export function recordStorageMigrationFailure(error: unknown, homeDir: string = homedir(), now: number = Date.now()): void {
  const code = (error as NodeJS.ErrnoException | null)?.code
  writeStorageMigrationState(
    {
      kind: 'failed',
      diagnostic: 'storage.migration.failed',
      diagnostics: ['storage.migration.failed', `error:${typeof code === 'string' && code ? code : 'unknown'}`],
      at: new Date(now).toISOString(),
    },
    homeDir,
  )
}

function _readEnabledFlags(file: string): string[] | undefined {
  try {
    if (!existsSync(file)) return undefined
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const enabled =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as { enabled?: unknown }).enabled
        : undefined
    if (!Array.isArray(enabled)) return undefined
    return enabled.filter((value): value is string => typeof value === 'string')
  } catch {
    return undefined
  }
}

/**
 * Best-effort read of the persisted `storage.visible-root.v1` flag.
 * Missing files and malformed JSON read as OFF — never throws. Uncached:
 * `resolveConfigDir()` caches the probe per process.
 */
export function readPersistedVisibleRootFlag(homeDir: string = homedir()): boolean {
  return _readEnabledFlags(visibleRootFlagFilePath(homeDir))?.includes(ROX_STORAGE_VISIBLE_ROOT_FLAG_ID) === true
}

/**
 * Persist the `storage.visible-root.v1` toggle (Settings → Storage) to
 * `visibleRootFlagFilePath(homeDir)`: read-modify-write of the `enabled`
 * list, written to a temp file and renamed into place (atomic). Unknown
 * flag ids already in the file are kept. Does not create the visible home:
 * when neither dir exists the legacy dir is created (0700), as on main.
 * Returns the file path written.
 */
export function writePersistedVisibleRootFlag(enabled: boolean, homeDir: string = homedir()): string {
  return _writeVisibleRootFlagFile(visibleRootFlagFilePath(homeDir), enabled)
}

/** Read-modify-write of one `workbench-flags.json` (temp + rename). */
function _writeVisibleRootFlagFile(file: string, enabled: boolean): string {
  const current = _readEnabledFlags(file) ?? []
  const next = current.filter((id) => id !== ROX_STORAGE_VISIBLE_ROOT_FLAG_ID)
  if (enabled) next.push(ROX_STORAGE_VISIBLE_ROOT_FLAG_ID)
  const dir = _dirnameMigration(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  _writeMigrationFile(temp, `${JSON.stringify({ enabled: next.sort() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    _renameMigration(temp, file)
  } catch (error) {
    try {
      _unlinkMigration(temp)
    } catch {
      // temp already gone
    }
    throw error
  }
  return file
}

function _parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value == null) return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

/** Env override for the flag (`ROX_STORAGE_VISIBLE_ROOT`, deprecated CRAFT alias). */
export function visibleRootEnvOverride(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean | undefined {
  const rox = _parseBooleanFlag(env.ROX_STORAGE_VISIBLE_ROOT?.trim() || undefined)
  if (rox !== undefined) return rox
  return _parseBooleanFlag(env.CRAFT_FEATURE_STORAGE_VISIBLE_ROOT?.trim() || undefined)
}

/** Manifest file written into the hidden tree before it moves (removed after verification). */
export const ROX_HOME_MIGRATION_MANIFEST_NAME = '.migration-manifest.json'
/** Directory (under `~/rox`) for reports, conflicts and the audit trail. */
export const ROX_HOME_MIGRATION_DIR_NAME = '.migration'

/** Max age of a migration/revert process lock before it is treated as stale. */
export const ROX_MIGRATION_LOCK_TTL_MS = 30 * 60 * 1000
/** Max age of a lock file without a parseable PID before it is treated as stale. */
export const ROX_PIDLESS_LOCK_TTL_MS = 10 * 60 * 1000

export type VisibleHomeOutcome =
  | 'clean-install'
  | 'already-visible'
  | 'already-symlinked'
  | 'migrated'
  | 'merged'
  | 'symlink-elsewhere'
  | 'deferred-locked'
  | 'deferred-foreign'
  | 'deferred-link'
  | 'deferred-unmovable'
  | 'deferred-retry'
  | 'reverted'
  | 'revert-refused'
  | 'skipped-env-override'
  | 'noop'

/**
 * Outcomes after which `~/rox` holds the user's data and is safe to use as
 * the config dir. Anything else (deferred, symlink elsewhere, errors) keeps
 * the legacy dir so nobody is stranded on an empty `~/rox`.
 */
export const VISIBLE_HOME_USABLE_OUTCOMES: ReadonlySet<VisibleHomeOutcome> = new Set<VisibleHomeOutcome>([
  'clean-install',
  'already-visible',
  'already-symlinked',
  'migrated',
  'merged',
])

export interface VisibleHomeManifestEntry {
  /** POSIX-style path relative to the migrated root. */
  path: string
  kind: 'file' | 'symlink' | 'dir'
  size?: number
  /** Only when built with `{ hash: true }` (tests). */
  sha256?: string
  /** Permission bits (`stat.mode & 0o777`). */
  mode?: number
  /** Symlink target (for `kind: 'symlink'`). */
  link?: string
  mtimeMs?: number
}

export interface VisibleHomeManifestSummary {
  files: number
  dirs: number
  symlinks: number
  bytes: number
}

export interface VisibleHomeMigrationResult {
  outcome: VisibleHomeOutcome
  visibleDir: string
  hiddenDir: string
  /** True when nothing was written (preview only). */
  dryRun: boolean
  manifest: VisibleHomeManifestEntry[]
  /** Relative paths stashed under `.migration/conflicts/` during a merge. */
  conflicts: string[]
  /** i18n diagnostic keys / human-readable warnings. */
  diagnostics: string[]
  /** Report file under `~/rox/.migration/`, when written. */
  reportPath?: string
  /** Set on migrated/merged runs: the UI shows the move toast once. */
  announceToast: boolean
  /**
   * The data is in `~/rox` but the `~/.rox` compat link could not be created
   * (and a rollback was impossible): a process running on the legacy path
   * must restart onto `~/rox` instead of continuing on a vanished dir.
   */
  relaunchRequired?: boolean
}

export interface MigrateHiddenRoxHomeOptions {
  homeDir?: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  /** Preview only: compute the outcome, write nothing. */
  dryRun?: boolean
  /** `win32` forces directory-junction semantics (also unit-testable). */
  platform?: NodeJS.Platform
  /** Filename-safe timestamp (`migrated-<ts>` / `report-<ts>.json`). */
  timestamp?: string
  /** Injectable atomic rename (tests throw `{ code: 'EXDEV' }`). */
  rename?: (source: string, destination: string) => void
  /** Injectable compat-link creation (tests assert junction on win32). */
  linkDir?: (target: string, path: string, type: 'dir' | 'junction') => void
  /**
   * Lock probe: return holder descriptions when migration must be deferred
   * (e.g. live `config.json.lock` / `.server.lock` writers). Default checks
   * the known server-core / storage lock files and their PID liveness.
   */
  isLocked?: (hiddenDir: string) => string[]
  /** Skip the process lock file (tests running migrations concurrently). */
  skipProcessLock?: boolean
  /** Process lock path (default `$HOME/.rox-migrate.lock`, next to the homes). */
  processLockPath?: string
  /** Current uid for lock owner checks (tests; default `process.getuid()`). */
  getuid?: () => number | undefined
  /** Injectable lstat for lock owner checks (tests fake a foreign owner). */
  lockLstat?: (path: string) => import('node:fs').Stats
  /** Test-only hook into the process-lock takeover (simulates a racing migrator). */
  lockTakeoverHook?: (phase: 'stale-judged' | 'created') => void
  /** Injectable PID liveness probe (tests). */
  isPidAlive?: (pid: number) => boolean
  /** Injectable clock (tests). */
  now?: () => number
  /** Revert only: whether the visible-root flag is active (default: env + persisted file). */
  flagActive?: boolean
  /** Runtime desktop-lock path for a config dir (tests; replaces every `desktopAppRuntimeLockPaths` location). */
  desktopRuntimeLockPath?: (configDir: string) => string
  /**
   * Injectable byte copy into a fresh temp file (tests simulate a crash
   * mid-copy: write partial bytes, then throw). Default `copyFileSync` with
   * `COPYFILE_EXCL`.
   */
  copyFile?: (source: string, destination: string) => void
  /**
   * Injectable link creation for links inside the trees (tests assert the
   * Windows junction type and simulate EPERM for file symlinks). Default
   * `symlinkSync`.
   */
  symlink?: _SymlinkFn
  /**
   * Retry a failed merge at once, even while `_mergeRetryBlocked` holds it
   * (an explicit `migrate-config`). The boot migration retries a transient
   * failure at the next launches (`ROX_MERGE_TRANSIENT_RETRIES`), otherwise
   * after `ROX_MERGE_RETRY_COOLDOWN_MS`.
   */
  retryFailedMerge?: boolean
  /** Merged entries between two heartbeats of the migration lock (tests). */
  lockHeartbeatEvery?: number
}

/** A held failed merge (see `_mergeRetryBlocked`) is retried after this long. */
export const ROX_MERGE_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000

/** Default merged entries between two migration-lock heartbeats. */
const _LOCK_HEARTBEAT_EVERY = 256

export interface VisibleHomePaths {
  homeDir: string
  hiddenDir: string
  visibleDir: string
}

export function defaultVisibleHomePaths(homeDir: string = homedir()): VisibleHomePaths {
  return {
    homeDir,
    hiddenDir: join(homeDir, ROX_HIDDEN_HOME_LINK_NAME),
    visibleDir: join(homeDir, ROX_VISIBLE_HOME_DIR_NAME),
  }
}

function _migrationTimestamp(options?: MigrateHiddenRoxHomeOptions): string {
  if (options?.timestamp) return options.timestamp
  return new Date().toISOString().replace(/[:.]/g, '-')
}

// --- Lock identity (PID + timestamp) ----------------------------------------
// Same lock shapes as server-core's `.server.lock` (`{ pid, startedAt,
// execName? }` JSON, or a legacy plain PID); see
// packages/server-core/src/bootstrap/lock-identity.ts. `@rox/shared` cannot
// import server-core, so the liveness decision is mirrored here.

export interface MigrationLockIdentity {
  pid: number
  /** ms since epoch; 0 when unknown (legacy plain-PID locks). */
  startedAt: number
}

export function parseMigrationLockContent(raw: string): MigrationLockIdentity | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const pid = typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) ? parsed.pid : NaN
      const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : 0
      if (!Number.isNaN(pid) && pid > 0) return { pid, startedAt }
    } catch {
      // fall through to the plain-PID parse
    }
    return null
  }
  if (!/^\d+$/.test(trimmed)) return null
  const pid = Number.parseInt(trimmed, 10)
  return pid > 0 ? { pid, startedAt: 0 } : null
}

export function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else — still alive.
    return (error as NodeJS.ErrnoException | null)?.code === 'EPERM'
  }
}

/** Owner checks for lock files and lock dirs (injectable in tests). */
export interface LockOwnershipOptions {
  /** Current uid; `undefined` (Windows) skips the owner check. Default `process.getuid()`. */
  getuid?: () => number | undefined
  /** Injectable lstat (tests fake a foreign owner). */
  lstat?: (path: string) => import('node:fs').Stats
}

interface LockLivenessOptions extends LockOwnershipOptions {
  now: number
  isPidAlive: (pid: number) => boolean
  /** Locks older than this are stale even with a live PID (PID reuse). */
  ttlMs?: number
  /** Max age for locks without a parseable PID. */
  pidlessTtlMs: number
}

function _currentUid(): number | undefined {
  try {
    return process.getuid?.()
  } catch {
    return undefined
  }
}

/**
 * A lock entry we may trust: a regular file or a directory (proper-lockfile
 * style), never a link, owned by the current user. Anything else (a link
 * planted in a shared dir, a file another user created) is ignored.
 */
function _ownLockStat(path: string, options?: LockOwnershipOptions): import('node:fs').Stats | undefined {
  let st: import('node:fs').Stats
  try {
    st = (options?.lstat ?? _lstatMigration)(path)
  } catch {
    return undefined
  }
  if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) return undefined
  const uid = (options?.getuid ?? _currentUid)()
  if (uid !== undefined && st.uid !== uid) return undefined
  return st
}

const _O_NOFOLLOW = _fsConstants.O_NOFOLLOW ?? 0

/** Read a lock file without following a link at its path. */
function _readLockNoFollow(path: string): string {
  const fd = _openMigrationLock(path, _fsConstants.O_RDONLY | _O_NOFOLLOW)
  try {
    return _readMigrationFile(fd, 'utf8')
  } finally {
    _closeMigrationLock(fd)
  }
}

/**
 * Write a lock file atomically without ever writing through a link: a fresh
 * temp with a random suffix is created with O_EXCL|O_NOFOLLOW (0600), then
 * renamed over the lock path (a rename replaces a planted link, it never
 * follows it).
 */
/** Test hooks for the win32 rename retry in `_writeFileAtomicNoFollow`. */
export interface AtomicLockWriteIo {
  platform?: NodeJS.Platform
  rename?: (source: string, destination: string) => void
  sleep?: (ms: number) => void
}

/** Backoff (≈1 s total) for a win32 rename blocked by a reader/AV scanner. */
const _WIN32_RENAME_RETRY_MS = [25, 50, 100, 200, 300, 325]
const _WIN32_TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

function _sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    // no Atomics.wait: retry immediately
  }
}

/**
 * Rename, retried briefly on win32 when the destination is momentarily
 * held open (EPERM/EACCES/EBUSY from a reader or an antivirus scanner).
 */
export function _renameWithWin32Retry(source: string, destination: string, io?: AtomicLockWriteIo): void {
  const rename = io?.rename ?? _renameMigration
  if ((io?.platform ?? process.platform) !== 'win32') {
    rename(source, destination)
    return
  }
  const sleep = io?.sleep ?? _sleepSync
  for (let attempt = 0; ; attempt++) {
    try {
      rename(source, destination)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (attempt >= _WIN32_RENAME_RETRY_MS.length || !code || !_WIN32_TRANSIENT_RENAME_CODES.has(code)) throw error
      sleep(_WIN32_RENAME_RETRY_MS[attempt]!)
    }
  }
}

export function _writeFileAtomicNoFollow(path: string, content: string, io?: AtomicLockWriteIo): void {
  const temp = `${path}.tmp-${process.pid}-${_randomLockBytes(8).toString('hex')}`
  const fd = _openMigrationLock(
    temp,
    _fsConstants.O_WRONLY | _fsConstants.O_CREAT | _fsConstants.O_EXCL | _O_NOFOLLOW,
    0o600,
  )
  try {
    try {
      _writeMigrationFd(fd, content)
    } finally {
      _closeMigrationLock(fd)
    }
    _renameWithWin32Retry(temp, path, io)
  } catch (error) {
    try {
      _unlinkMigration(temp)
    } catch {
      // already gone
    }
    throw error
  }
}

/** Whether `path` is a lock file we wrote with exactly `content`. */
function _isOwnLockWithContent(path: string, content: string, options?: LockOwnershipOptions): boolean {
  const st = _ownLockStat(path, options)
  if (!st?.isFile()) return false
  try {
    return _readLockNoFollow(path) === content
  } catch {
    return false
  }
}

/**
 * Whether a lock file still has a live holder. Stale: own PID (previous
 * container lifecycle), dead PID, written before the current boot, older
 * than `ttlMs`, or PID-less and older than `pidlessTtlMs`. Links and locks
 * owned by another user are ignored (never live).
 */
export function isLockFileLive(path: string, options: LockLivenessOptions): boolean {
  const st = _ownLockStat(path, options)
  if (!st) return false
  let identity: MigrationLockIdentity | null = null
  if (st.isFile()) {
    try {
      identity = parseMigrationLockContent(_readLockNoFollow(path))
    } catch {
      identity = null
    }
  }
  if (!identity) {
    // Directory locks (proper-lockfile style) or unparseable files: age only.
    return options.now - st.mtimeMs < options.pidlessTtlMs
  }
  if (identity.pid === process.pid) return false
  if (!options.isPidAlive(identity.pid)) return false
  const writtenAt = identity.startedAt > 0 ? identity.startedAt : st.mtimeMs
  let bootTime = 0
  try {
    // Real clock: boot time is a property of this machine, not of `now`.
    bootTime = Date.now() - _osUptime() * 1000
  } catch {
    bootTime = 0
  }
  // Written before the current boot (startedAt, else the file mtime — legacy
  // plain-PID locks carry no timestamp): the PID was reused, not ours.
  if (bootTime > 0 && writtenAt < bootTime) return false
  // TTL from the last sign of life: a long merge touches its lock (mtime).
  const lastSeen = Math.max(writtenAt, st.mtimeMs)
  if (options.ttlMs !== undefined && options.now - lastSeen > options.ttlMs) return false
  return true
}

/**
 * Lifetime lock of a running desktop app (Electron main) inside the config
 * dir it uses: `{ pid, startedAt }`, held from right after the single-instance
 * lock until quit. Written only while `storage.visible-root.v1` is active
 * (flag OFF leaves the config dir exactly as main); the runtime lock below is
 * held in both modes.
 */
export const ROX_DESKTOP_APP_LOCK_NAME = '.app.lock'

/** Lock files inside a Rox home whose live holders must defer a move. */
export const ROX_HOME_WRITER_LOCK_NAMES = ['config.json.lock', '.server.lock', ROX_DESKTOP_APP_LOCK_NAME] as const

function _lockUid(options?: LockOwnershipOptions): string {
  return String((options?.getuid ?? _currentUid)() ?? 'default')
}

export interface RuntimeLockLocationOptions extends LockOwnershipOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  /** Process tmpdir (default `os.tmpdir()`). */
  tmp?: string
  /** Shared POSIX tmp (default `/tmp`; `null` skips it, tests). */
  sharedTmp?: string | null
  platform?: NodeJS.Platform
  /** Create the per-user subdir in shared bases (the app); probes never create. */
  create?: boolean
}

/**
 * A base dir is private when it is a real directory (not a link) owned by
 * the current user and not group/other-writable (macOS per-user TMPDIR,
 * `$XDG_RUNTIME_DIR`). Mode bits are not checked on Windows.
 */
function _isPrivateLockDir(path: string, options?: RuntimeLockLocationOptions): boolean {
  const st = _ownLockStat(path, options)
  if (!st?.isDirectory()) return false
  if ((options?.platform ?? process.platform) !== 'win32' && (st.mode & 0o022) !== 0) return false
  return true
}

/**
 * Lock dir inside `base`: the base itself when private, else a per-user
 * `rox-<uid>/` subdir (created 0700 by the app, then verified with lstat:
 * own, real dir, not group/other-writable). A failed check skips the
 * location silently.
 */
function _runtimeLockDir(base: string, options?: RuntimeLockLocationOptions): string | undefined {
  if (_isPrivateLockDir(base, options)) return base
  const dir = join(base, `rox-${_lockUid(options)}`)
  if (options?.create) {
    try {
      mkdirSync(dir, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') return undefined
    }
  }
  return _isPrivateLockDir(dir, options) ? dir : undefined
}

function _runtimeLockName(configDir: string, options?: LockOwnershipOptions): string {
  const key = _createLockHash('sha256').update(configDir).digest('hex').slice(0, 16)
  return `rox-desktop-${_lockUid(options)}-${key}.lock`
}

/**
 * Per-user runtime twin of the desktop app lock, outside the home, keyed by
 * the config dir path the app runs on (original location: directly in
 * tmpdir). Lets an explicit `migrate-config` defer while a flag-OFF app runs
 * without adding a file to the config dir. See `desktopAppRuntimeLockPaths`
 * for the locations actually written.
 */
export function desktopAppRuntimeLockPath(configDir: string, tmp: string = tmpdir()): string {
  return join(tmp, _runtimeLockName(configDir))
}

function _runtimeLockBases(options?: RuntimeLockLocationOptions): string[] {
  const env = options?.env ?? process.env
  const bases = [options?.tmp ?? tmpdir()]
  const runtimeDir = env.XDG_RUNTIME_DIR?.trim()
  if (runtimeDir && _posixPath.isAbsolute(runtimeDir)) bases.push(runtimeDir)
  const shared = options?.sharedTmp === undefined ? '/tmp' : options.sharedTmp
  if ((options?.platform ?? process.platform) !== 'win32' && shared) bases.push(shared)
  return [...new Set(bases)]
}

/**
 * Every usable runtime desktop-lock location: the process tmpdir,
 * `$XDG_RUNTIME_DIR` when set, and `/tmp` on POSIX, each used directly when
 * private or through a verified per-user `rox-<uid>/` subdir when shared.
 * A CLI and an app with different `TMPDIR`s still meet in one of them.
 * Never under `$HOME`: a flag-OFF app adds nothing to the home.
 * Limitation: processes in different mount namespaces (snap/flatpak private
 * `/tmp` without a shared runtime dir) or under another uid cannot see each
 * other's runtime lock; the in-config-dir `.app.lock` (flag ON) still does.
 */
export function desktopAppRuntimeLockPaths(configDir: string, options?: RuntimeLockLocationOptions): string[] {
  const name = _runtimeLockName(configDir, options)
  const out: string[] = []
  for (const base of _runtimeLockBases(options)) {
    const dir = _runtimeLockDir(base, options)
    if (dir) out.push(join(dir, name))
  }
  return [...new Set(out)]
}

/**
 * Electron main: hold the desktop app lock(s) for the process lifetime.
 * Returns the release function (call on quit). Best effort: a failed write
 * never blocks startup. Every lock is written with `_writeFileAtomicNoFollow`
 * (random-suffix O_EXCL|O_NOFOLLOW temp, then rename).
 */
export function holdDesktopAppLock(
  configDir: string,
  options: {
    inConfigDir: boolean
    now?: number
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>
    /** Runtime lock locations (tests; default `desktopAppRuntimeLockPaths`). */
    runtimeLockPaths?: string[]
  },
): () => void {
  const content = JSON.stringify({
    pid: process.pid,
    startedAt: options.now ?? Date.now(),
    kind: 'desktop-app',
    nonce: _randomLockBytes(8).toString('hex'),
  })
  const paths = [
    ...(options.runtimeLockPaths ?? desktopAppRuntimeLockPaths(configDir, { env: options.env ?? process.env, create: true })),
  ]
  if (options.inConfigDir) paths.push(join(configDir, ROX_DESKTOP_APP_LOCK_NAME))
  const held: string[] = []
  for (const path of paths) {
    try {
      _writeFileAtomicNoFollow(path, content)
      held.push(path)
    } catch {
      // best effort
    }
  }
  return () => {
    for (const path of held) {
      try {
        if (_isOwnLockWithContent(path, content)) _unlinkMigration(path)
      } catch {
        // already gone
      }
    }
  }
}

function _liveHomeLockHolders(dir: string, options?: MigrateHiddenRoxHomeOptions): string[] {
  const now = options?.now?.() ?? Date.now()
  const isPidAlive = options?.isPidAlive ?? defaultIsPidAlive
  const holders: string[] = []
  const probes: Array<[string, string]> = ROX_HOME_WRITER_LOCK_NAMES.map((name) => [name, join(dir, name)])
  const own: LockOwnershipOptions = { getuid: options?.getuid, lstat: options?.lockLstat }
  const runtimeLocks = options?.desktopRuntimeLockPath
    ? [options.desktopRuntimeLockPath(dir)]
    : desktopAppRuntimeLockPaths(dir, { env: options?.env ?? process.env, ...own, create: false })
  for (const path of runtimeLocks) probes.push(['desktop-app', path])
  let desktopLive = false
  for (const [name, path] of probes) {
    if (name === 'desktop-app' && desktopLive) continue
    try {
      // `.server.lock` / `.app.lock` are long-lived PID files (a server or the
      // app may run for days): liveness + boot time decide, no TTL.
      if (isLockFileLive(path, { now, isPidAlive, pidlessTtlMs: ROX_PIDLESS_LOCK_TTL_MS, ...own })) {
        holders.push(name)
        if (name === 'desktop-app') desktopLive = true
      }
    } catch {
      // unreadable — do not block on a failed probe
    }
  }
  return holders
}

/** Chunk size of streamed reads (hashing, byte comparison): never a whole-file buffer. */
const _STREAM_CHUNK_BYTES = 1024 * 1024

/** Calls `onChunk` for each chunk of a regular file (no-follow open where supported). */
function _forEachFileChunk(path: string, onChunk: (chunk: Buffer) => void): void {
  const fd = _openMigrationLock(path, _fsConstants.O_RDONLY | _O_NOFOLLOW)
  try {
    const buffer = Buffer.allocUnsafe(_STREAM_CHUNK_BYTES)
    for (;;) {
      const read = _readMigrationFd(fd, buffer, 0, buffer.length, null)
      if (read <= 0) return
      onChunk(buffer.subarray(0, read))
    }
  } finally {
    _closeMigrationLock(fd)
  }
}

/** sha256 of a file, streamed in 1 MiB chunks (no `readFileSync`: files of any size). */
function _sha256File(path: string): string {
  const hash = _createMigrationHash('sha256')
  if (_statMigration(path).isFile()) _forEachFileChunk(path, (chunk) => hash.update(chunk))
  return hash.digest('hex')
}

/** Byte equality of two regular files, streamed chunk by chunk with an early exit. */
function _sameBytes(a: string, b: string): boolean {
  const fdA = _openMigrationLock(a, _fsConstants.O_RDONLY | _O_NOFOLLOW)
  try {
    const fdB = _openMigrationLock(b, _fsConstants.O_RDONLY | _O_NOFOLLOW)
    try {
      const bufA = Buffer.allocUnsafe(_STREAM_CHUNK_BYTES)
      const bufB = Buffer.allocUnsafe(_STREAM_CHUNK_BYTES)
      for (;;) {
        const readA = _readMigrationFd(fdA, bufA, 0, bufA.length, null)
        let readB = 0
        while (readB < readA) {
          const n = _readMigrationFd(fdB, bufB, readB, readA - readB, null)
          if (n <= 0) break
          readB += n
        }
        if (readA !== readB) return false
        if (readA === 0) return _readMigrationFd(fdB, bufB, 0, 1, null) === 0
        if (!bufA.subarray(0, readA).equals(bufB.subarray(0, readB))) return false
      }
    } finally {
      _closeMigrationLock(fdB)
    }
  } finally {
    _closeMigrationLock(fdA)
  }
}

/**
 * Two regular files hold the same content. Equal size plus the same mtime (to
 * the millisecond: a copy made by the merge keeps both) counts as identical
 * without reading anything; otherwise the bytes are compared in chunks.
 * `trustMeta: false` always compares bytes (used before deleting a file).
 */
function _filesIdentical(
  a: string,
  statA: import('node:fs').Stats,
  b: string,
  statB: import('node:fs').Stats,
  options?: { trustMeta?: boolean },
): boolean {
  if (statA.size !== statB.size) return false
  // Within 1 ms: a copy's mtime is set from a millisecond Date (rounded or truncated).
  if (options?.trustMeta !== false && Math.abs(statA.mtimeMs - statB.mtimeMs) < 1) return true
  return _sameBytes(a, b)
}

function _posixRel(root: string, absolute: string): string {
  return _relativeMigration(root, absolute).split(_pathSep).join('/')
}

/**
 * Walk `root` and record every entry (files with size + mode + mtime, plus
 * sha256 when `hash` is set — default true for callers/tests; the migrator
 * itself never hashes on the atomic-rename path). `.migration/` output and
 * the migration manifest itself are excluded so the manifest is stable across
 * the move (equality property test).
 */
export function buildVisibleHomeManifest(
  root: string,
  options?: { hash?: boolean },
): VisibleHomeManifestEntry[] {
  const hash = options?.hash !== false
  const entries: VisibleHomeManifestEntry[] = []
  const walk = (absolute: string): void => {
    let names: string[]
    try {
      names = _readdirMigration(absolute)
    } catch {
      return
    }
    for (const name of names.sort()) {
      if (absolute === root && (name === ROX_HOME_MIGRATION_DIR_NAME || name === ROX_HOME_MIGRATION_MANIFEST_NAME)) {
        continue
      }
      const full = join(absolute, name)
      let st: ReturnType<typeof _lstatMigration>
      try {
        st = _lstatMigration(full)
      } catch {
        continue
      }
      const rel = _posixRel(root, full)
      if (st.isSymbolicLink()) {
        let link = ''
        try {
          link = _readlinkMigration(full)
        } catch {
          continue
        }
        entries.push({ path: rel, kind: 'symlink', link })
      } else if (st.isDirectory()) {
        entries.push({ path: rel, kind: 'dir', mode: st.mode & 0o777 })
        walk(full)
      } else if (st.isFile()) {
        entries.push({
          path: rel,
          kind: 'file',
          size: st.size,
          ...(hash ? { sha256: _sha256File(full) } : {}),
          mode: st.mode & 0o777,
          mtimeMs: st.mtimeMs,
        })
      }
    }
  }
  if (existsSync(root)) walk(root)
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return entries
}

export function summarizeVisibleHomeManifest(
  manifest: readonly VisibleHomeManifestEntry[],
): VisibleHomeManifestSummary {
  const summary: VisibleHomeManifestSummary = { files: 0, dirs: 0, symlinks: 0, bytes: 0 }
  for (const entry of manifest) {
    if (entry.kind === 'file') {
      summary.files++
      summary.bytes += entry.size ?? 0
    } else if (entry.kind === 'dir') {
      summary.dirs++
    } else {
      summary.symlinks++
    }
  }
  return summary
}

/**
 * Manifest equality: same set of entries with identical sizes / link
 * targets, and identical checksums wherever both sides carry one.
 */
export function visibleHomeManifestsEqual(
  before: readonly VisibleHomeManifestEntry[],
  after: readonly VisibleHomeManifestEntry[],
): boolean {
  const key = (entry: VisibleHomeManifestEntry): string =>
    `${entry.kind}:${entry.path}:${entry.size ?? ''}:${entry.link ?? ''}`
  if (before.length !== after.length) return false
  return before.every((entry, index) => {
    const other = after[index]
    if (other === undefined || key(entry) !== key(other)) return false
    if (entry.sha256 !== undefined && other.sha256 !== undefined && entry.sha256 !== other.sha256) return false
    return true
  })
}

function _ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  try {
    // `recursive` skips mode on existing dirs — enforce 0700 on the root.
    _chmodMigration(path, 0o700)
  } catch {
    // best effort (e.g. Windows ACLs)
  }
}

type _CopyFileFn = (source: string, destination: string) => void
type _SymlinkFn = (target: string, path: string, type?: 'dir' | 'file' | 'junction') => void
const _defaultSymlink: _SymlinkFn = (target, path, type) => _symlinkMigration(target, path, type)

/**
 * Recreate the link found at `from` (its target text `link`) at `to`.
 * Windows: a link to a directory becomes a junction (no Developer Mode or
 * admin needed; the same as the compat link and Rox's own in-home creators),
 * with an absolute target (junctions cannot be relative; a relative target
 * keeps its meaning at the new place). A file symlink needs the symlink
 * privilege there: when it cannot be created (EPERM) this returns false and
 * the caller keeps it as a conflict instead of failing the whole walk.
 */
function _recreateLink(from: string, link: string, to: string, platform: NodeJS.Platform, symlink: _SymlinkFn): boolean {
  if (platform !== 'win32') {
    symlink(link, to)
    return true
  }
  const absolute = _isAbsoluteMigration(link) ? link : _resolveMigration(_dirnameMigration(to), link)
  let isDir = false
  try {
    isDir = _statMigration(from).isDirectory()
  } catch {
    try {
      isDir = _statMigration(absolute).isDirectory()
    } catch {
      isDir = false
    }
  }
  if (isDir) {
    symlink(absolute, to, 'junction')
    return true
  }
  try {
    symlink(link, to, 'file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'EPERM') return false
    throw error
  }
  return true
}

/**
 * A link that cannot be recreated (see `_recreateLink`) kept as a conflict:
 * a small text file `<target>.rox-symlink` holding the link's target.
 */
function _writeLinkPlaceholder(target: string, link: string): void {
  mkdirSync(_dirnameMigration(target), { recursive: true, mode: 0o700 })
  _writeMigrationFile(`${target}.rox-symlink`, `${link}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
}

const _defaultCopyFile: _CopyFileFn = (source, destination) =>
  _copyMigrationFile(source, destination, _fsConstants.COPYFILE_EXCL)

/** Deterministic sibling temp of a copy target (a retry replaces crash leftovers). */
function _copyTempPath(destination: string): string {
  return join(_dirnameMigration(destination), `.${_basenameMigration(destination)}.rox-copy.tmp`)
}

function _dropCopyTemp(destination: string): void {
  try {
    // unlink never follows a link: a planted link at the temp name is removed, not written through.
    _unlinkMigration(_copyTempPath(destination))
  } catch {
    // absent
  }
}

/**
 * Atomic copy: bytes go to a sibling temp (created fresh, never through a
 * link), mode and times are set there, then one rename puts the complete
 * file in place. A crash mid-copy leaves the previous target (or nothing)
 * plus a temp that the next attempt replaces — never a truncated target
 * with a fresh mtime that would win the merge rule.
 */
function _copyFilePreservingMeta(
  source: string,
  destination: string,
  st: import('node:fs').Stats,
  copyFile: _CopyFileFn = _defaultCopyFile,
): void {
  mkdirSync(_dirnameMigration(destination), { recursive: true })
  const temp = _copyTempPath(destination)
  _dropCopyTemp(destination)
  try {
    copyFile(source, temp)
    try {
      _chmodMigration(temp, st.mode & 0o777)
    } catch {
      // best effort
    }
    try {
      _utimesMigration(temp, st.atime, st.mtime)
    } catch {
      // best effort — mtimes feed the merge rule, never correctness
    }
    _renameMigration(temp, destination)
  } catch (error) {
    _dropCopyTemp(destination)
    throw error
  }
}

/**
 * Whether a link stored at `linkPath` with raw `readlink` value `linkValue`
 * points at `target`. Windows junctions store absolute targets, often with
 * a trailing separator, a `\\?\` prefix, or different casing; both sides are
 * resolved and normalised (trailing separators stripped, case-folded on
 * win32) before comparing.
 */
export function symlinkTargetMatches(
  linkPath: string,
  linkValue: string,
  target: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const mod = platform === 'win32' ? _win32Path : _posixPath
  const normalise = (value: string): string => {
    let out = value
    if (platform === 'win32') out = out.replace(/^\\\\\?\\(UNC\\)?/i, (_m, unc: string | undefined) => (unc ? '\\\\' : ''))
    out = mod.resolve(out)
    const root = mod.parse(out).root
    while (out.length > root.length && (out.endsWith('/') || (platform === 'win32' && out.endsWith('\\')))) {
      out = out.slice(0, -1)
    }
    return platform === 'win32' ? out.toLowerCase() : out
  }
  const resolvedLink = mod.isAbsolute(linkValue) || (platform === 'win32' && /^\\\\\?\\/.test(linkValue))
    ? linkValue
    : mod.join(mod.dirname(linkPath), linkValue)
  return normalise(resolvedLink) === normalise(target)
}

function _isSymlinkTo(path: string, target: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!_lstatMigration(path).isSymbolicLink()) return false
    if (symlinkTargetMatches(path, _readlinkMigration(path), target, platform)) return true
    // Same directory through any link form (real FS): compare real paths.
    try {
      return _realpathMigration(path) === _realpathMigration(target)
    } catch {
      return false
    }
  } catch {
    return false
  }
}

function _writeMigrationReport(
  visibleDir: string,
  timestamp: string,
  result: VisibleHomeMigrationResult,
  summary?: VisibleHomeManifestSummary,
): string | undefined {
  try {
    const dir = join(visibleDir, ROX_HOME_MIGRATION_DIR_NAME)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const reportPath = join(dir, `report-${timestamp}.json`)
    _writeMigrationFile(
      reportPath,
      `${JSON.stringify(
        {
          outcome: result.outcome,
          visibleDir: result.visibleDir,
          hiddenDir: result.hiddenDir,
          migratedAt: new Date().toISOString(),
          files: summary?.files ?? result.manifest.filter((entry) => entry.kind === 'file').length,
          ...(summary ? { summary } : {}),
          conflicts: result.conflicts,
          diagnostics: result.diagnostics,
          announceToast: result.announceToast,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    try {
      _appendMigrationFile(
        join(dir, 'audit.jsonl'),
        `${JSON.stringify({ event: 'storage.root_migrated', outcome: result.outcome, at: new Date().toISOString() })}\n`,
        'utf8',
      )
    } catch {
      // audit is best effort
    }
    return reportPath
  } catch {
    return undefined
  }
}

/**
 * Migration process lock: a fixed file next to the two homes it protects
 * (`$HOME/.rox-migrate.lock`), so every process that migrates this home
 * meets on it whatever its `TMPDIR`. Created only while a migration or revert
 * runs (flag ON or an explicit `migrate-config`) and removed afterwards; a
 * flag-OFF app never creates it.
 */
export const ROX_MIGRATION_LOCK_FILE_NAME = '.rox-migrate.lock'

function _defaultProcessLockPath(options?: MigrateHiddenRoxHomeOptions): string {
  return join(options?.homeDir ?? homedir(), ROX_MIGRATION_LOCK_FILE_NAME)
}

/**
 * O_EXCL|O_NOFOLLOW process lock carrying `{ pid, startedAt, nonce }`. A
 * lock left by a dead PID, a previous boot, older than
 * `ROX_MIGRATION_LOCK_TTL_MS`, owned by another user or a link is stale; a
 * live lock defers. Takeover never removes a lock another process just
 * created: the stale entry is renamed aside and checked (same inode and
 * content as judged) before it is dropped, and after creating our own lock
 * we re-read it and proceed only if it still carries our token.
 */
/** Held migration lock: call to release; `touch()` refreshes its mtime (heartbeat). */
export type ProcessLockHandle = (() => void) & { touch: () => void }

function _acquireProcessLock(options?: MigrateHiddenRoxHomeOptions): ProcessLockHandle | { deferred: string } {
  const lockPath = options?.processLockPath ?? _defaultProcessLockPath(options)
  const now = options?.now?.() ?? Date.now()
  const own: LockOwnershipOptions = { getuid: options?.getuid, lstat: options?.lockLstat }
  const liveness: LockLivenessOptions = {
    now,
    isPidAlive: options?.isPidAlive ?? defaultIsPidAlive,
    ttlMs: ROX_MIGRATION_LOCK_TTL_MS,
    // A lock being written right now has no PID for a moment.
    pidlessTtlMs: 60_000,
    ...own,
  }
  const token = JSON.stringify({ pid: process.pid, startedAt: now, nonce: _randomLockBytes(8).toString('hex') })
  const deferred = { deferred: lockPath }
  const tryCreate = (): boolean => {
    try {
      const fd = _openMigrationLock(
        lockPath,
        _fsConstants.O_WRONLY | _fsConstants.O_CREAT | _fsConstants.O_EXCL | _O_NOFOLLOW,
        0o600,
      )
      try {
        _writeMigrationFd(fd, token)
      } finally {
        _closeMigrationLock(fd)
      }
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') return false
      throw error
    }
  }
  const confirmed = (): ProcessLockHandle | { deferred: string } => {
    options?.lockTakeoverHook?.('created')
    // Someone replaced our fresh lock (a concurrent takeover): back off and
    // leave theirs alone.
    if (!_isOwnLockWithContent(lockPath, token, own)) return deferred
    const releaseLock = (): void => {
      try {
        if (_isOwnLockWithContent(lockPath, token, own)) _unlinkMigration(lockPath)
      } catch {
        // best effort
      }
    }
    // Heartbeat for long merges: the TTL is judged on the newest of
    // startedAt and mtime, so a live migrator is never taken over.
    const touch = (): void => {
      try {
        if (_isOwnLockWithContent(lockPath, token, own)) {
          const at = new Date(options?.now?.() ?? Date.now())
          _utimesMigration(lockPath, at, at)
        }
      } catch {
        // best effort
      }
    }
    return Object.assign(releaseLock, { touch })
  }
  if (tryCreate()) return confirmed()
  if (isLockFileLive(lockPath, liveness)) return deferred
  // Stale: fingerprint what was judged, move it aside, verify, drop it.
  const fingerprint = (path: string): string | undefined => {
    try {
      const st = (own.lstat ?? _lstatMigration)(path)
      let content = ''
      if (st.isFile()) {
        try {
          content = _readLockNoFollow(path)
        } catch {
          content = ''
        }
      }
      return `${st.dev}:${st.ino}:${st.mtimeMs}:${content}`
    } catch {
      return undefined
    }
  }
  const judged = fingerprint(lockPath)
  options?.lockTakeoverHook?.('stale-judged')
  if (judged !== undefined) {
    const aside = `${lockPath}.stale-${process.pid}-${_randomLockBytes(8).toString('hex')}`
    try {
      _renameMigration(lockPath, aside)
    } catch (error) {
      // Already gone (another process took it over): just race for O_EXCL.
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') return deferred
    }
    if (_pathPresent(aside)) {
      if (fingerprint(aside) !== judged) {
        // We moved a lock someone created after our judgement: put it back
        // (link never overwrites) and back off.
        try {
          _linkMigration(aside, lockPath)
        } catch {
          // a third process holds the path now
        }
        try {
          _unlinkMigration(aside)
        } catch {
          // best effort
        }
        return deferred
      }
      try {
        _unlinkMigration(aside)
      } catch {
        // best effort
      }
    }
  }
  return tryCreate() ? confirmed() : deferred
}

/**
 * When both trees exist, whether a tree holds real user data (workspaces).
 * A tree without any is treated as freshly created defaults: it never wins
 * a conflict against a tree that has user data, regardless of mtime.
 */
export function roxHomeHasUserData(root: string): boolean {
  try {
    const entries = _readdirMigration(join(root, 'workspaces'))
    if (entries.some((name) => !name.startsWith('.'))) return true
  } catch {
    // no workspaces dir
  }
  try {
    const parsed: unknown = JSON.parse(_readMigrationFile(join(root, 'config.json'), 'utf8'))
    const workspaces = (parsed as { workspaces?: unknown } | null)?.workspaces
    if (Array.isArray(workspaces) && workspaces.length > 0) return true
  } catch {
    // missing or malformed config
  }
  return false
}

/** Entries that mark a directory as a Rox home. */
export const ROX_HOME_MARKER_NAMES: readonly string[] = [
  'config.json',
  'workspaces',
  ROX_HOME_MIGRATION_DIR_NAME,
  ROX_WORKBENCH_FLAGS_FILE_NAME,
]
/** OS litter that does not make an otherwise empty directory "foreign". */
const _IGNORABLE_DIR_ENTRIES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized'])

/**
 * A `~/rox` that is not a Rox home: not a directory, or a non-empty
 * directory without any Rox marker (config.json, workspaces, .migration,
 * workbench-flags.json) — e.g. a project checkout named `rox`. The visible
 * home is never merged into, chmodded, or used while foreign; the migration
 * defers (same rule as the remote bootstrap's FOREIGN layout).
 */
export function isForeignVisibleHome(dir: string): boolean {
  let st: import('node:fs').Stats
  try {
    st = _statMigration(dir)
  } catch {
    try {
      _lstatMigration(dir)
      return true // dangling symlink or unreadable entry: not usable as a home
    } catch {
      return false // absent
    }
  }
  if (!st.isDirectory()) return true
  let names: string[]
  try {
    names = _readdirMigration(dir).filter((name) => !_IGNORABLE_DIR_ENTRIES.has(name))
  } catch {
    return true
  }
  if (names.length === 0) return false
  return !names.some((name) => ROX_HOME_MARKER_NAMES.includes(name))
}

/** Written under `~/rox/.migration/` before a merge, removed once it completed. */
export const ROX_MERGE_INCOMPLETE_MARKER_NAME = 'merge-incomplete.json'

/**
 * Sidecar of an incomplete merge (`~/rox/.migration/imported.jsonl`): every
 * legacy path the import already handled (copied, identical, stashed) with
 * the legacy entry's size + mtime / link target, and the attempt dirs that
 * hold its stashes. A retry skips handled paths whose legacy entry is
 * unchanged, so files the user edited or deleted in `~/rox` meanwhile are
 * never resurrected or re-stashed. Removed when the merge completes.
 */
export const ROX_MERGE_IMPORTED_SIDECAR_NAME = 'imported.jsonl'

/**
 * Prefix of the dir (under `~/.rox/.migration/`, so `~/rox/.migration/` after
 * the move) holding a data-less `~/rox` moved aside before `~/.rox` is
 * renamed into its place. Settled into `.migration/conflicts/<ts>/` (only the
 * differing files remain) once the move completed.
 */
const _VISIBLE_BEFORE_PREFIX = 'visible-before-'

/** Bookkeeping under `.migration/` that is never imported (merge state of either tree). */
function _isMigrationDirBookkeeping(rel: string): boolean {
  const prefix = `${ROX_HOME_MIGRATION_DIR_NAME}/`
  if (!rel.startsWith(prefix)) return false
  const name = rel.slice(prefix.length)
  return (
    name === ROX_MERGE_INCOMPLETE_MARKER_NAME ||
    name === ROX_MERGE_IMPORTED_SIDECAR_NAME ||
    name.startsWith(_VISIBLE_BEFORE_PREFIX)
  )
}

/**
 * Root entries of the legacy dir a merge never carries into `~/rox`: the
 * migration manifest, the Settings migration state, and lock files
 * (`.app.lock`, `.server.lock`, `*.lock`, their temps). They stay in the
 * archived `~/.rox.migrated-<ts>`.
 */
function _isMergeRootBookkeeping(name: string): boolean {
  if (name === ROX_HOME_MIGRATION_MANIFEST_NAME || name === ROX_STORAGE_MIGRATION_STATE_FILE_NAME) return true
  return name.endsWith('.lock') || /\.lock\.(tmp|stale)-/.test(name)
}

/** Rename codes of a file in use / a briefly protected parent: retried at the next launch. */
const _TRANSIENT_MERGE_RENAME_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY'])
/** Consecutive next-launch retries of a transient failure before the cooldown. */
export const ROX_MERGE_TRANSIENT_RETRIES = 3

/**
 * Whether the boot migration must not run the import again after a failed
 * merge (final rename, a thrown copy error, or a compat-link rollback): a
 * transient code (file in use) is retried at the next launch up to
 * `ROX_MERGE_TRANSIENT_RETRIES` times; after that, and for any other code,
 * only once `ROX_MERGE_RETRY_COOLDOWN_MS` has passed. A different legacy
 * tree (another inode) drops the marker earlier; an explicit
 * `migrate-config` always retries.
 */
function _mergeRetryBlocked(failure: NonNullable<MergeIncompleteMarker['lastFailure']>, now: number): boolean {
  if (now < failure.at || now - failure.at >= ROX_MERGE_RETRY_COOLDOWN_MS) return false
  return !(_TRANSIENT_MERGE_RENAME_CODES.has(failure.code) && failure.attempts < ROX_MERGE_TRANSIENT_RETRIES)
}

export interface MergeIncompleteMarker {
  startedAt: number
  /** Pre-merge snapshot: whether each tree held user data. */
  hiddenHasData: boolean
  visibleHasData: boolean
  /**
   * The dir every process uses until the merge completes. A merge only runs
   * when `~/rox` holds user data, so this build always writes `visible` (the
   * same dir as the pre-merge resolution); `hidden` is only read from markers
   * of earlier builds.
   */
  choice: 'hidden' | 'visible'
  /** `dev:ino` of the hidden tree the snapshot was taken from. */
  hiddenId?: string
  /**
   * Last failed attempt (final rename, thrown import error, compat-link
   * rollback). `~/rox` stays authoritative; see `_mergeRetryBlocked` for when
   * the boot migration imports again.
   */
  lastFailure?: { code: string; at: number; attempts: number }
}

/** `dev:ino` identity of a directory (undefined when the FS reports no inode). */
function _treeId(path: string): string | undefined {
  try {
    const st = _lstatMigration(path, { bigint: true })
    if (st.ino === 0n) return undefined
    return `${st.dev}:${st.ino}`
  } catch {
    return undefined
  }
}

/** A marker still describes this hidden tree (not one recreated after a rename). */
function _markerMatchesHidden(marker: MergeIncompleteMarker, hiddenDir: string): boolean {
  if (!marker.hiddenId) return true // unverifiable (older marker / no inodes): keep it
  return marker.hiddenId === _treeId(hiddenDir)
}

function _writeMergeIncompleteMarker(visibleDir: string, marker: MergeIncompleteMarker): void {
  const markerPath = mergeIncompleteMarkerPath(visibleDir)
  mkdirSync(_dirnameMigration(markerPath), { recursive: true, mode: 0o700 })
  _writeMigrationFile(markerPath, `${JSON.stringify(marker)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function _removeMergeIncompleteMarker(visibleDir: string): void {
  try {
    _unlinkMigration(mergeIncompleteMarkerPath(visibleDir))
  } catch {
    // already gone
  }
}

/** Remove a directory symlink/junction itself (never its target, never recursive). */
function _removeDirLink(path: string): void {
  if (!_lstatMigration(path).isSymbolicLink()) throw new Error(`${path} is not a link`)
  try {
    _unlinkMigration(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    // Windows junctions: rmdir removes the reparse point only.
    if (code !== 'EPERM' && code !== 'EISDIR') throw error
    _rmdirMigration(path)
  }
  if (_pathPresent(path)) throw new Error(`${path} is still present`)
}

function _pathPresent(path: string): boolean {
  try {
    _lstatMigration(path)
    return true
  } catch {
    return false
  }
}

/**
 * Everything kept under `.migration/conflicts/` (all attempts), as posix
 * paths relative to it; empty directories end with `/`. Temps of a stash
 * copy that was killed midway (`.<name>.rox-copy.tmp`) are not conflicts.
 */
function _listConflicts(conflictsRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string): void => {
    let names: string[]
    try {
      const raw = _readdirMigration(dir)
      names = raw.filter((name) => !(name.startsWith('.') && name.endsWith('.rox-copy.tmp')))
      if (names.length === 0 && raw.length > 0) return // only a dead temp
    } catch {
      return
    }
    if (names.length === 0 && rel) out.push(`${rel}/`)
    for (const name of names) {
      const full = join(dir, name)
      const childRel = rel ? `${rel}/${name}` : name
      let st: import('node:fs').Stats
      try {
        st = _lstatMigration(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full, childRel)
      else out.push(childRel)
    }
  }
  walk(conflictsRoot, '')
  return out.sort()
}

export function mergeIncompleteMarkerPath(visibleDir: string): string {
  return join(visibleDir, ROX_HOME_MIGRATION_DIR_NAME, ROX_MERGE_INCOMPLETE_MARKER_NAME)
}

export function readMergeIncompleteMarker(visibleDir: string): MergeIncompleteMarker | undefined {
  try {
    const parsed = JSON.parse(_readMigrationFile(mergeIncompleteMarkerPath(visibleDir), 'utf8')) as Partial<MergeIncompleteMarker>
    return {
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
      hiddenHasData: parsed.hiddenHasData === true,
      visibleHasData: parsed.visibleHasData === true,
      choice: parsed.choice === 'visible' ? 'visible' : 'hidden',
      ...(typeof parsed.hiddenId === 'string' && parsed.hiddenId ? { hiddenId: parsed.hiddenId } : {}),
      ...(parsed.lastFailure &&
      typeof parsed.lastFailure.code === 'string' &&
      typeof parsed.lastFailure.at === 'number' &&
      typeof parsed.lastFailure.attempts === 'number'
        ? {
            lastFailure: {
              code: parsed.lastFailure.code,
              at: parsed.lastFailure.at,
              attempts: parsed.lastFailure.attempts,
            },
          }
        : {}),
    }
  } catch {
    try {
      // Present but unreadable/garbled: still an incomplete merge, which
      // this build only starts into a `~/rox` holding user data.
      _lstatMigration(mergeIncompleteMarkerPath(visibleDir))
      return { startedAt: 0, hiddenHasData: true, visibleHasData: true, choice: 'visible' }
    } catch {
      return undefined
    }
  }
}

function _mergeSidecarPath(visibleDir: string): string {
  return join(visibleDir, ROX_HOME_MIGRATION_DIR_NAME, ROX_MERGE_IMPORTED_SIDECAR_NAME)
}

type _ImportRecord =
  | { k: 'f'; s: number; m: number }
  | { k: 'l'; l: string }
  | { k: 'd' }
  /** A legacy subtree stashed whole (a `~/rox` file or link at its path). */
  | { k: 't' }

interface _ImportSidecar {
  handled: Map<string, _ImportRecord>
  /** Attempt dirs under `.migration/conflicts/` that hold this merge's stashes. */
  attempts: string[]
}

/** Best effort: missing file → empty; torn or foreign lines are skipped. */
function _readImportSidecar(visibleDir: string): _ImportSidecar {
  const handled = new Map<string, _ImportRecord>()
  const attempts: string[] = []
  let raw = ''
  try {
    raw = _readMigrationFile(_mergeSidecarPath(visibleDir), 'utf8')
  } catch {
    return { handled, attempts }
  }
  for (const line of raw.split('\n')) {
    if (!line) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const entry = parsed as { p?: unknown; k?: unknown; s?: unknown; m?: unknown; l?: unknown; a?: unknown }
    if (typeof entry.a === 'string' && entry.a && !entry.a.includes('/') && !entry.a.includes('..')) {
      if (!attempts.includes(entry.a)) attempts.push(entry.a)
      continue
    }
    if (typeof entry.p !== 'string' || !entry.p) continue
    if (entry.k === 'f' && typeof entry.s === 'number' && typeof entry.m === 'number') {
      handled.set(entry.p, { k: 'f', s: entry.s, m: entry.m })
    } else if (entry.k === 'l' && typeof entry.l === 'string') {
      handled.set(entry.p, { k: 'l', l: entry.l })
    } else if (entry.k === 'd' || entry.k === 't') {
      handled.set(entry.p, { k: entry.k })
    }
  }
  return { handled, attempts }
}

function _removeImportSidecar(visibleDir: string): void {
  try {
    _unlinkMigration(_mergeSidecarPath(visibleDir))
  } catch {
    // absent
  }
}

/**
 * Whether `~/rox` holds the marker of a merge that has not completed while
 * the legacy dir is still a real directory (Settings keeps its deferral note).
 */
export function hasIncompleteVisibleHomeMerge(homeDir: string = homedir()): boolean {
  const paths = defaultVisibleHomePaths(homeDir)
  try {
    if (!_lstatMigration(paths.hiddenDir).isDirectory()) return false
  } catch {
    return false
  }
  const marker = readMergeIncompleteMarker(paths.visibleDir)
  return marker !== undefined && _markerMatchesHidden(marker, paths.hiddenDir)
}

/** `~/.rox.migrated-<ts>` exists: a merge renamed the legacy dir away. */
function _hasMigratedLegacySibling(homeDir: string): boolean {
  try {
    return _readdirMigration(homeDir).some((name) => name.startsWith(`${ROX_HIDDEN_HOME_LINK_NAME}.migrated-`))
  } catch {
    return false
  }
}

/** Keep `storage.visible-root.v1` ON in this flags file (other ids untouched). */
function _ensureVisibleRootFlagIn(file: string): void {
  if (_readEnabledFlags(file)?.includes(ROX_STORAGE_VISIBLE_ROOT_FLAG_ID) === true) return
  _writeVisibleRootFlagFile(file, true)
}

/**
 * Copy every entry of `source` that `destination` lacks (files atomically
 * with mode + times, links as links, dirs recursively). Existing entries are
 * never touched; nothing is written through a link on either side; root
 * bookkeeping (locks, Settings state, manifest) and merge bookkeeping under
 * `.migration/` are skipped. Used before a data-less `~/rox` is moved aside.
 */
function _importMissingEntries(
  source: string,
  destination: string,
  copyFile: _CopyFileFn,
  platform: NodeJS.Platform = process.platform,
  symlink: _SymlinkFn = _defaultSymlink,
): void {
  const walk = (rel: string): void => {
    for (const name of _readdirMigration(rel ? join(source, rel) : source)) {
      const childRel = rel ? `${rel}/${name}` : name
      if (!rel && _isMergeRootBookkeeping(name)) continue
      if (_isMigrationDirBookkeeping(childRel)) continue
      const from = join(source, childRel)
      const to = join(destination, childRel)
      const st = _lstatMigration(from)
      let existing: import('node:fs').Stats | undefined
      try {
        existing = _lstatMigration(to)
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
        existing = undefined
      }
      if (st.isSymbolicLink()) {
        if (!existing) {
          mkdirSync(_dirnameMigration(to), { recursive: true })
          // A file symlink Windows will not create stays in the moved-aside
          // `~/rox` (absent from the home, so it is kept as a conflict).
          _recreateLink(from, _readlinkMigration(from), to, platform, symlink)
        }
      } else if (st.isDirectory()) {
        if (existing && !existing.isDirectory()) continue
        if (!existing) mkdirSync(to, { recursive: true, mode: 0o700 })
        walk(childRel)
        if (!existing) {
          try {
            _chmodMigration(to, st.mode & 0o777)
          } catch {
            // best effort
          }
        }
      } else if (st.isFile() && !existing) {
        _copyFilePreservingMeta(from, to, st, copyFile)
      }
    }
  }
  walk('')
}

/**
 * Drop from a moved-aside `~/rox` everything the home now has identically
 * (bytes compared; never through links) and stale bookkeeping. What remains
 * differs from the home or is absent there (never moved back in: the home
 * may have deleted it since, and nothing is resurrected).
 */
function _pruneAside(dir: string, visibleDir: string, rel: string): void {
  for (const name of _readdirMigration(dir)) {
    const childRel = rel ? `${rel}/${name}` : name
    const full = join(dir, name)
    const st = _lstatMigration(full)
    if ((!rel && _isMergeRootBookkeeping(name)) || _isMigrationDirBookkeeping(childRel)) {
      if (!st.isDirectory()) _unlinkMigration(full)
      continue
    }
    const target = join(visibleDir, childRel)
    let targetStat: import('node:fs').Stats | undefined
    try {
      targetStat = _lstatMigration(target)
    } catch {
      targetStat = undefined
    }
    if (!targetStat) continue
    if (st.isDirectory()) {
      if (!targetStat.isDirectory()) continue
      _pruneAside(full, visibleDir, childRel)
      try {
        _rmdirMigration(full)
      } catch {
        // differing entries remain
      }
      continue
    }
    if (st.isSymbolicLink()) {
      if (targetStat.isSymbolicLink() && _sameLinkAtHome(full, target)) _unlinkMigration(full)
      continue
    }
    if (st.isFile() && targetStat.isFile() && _filesIdentical(full, st, target, targetStat, { trustMeta: false })) {
      _unlinkMigration(full)
      continue
    }
    if (!rel && st.isFile() && targetStat.isFile() && _asideRootFileSubsumed(name, full, target)) _unlinkMigration(full)
  }
}

/**
 * The moved-aside link `aside` means what the home's link `home` does: the
 * same target text, or (a Windows junction recreated with an absolute
 * target) the aside's target taken at the home's place resolves to the same
 * real path. Resolution only; nothing is read or written through the links.
 */
function _sameLinkAtHome(aside: string, home: string): boolean {
  const asideLink = _readlinkMigration(aside)
  const homeLink = _readlinkMigration(home)
  if (asideLink === homeLink) return true
  const asideAtHome = _isAbsoluteMigration(asideLink) ? asideLink : _resolveMigration(_dirnameMigration(home), asideLink)
  const a = _realpathOrUndefined(asideAtHome)
  return a !== undefined && a === _realpathOrUndefined(home)
}

function _readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(_readMigrationFile(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function _jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && _jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * Root files of a data-less `~/rox` that carry nothing the home lacks, so a
 * moved-aside copy is no conflict (review 8): the `workbench-flags.json`
 * whose enabled flags the home already has (its flag was merged into the
 * home's file), and a `config.json` without workspaces whose other keys are
 * the home's (or empty: `null`). Anything else stays a conflict.
 */
function _asideRootFileSubsumed(name: string, aside: string, home: string): boolean {
  const asideJson = _readJsonObject(aside)
  const homeJson = _readJsonObject(home)
  if (!asideJson || !homeJson) return false
  const othersMatch = (skip: string): boolean =>
    Object.keys(asideJson).every((k) => k === skip || asideJson[k] === null || _jsonEqual(asideJson[k], homeJson[k]))
  if (name === ROX_WORKBENCH_FLAGS_FILE_NAME) {
    const asideEnabled = asideJson.enabled
    const homeEnabled = homeJson.enabled
    if (asideEnabled !== undefined && !Array.isArray(asideEnabled)) return false
    if (!Array.isArray(homeEnabled) && asideEnabled !== undefined && asideEnabled.length > 0) return false
    const homeSet = new Set(Array.isArray(homeEnabled) ? homeEnabled : [])
    return (asideEnabled ?? []).every((flag) => homeSet.has(flag)) && othersMatch('enabled')
  }
  if (name === 'config.json') {
    const workspaces = asideJson.workspaces
    if (workspaces !== undefined && !(Array.isArray(workspaces) && workspaces.length === 0)) return false
    return othersMatch('workspaces')
  }
  return false
}

/**
 * Settle every `~/rox/.migration/visible-before-<ts>` (a data-less `~/rox`
 * moved aside before `~/.rox` took its place): prune it, then keep what
 * differs under `.migration/conflicts/<ts>/`. Returns those conflict paths.
 * A link at the aside root is kept as is (never followed).
 */
function _settleVisibleBefore(visibleDir: string): string[] {
  const migrationDir = join(visibleDir, ROX_HOME_MIGRATION_DIR_NAME)
  let names: string[]
  try {
    names = _readdirMigration(migrationDir)
  } catch {
    return []
  }
  const conflicts: string[] = []
  for (const name of names) {
    if (!name.startsWith(_VISIBLE_BEFORE_PREFIX)) continue
    const aside = join(migrationDir, name)
    let st: import('node:fs').Stats
    try {
      st = _lstatMigration(aside)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      _pruneAside(aside, visibleDir, '')
      try {
        _rmdirMigration(aside)
        continue
      } catch {
        // differing entries remain
      }
    }
    const conflictsRoot = join(migrationDir, 'conflicts')
    mkdirSync(conflictsRoot, { recursive: true, mode: 0o700 })
    const stem = name.slice(_VISIBLE_BEFORE_PREFIX.length) || 'visible'
    let attempt = stem
    for (let n = 1; _pathPresent(join(conflictsRoot, attempt)); n++) attempt = `${stem}.${n}`
    _renameMigration(aside, join(conflictsRoot, attempt))
    if (st.isDirectory()) {
      conflicts.push(..._listConflicts(join(conflictsRoot, attempt)).map((rel) => `${attempt}/${rel}`))
    } else {
      conflicts.push(attempt)
    }
  }
  return conflicts
}

type VisibleHomeState =
  | 'symlinked'
  | 'symlink-elsewhere'
  | 'visible-links-hidden'
  | 'foreign'
  | 'clean'
  | 'visible-only'
  | 'hidden-only'
  | 'both'

function _realpathOrUndefined(path: string): string | undefined {
  try {
    return (_realpathMigration.native ?? _realpathMigration)(path)
  } catch {
    return undefined
  }
}

function _visibleRelationToHidden(
  paths: VisibleHomePaths,
  platform: NodeJS.Platform,
): 'inside-hidden' | 'contains-hidden' | undefined {
  const visible = _realpathOrUndefined(paths.visibleDir)
  const hidden = _realpathOrUndefined(paths.hiddenDir)
  if (!visible || !hidden) return undefined
  const fold = (p: string): string => {
    const trimmed = p.length > 1 ? p.replace(/[\\/]+$/, '') : p
    return platform === 'win32' || platform === 'darwin' ? trimmed.toLowerCase() : trimmed
  }
  const v = fold(visible)
  const h = fold(hidden)
  const sep = platform === 'win32' ? '\\' : _pathSep
  if (v === h || v.startsWith(h + sep)) return 'inside-hidden'
  if (h.startsWith(v + sep)) return 'contains-hidden'
  return undefined
}

function _classifyVisibleHome(paths: VisibleHomePaths, platform: NodeJS.Platform): VisibleHomeState {
  let hiddenStat: import('node:fs').Stats | undefined
  try {
    hiddenStat = _lstatMigration(paths.hiddenDir)
  } catch {
    hiddenStat = undefined
  }
  if (hiddenStat?.isSymbolicLink() === true) {
    return _isSymlinkTo(paths.hiddenDir, paths.visibleDir, platform) ? 'symlinked' : 'symlink-elsewhere'
  }
  if (hiddenStat?.isDirectory() === true) {
    // `~/rox` resolving into the hidden tree (e.g. `ln -s ~/.rox ~/rox`) is
    // the same data, never a second home to merge; a `~/rox` that contains
    // it (e.g. a link to $HOME) is not ours.
    const relation = _visibleRelationToHidden(paths, platform)
    if (relation === 'inside-hidden') return 'visible-links-hidden'
    if (relation === 'contains-hidden') return 'foreign'
  }
  if (isForeignVisibleHome(paths.visibleDir)) return 'foreign'
  const visibleExists = existsSync(paths.visibleDir)
  if (!hiddenStat) return visibleExists ? 'visible-only' : 'clean'
  return visibleExists ? 'both' : 'hidden-only'
}

/**
 * Read-only flag-ON resolution for every process that must not migrate
 * (CLI, headless server, scripts, a second app instance, and the desktop app
 * before its single-instance lock). Never writes. `~/rox` when it already is
 * the home (symlinked / visible-only / a fresh machine) or, with both trees
 * present, when it holds user data — the same tree the migrator keeps
 * authoritative before, during and after a merge (its marker says
 * `visible`). A legacy home awaiting migration, a foreign `~/rox`, or a
 * data-less `~/rox` keep `~/.rox`.
 */
export function resolveVisibleHomeWithoutMigration(
  homeDir: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const paths = defaultVisibleHomePaths(homeDir)
  switch (_classifyVisibleHome(paths, platform)) {
    case 'symlinked':
    case 'clean':
    case 'visible-only':
      return paths.visibleDir
    case 'foreign':
    case 'hidden-only':
    case 'visible-links-hidden':
      return paths.hiddenDir
    case 'symlink-elsewhere':
      return existsSync(paths.visibleDir) && roxHomeHasUserData(paths.visibleDir) ? paths.visibleDir : paths.hiddenDir
    case 'both': {
      const marker = readMergeIncompleteMarker(paths.visibleDir)
      if (marker && _markerMatchesHidden(marker, paths.hiddenDir)) {
        return marker.choice === 'visible' ? paths.visibleDir : paths.hiddenDir
      }
      return roxHomeHasUserData(paths.visibleDir) ? paths.visibleDir : paths.hiddenDir
    }
  }
}

/**
 * Move `~/.rox` → `~/rox` (MIG-13). Never deletes user data; leaves `~/.rox`
 * as a symlink (Windows: directory junction) to `~/rox`. Throws on I/O
 * failures mid-move (the caller keeps the legacy dir in that case).
 *
 * Only two callers may run it: Electron main right after its single-instance
 * lock (`runVisibleHomeAutoMigration`) and an explicit `migrate-config`.
 * Every other process resolves read-only (`resolveVisibleHomeWithoutMigration`).
 */
export function migrateHiddenRoxHome(options?: MigrateHiddenRoxHomeOptions): VisibleHomeMigrationResult {
  const env = options?.env ?? process.env
  const paths = defaultVisibleHomePaths(options?.homeDir)
  const dryRun = options?.dryRun === true
  const platform = options?.platform ?? process.platform
  const timestamp = _migrationTimestamp(options)
  const rename = options?.rename ?? _renameMigration
  const copyFile = options?.copyFile ?? _defaultCopyFile
  const symlink = options?.symlink ?? _defaultSymlink
  const linkDir =
    options?.linkDir ??
    ((target: string, path: string, type: 'dir' | 'junction') => {
      _symlinkMigration(target, path, platform === 'win32' ? 'junction' : type)
    })
  const linkType = platform === 'win32' ? 'junction' : 'dir'
  const base: Omit<VisibleHomeMigrationResult, 'outcome' | 'diagnostics'> & {
    diagnostics: string[]
  } = {
    visibleDir: paths.visibleDir,
    hiddenDir: paths.hiddenDir,
    dryRun,
    manifest: [],
    conflicts: [],
    diagnostics: [],
    announceToast: false,
  }
  const done = (
    outcome: VisibleHomeOutcome,
    extra?: Partial<VisibleHomeMigrationResult>,
  ): VisibleHomeMigrationResult => ({ ...base, outcome, ...(extra ?? {}) })

  if (env.ROX_CONFIG_DIR?.trim() || env.CRAFT_CONFIG_DIR?.trim()) {
    return done('skipped-env-override', {
      diagnostics: ['storage.migration.skippedEnvOverride'],
    })
  }

  // Crash recovery once `~/rox` already is the home (never in a dry run, best
  // effort): a data-less `~/rox` moved aside into the legacy tree is settled,
  // and a compat link missing after a completed move (crash between the
  // final rename and the link) is created again.
  const settleAside = (): string[] => {
    if (dryRun) return []
    try {
      return _settleVisibleBefore(paths.visibleDir)
    } catch {
      return [] // retried at the next run
    }
  }
  const restoreCompatLink = (): string[] => {
    if (dryRun) return []
    const evidence =
      _pathPresent(mergeIncompleteMarkerPath(paths.visibleDir)) ||
      _pathPresent(join(paths.visibleDir, ROX_HOME_MIGRATION_MANIFEST_NAME)) ||
      _hasMigratedLegacySibling(paths.homeDir)
    if (!evidence) return []
    try {
      linkDir(paths.visibleDir, paths.hiddenDir, linkType)
    } catch {
      return ['storage.migration.compatLinkMissing']
    }
    _removeMergeIncompleteMarker(paths.visibleDir)
    _removeImportSidecar(paths.visibleDir)
    try {
      _unlinkMigration(join(paths.visibleDir, ROX_HOME_MIGRATION_MANIFEST_NAME))
    } catch {
      // absent
    }
    return ['storage.migration.compatLinkRestored']
  }

  // States that need no move. Re-evaluated after the process lock: another
  // process may have migrated meanwhile.
  const settled = (state: VisibleHomeState): VisibleHomeMigrationResult | undefined => {
    switch (state) {
      case 'symlinked': {
        if (!dryRun && existsSync(paths.visibleDir)) _ensurePrivateDir(paths.visibleDir)
        const conflicts = settleAside()
        return done('already-symlinked', conflicts.length > 0 ? { conflicts } : undefined)
      }
      case 'symlink-elsewhere':
        // Same choice as the read-only resolution, so Settings can say which dir Rox uses.
        return done('symlink-elsewhere', {
          diagnostics: [
            'storage.migration.symlinkElsewhere',
            existsSync(paths.visibleDir) && roxHomeHasUserData(paths.visibleDir) ? 'uses:visible' : 'uses:hidden',
          ],
        })
      case 'foreign':
        return done('deferred-foreign', { diagnostics: ['storage.migration.deferredForeign'] })
      case 'clean':
        if (!dryRun) _ensurePrivateDir(paths.visibleDir)
        return done('clean-install')
      case 'visible-only': {
        if (!dryRun) _ensurePrivateDir(paths.visibleDir)
        const diagnostics = restoreCompatLink()
        const conflicts = settleAside()
        return done('already-visible', { diagnostics, conflicts })
      }
      default:
        return undefined
    }
  }
  // Non-destructive pre-checks that the legacy dir can be renamed at the end
  // (to `~/.rox.migrated-<ts>` after an import, or into `~/rox`), run before
  // anything is copied: it is not a mount point (same device as its parent;
  // on Windows not a reparse point or a volume root) and the parent is
  // writable. `checkVisibleDevice`: the `~/rox` entry itself is renamed (moved
  // aside into the legacy tree), so it must be on that device too. Nothing is
  // renamed here: the running app never loses its dir.
  const mergePrecheckBlocker = (checkVisibleDevice: boolean): string | undefined => {
    try {
      if (_lstatMigration(paths.hiddenDir).isSymbolicLink()) return 'reparse-point'
      const hiddenDev = _statMigration(paths.hiddenDir).dev
      if (hiddenDev !== _statMigration(paths.homeDir).dev) return 'mount-point'
      if (platform === 'win32') {
        const real = _realpathOrUndefined(paths.hiddenDir)
        if (real) {
          const trimmed = real.replace(/[\\/]+$/, '')
          const root = _win32Path.parse(real).root.replace(/[\\/]+$/, '')
          if (/^\\\\\?\\Volume\{/i.test(real) || trimmed.toLowerCase() === root.toLowerCase()) return 'volume-root'
        }
      }
      if (checkVisibleDevice && _lstatMigration(paths.visibleDir).dev !== hiddenDev) return 'cross-device'
    } catch (error) {
      return (error as NodeJS.ErrnoException | null)?.code ?? 'stat-failed'
    }
    try {
      _accessMigration(paths.homeDir, _fsConstants.W_OK)
    } catch {
      return 'parent-not-writable'
    }
    return undefined
  }
  const deferredUnmovable = (
    blocker: string,
    code = 'storage.migration.legacyNotRenamable',
    extra: string[] = [],
  ): VisibleHomeMigrationResult => done('deferred-unmovable', { diagnostics: [code, `rename:${blocker}`, ...extra] })
  const lockHolders = (bothExist: boolean): string[] =>
    options?.isLocked
      ? options.isLocked(paths.hiddenDir)
      : [
          ..._liveHomeLockHolders(paths.hiddenDir, options),
          ...(bothExist ? _liveHomeLockHolders(paths.visibleDir, options).map((h) => `rox/${h}`) : []),
        ]
  const deferredByHolders = (holders: string[]): VisibleHomeMigrationResult =>
    done('deferred-locked', {
      diagnostics: ['storage.migration.deferredLocked', ...holders.map((h) => `locked:${h}`)],
    })

  // A repair (pending aside, missing compat link) only runs under the
  // process lock, never racing a `--revert` that holds it.
  const needsRepair = (state: VisibleHomeState): boolean => {
    if (state !== 'symlinked' && state !== 'visible-only') return false
    try {
      if (_readdirMigration(join(paths.visibleDir, ROX_HOME_MIGRATION_DIR_NAME)).some((n) => n.startsWith(_VISIBLE_BEFORE_PREFIX))) return true
    } catch {
      // no .migration dir
    }
    return (
      state === 'visible-only' &&
      (_pathPresent(mergeIncompleteMarkerPath(paths.visibleDir)) ||
        _pathPresent(join(paths.visibleDir, ROX_HOME_MIGRATION_MANIFEST_NAME)) ||
        _hasMigratedLegacySibling(paths.homeDir))
    )
  }

  let state = _classifyVisibleHome(paths, platform)
  const early = dryRun || !needsRepair(state) ? settled(state) : undefined
  if (early) return early

  // Only `~/.rox` (real dir), or both real dirs: check live writers first.
  // (`visible-links-hidden` is a single tree reached twice.)
  let holders = lockHolders(state === 'both')
  if (holders.length > 0) return deferredByHolders(holders)

  // size / mode / mtime only — no content hashing on the atomic path.
  let manifest = buildVisibleHomeManifest(paths.hiddenDir, { hash: false })
  base.manifest = manifest

  if (dryRun) {
    return state === 'both' ? done('merged', { announceToast: true }) : done('migrated', { announceToast: true })
  }

  const release: ProcessLockHandle | { deferred: string } =
    options?.skipProcessLock === true ? Object.assign(() => {}, { touch: () => {} }) : _acquireProcessLock(options)
  if (typeof release !== 'function') {
    return done('deferred-locked', {
      diagnostics: ['storage.migration.deferredLocked', `locked:${release.deferred}`],
    })
  }
  try {
    // Fresh state under the lock (another process may have finished first).
    state = _classifyVisibleHome(paths, platform)
    const settledNow = settled(state)
    if (settledNow) return settledNow
    holders = lockHolders(state === 'both')
    if (holders.length > 0) return deferredByHolders(holders)
    if (state === 'visible-links-hidden') {
      // Remove only the `~/rox` link (never its target), then the plain
      // hidden-only move. If the link cannot be removed: defer, untouched.
      const deferredLink = (): VisibleHomeMigrationResult =>
        done('deferred-link', { diagnostics: ['storage.migration.visibleLinkIntoHidden'] })
      try {
        _removeDirLink(paths.visibleDir)
      } catch {
        return deferredLink()
      }
      state = _classifyVisibleHome(paths, platform)
      if (state !== 'hidden-only') return settled(state) ?? deferredLink()
    }
    manifest = buildVisibleHomeManifest(paths.hiddenDir, { hash: false })
    base.manifest = manifest
    const summary = summarizeVisibleHomeManifest(manifest)

    /**
     * `~/rox` is absent: one atomic rename of `~/.rox` into its place plus
     * the compat link. Nothing is copied, so a deferral never leaves a partial
     * tree anywhere. A data-less `~/rox` moved aside into the legacy tree
     * (below) is settled afterwards.
     */
    const moveHiddenIntoVisible = (outcome: 'migrated' | 'merged'): VisibleHomeMigrationResult => {
      // Crash evidence while the move is in flight; removed once verified.
      const manifestPath = join(paths.hiddenDir, ROX_HOME_MIGRATION_MANIFEST_NAME)
      try {
        _writeMigrationFile(manifestPath, `${JSON.stringify(manifest)}\n`, { encoding: 'utf8', mode: 0o600 })
      } catch {
        // best effort; equality is still verified after the move
      }
      const dropScaffolding = (): void => {
        try {
          _unlinkMigration(manifestPath)
        } catch {
          // never written / already gone
        }
      }
      let originalMode: number | undefined
      try {
        originalMode = _statMigration(paths.hiddenDir).mode & 0o777
      } catch {
        originalMode = undefined
      }
      try {
        rename(paths.hiddenDir, paths.visibleDir)
      } catch (error) {
        dropScaffolding()
        const code = (error as NodeJS.ErrnoException | null)?.code
        // EXDEV: cannot leave its volume. EPERM/EACCES/EBUSY: a file in use
        // (Windows) or a protected parent. Nothing moved: defer.
        if (code === 'EXDEV' || code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') return deferredUnmovable(code)
        throw error
      }
      _ensurePrivateDir(paths.visibleDir)
      try {
        linkDir(paths.visibleDir, paths.hiddenDir, linkType)
      } catch (error) {
        // No compat link. If the legacy path is still free, undo the move so
        // every process keeps a valid config dir; otherwise the data stays in
        // ~/rox and the caller must restart onto it.
        if (!_pathPresent(paths.hiddenDir)) {
          try {
            rename(paths.visibleDir, paths.hiddenDir)
            if (originalMode !== undefined) {
              try {
                _chmodMigration(paths.hiddenDir, originalMode)
              } catch {
                // best effort
              }
            }
            dropScaffolding()
            throw error
          } catch (rollbackError) {
            if (rollbackError === error) throw error
          }
        }
        const conflicts = settleAside()
        const result = done(outcome, {
          manifest: buildVisibleHomeManifest(paths.visibleDir, { hash: false }),
          conflicts,
          diagnostics: [...(conflicts.length > 0 ? ['storage.migration.conflictsKept'] : []), 'storage.migration.compatLinkMissing'],
          announceToast: true,
          relaunchRequired: true,
        })
        result.reportPath = _writeMigrationReport(paths.visibleDir, timestamp, result, summary)
        return result
      }
      const after = buildVisibleHomeManifest(paths.visibleDir, { hash: false })
      const equal = visibleHomeManifestsEqual(manifest, after)
      if (equal) {
        try {
          _unlinkMigration(join(paths.visibleDir, ROX_HOME_MIGRATION_MANIFEST_NAME))
        } catch {
          // already gone
        }
      }
      const conflicts = settleAside()
      const diagnostics = equal ? [] : ['storage.migration.checksumMismatch']
      if (conflicts.length > 0) diagnostics.push('storage.migration.conflictsKept')
      const result = done(outcome, { manifest: after, conflicts, diagnostics, announceToast: true })
      result.reportPath = _writeMigrationReport(paths.visibleDir, timestamp, result, summary)
      return result
    }

    if (state === 'hidden-only') return moveHiddenIntoVisible('migrated')

    // Both real dirs. The authoritative tree is the one the read-only
    // resolution already uses (`resolveVisibleHomeWithoutMigration`): `~/rox`
    // when it holds user data, else `~/.rox`. It stays authoritative before,
    // during and after a failed attempt, so no process ever switches trees.
    // - `~/rox` authoritative: the leftovers of `~/.rox` are imported into it
    //   (missing files copied, identical skipped, differing legacy versions
    //   stashed under `.migration/conflicts/<ts>/`), then `~/.rox` is renamed
    //   to `~/.rox.migrated-<ts>` (inside $HOME: `~/rox` may be on any volume).
    // - `~/.rox` authoritative (data-less `~/rox`): `~/rox` is moved aside into
    //   the legacy tree and `~/.rox` takes its place with one rename; nothing
    //   is ever copied into `~/rox` while `~/.rox` is the live tree.
    let previous = readMergeIncompleteMarker(paths.visibleDir)
    // A marker of a different hidden tree (the original was renamed away and
    // something recreated `~/.rox`) is stale.
    const stalePrevious = previous !== undefined && !_markerMatchesHidden(previous, paths.hiddenDir)
    if (stalePrevious) previous = undefined
    // A marker of an earlier build that kept `~/.rox` authoritative while it
    // copied into `~/rox`: `~/rox` holds a stale partial copy, so it is moved
    // aside whole (identical files dropped, the rest kept as conflicts) and
    // nothing of it is imported into the live `~/.rox`.
    const hiddenChoiceMarker = previous !== undefined && previous.choice !== 'visible'
    if (hiddenChoiceMarker) previous = undefined
    const visibleAuthoritative = !hiddenChoiceMarker && (previous !== undefined || roxHomeHasUserData(paths.visibleDir))
    const blocker = mergePrecheckBlocker(!visibleAuthoritative)
    // `uses:visible`: Rox keeps running on `~/rox` (Settings says so; only
    // the leftovers stay in `~/.rox`).
    if (blocker) return deferredUnmovable(blocker, undefined, visibleAuthoritative ? ['uses:visible'] : [])
    if (stalePrevious || hiddenChoiceMarker) {
      _removeMergeIncompleteMarker(paths.visibleDir)
      _removeImportSidecar(paths.visibleDir)
    }

    if (!visibleAuthoritative) {
      // 1. Legacy-missing entries of the data-less `~/rox` are copied into
      //    `~/.rox` first (e.g. the workbench flags that switched the
      //    visible home on), so every crash point leaves a consistent home.
      const flagWasOn = readPersistedVisibleRootFlag(paths.homeDir)
      if (!hiddenChoiceMarker) _importMissingEntries(paths.visibleDir, paths.hiddenDir, copyFile, platform, symlink)
      if (flagWasOn) _ensureVisibleRootFlagIn(join(paths.hiddenDir, ROX_WORKBENCH_FLAGS_FILE_NAME))
      holders = lockHolders(true)
      if (holders.length > 0) return deferredByHolders(holders)
      // 2. `~/rox` moves aside into the legacy tree (one rename).
      const asideParent = join(paths.hiddenDir, ROX_HOME_MIGRATION_DIR_NAME)
      _ensurePrivateDir(asideParent)
      try {
        rename(paths.visibleDir, join(asideParent, `${_VISIBLE_BEFORE_PREFIX}${timestamp}`))
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | null)?.code
        if (code === 'EXDEV' || code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EEXIST') {
          return deferredUnmovable(code, 'storage.migration.visibleNotRenamable')
        }
        throw error
      }
      // 3. Hidden-only from here: rename + link, then the aside is settled
      //    (identical files dropped, the rest kept under conflicts).
      manifest = buildVisibleHomeManifest(paths.hiddenDir, { hash: false })
      base.manifest = manifest
      return moveHiddenIntoVisible('merged')
    }

    _ensurePrivateDir(paths.visibleDir)
    const hiddenId = _treeId(paths.hiddenDir)
    const nowMs = options?.now?.() ?? Date.now()
    // An earlier attempt failed: the boot migration does not import again
    // until the retry rule allows it (no walk per launch). The legacy dir's
    // mtime is not a trigger: lock and config writes change it all the time.
    const lastFailure = previous?.lastFailure
    if (lastFailure && options?.retryFailedMerge !== true && _mergeRetryBlocked(lastFailure, nowMs)) {
      return done('deferred-retry', {
        diagnostics: [
          'storage.migration.mergeRetryLater',
          `failed:${lastFailure.code}`,
          `retryAfter:${new Date(lastFailure.at + ROX_MERGE_RETRY_COOLDOWN_MS).toISOString()}`,
          `attempts:${lastFailure.attempts}`,
        ],
      })
    }
    const marker: MergeIncompleteMarker = previous ?? {
      startedAt: nowMs,
      hiddenHasData: roxHomeHasUserData(paths.hiddenDir),
      visibleHasData: true,
      choice: 'visible',
      ...(hiddenId ? { hiddenId } : {}),
    }
    if (!previous) {
      // A fresh merge: no handled paths yet. Strict marker write.
      _removeImportSidecar(paths.visibleDir)
      _writeMergeIncompleteMarker(paths.visibleDir, marker)
    }
    const sidecar: _ImportSidecar = previous ? _readImportSidecar(paths.visibleDir) : { handled: new Map(), attempts: [] }
    let pendingLines: string[] = []
    const flushSidecar = (): void => {
      if (pendingLines.length === 0) return
      const lines = pendingLines.join('')
      pendingLines = []
      _appendMigrationFile(_mergeSidecarPath(paths.visibleDir), lines, { encoding: 'utf8', mode: 0o600 })
    }
    const record = (rel: string, entry: _ImportRecord): void => {
      sidecar.handled.set(rel, entry)
      pendingLines.push(`${JSON.stringify({ p: rel, ...entry })}\n`)
    }
    const noteAttempt = (): void => {
      if (sidecar.attempts.includes(timestamp)) return
      sidecar.attempts.push(timestamp)
      pendingLines.push(`${JSON.stringify({ a: timestamp })}\n`)
    }
    const recordFailure = (error: unknown): { code: string; attempts: number } => {
      const code = (error as NodeJS.ErrnoException | null)?.code ?? 'error'
      const attempts = lastFailure?.code === code ? lastFailure.attempts + 1 : 1
      try {
        _writeMergeIncompleteMarker(paths.visibleDir, { ...marker, lastFailure: { code, at: nowMs, attempts } })
      } catch {
        // the marker without lastFailure still keeps ~/rox authoritative
      }
      return { code, attempts }
    }
    const conflictsRoot = join(paths.visibleDir, ROX_HOME_MIGRATION_DIR_NAME, 'conflicts')
    /** This merge's stashes (every attempt of it), never older merges' ones. */
    const mergeConflicts = (): string[] =>
      sidecar.attempts.flatMap((ts) => _listConflicts(join(conflictsRoot, ts)).map((rel) => `${ts}/${rel}`))
    const heartbeatEvery = Math.max(1, options?.lockHeartbeatEvery ?? _LOCK_HEARTBEAT_EVERY)
    let mergedEntries = 0
    // Per attempt: a retry never overwrites an earlier stash (it may be the
    // only copy left of a legacy version). Same-attempt collisions get a suffix.
    const attemptRoot = join(conflictsRoot, timestamp)
    const freeTarget = (rel: string): string => {
      const base = join(attemptRoot, rel)
      if (!_pathPresent(base)) return base
      for (let n = 1; ; n++) {
        const candidate = `${base}.${n}`
        if (!_pathPresent(candidate)) return candidate
      }
    }
    /** The same legacy bytes (size + mtime) are already kept by an earlier attempt of this merge. */
    const alreadyStashed = (rel: string, st: import('node:fs').Stats): boolean => {
      for (const ts of sidecar.attempts) {
        const base = join(conflictsRoot, ts, rel)
        for (let n = 0; ; n++) {
          let kept: import('node:fs').Stats
          try {
            kept = _lstatMigration(n === 0 ? base : `${base}.${n}`)
          } catch {
            break
          }
          if (kept.isFile() && kept.size === st.size && Math.abs(kept.mtimeMs - st.mtimeMs) < 1) return true
        }
      }
      return false
    }
    const stash = (source: string, rel: string): void => {
      const st = _lstatMigration(source)
      if (alreadyStashed(rel, st)) return
      noteAttempt()
      const target = freeTarget(rel)
      try {
        _copyFilePreservingMeta(source, target, st, copyFile)
      } catch (error) {
        // No empty stash dirs left behind (they would read as conflicts).
        for (let dir = _dirnameMigration(target); dir.startsWith(attemptRoot); dir = _dirnameMigration(dir)) {
          try {
            _rmdirMigration(dir)
          } catch {
            break
          }
        }
        throw error
      }
    }
    // A legacy entry where `~/rox` has something else: keep the whole subtree.
    const stashTree = (source: string, rel: string): void => {
      const st = _lstatMigration(source)
      if (st.isSymbolicLink()) {
        noteAttempt()
        const target = freeTarget(rel)
        mkdirSync(_dirnameMigration(target), { recursive: true })
        const link = _readlinkMigration(source)
        if (!_recreateLink(source, link, target, platform, symlink)) _writeLinkPlaceholder(target, link)
        return
      }
      if (st.isDirectory()) {
        noteAttempt()
        mkdirSync(join(attemptRoot, rel), { recursive: true })
        for (const name of _readdirMigration(source)) stashTree(join(source, name), `${rel}/${name}`)
        return
      }
      if (st.isFile()) stash(source, rel)
    }
    const lstatOrUndefined = (path: string): import('node:fs').Stats | undefined => {
      try {
        return _lstatMigration(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
        return undefined
      }
    }
    // `~/rox` wins everything it has, including deletions since an earlier
    // attempt: a handled path whose legacy entry is unchanged is skipped; a
    // changed one is never resurrected where `~/rox` no longer has it, only
    // stashed. Nothing is ever written through a link on the `~/rox` side.
    // `removed`: under a directory an earlier attempt handled that `~/rox`
    // no longer has (the user deleted it): what was handled stays removed;
    // anything never handled is kept aside, never dropped and never
    // resurrected into `~/rox`.
    const mergeEntry = (rel: string, removed = false): void => {
      if (++mergedEntries % heartbeatEvery === 0) {
        release.touch()
        flushSidecar()
      }
      if (_isMigrationDirBookkeeping(rel)) return
      const from = join(paths.hiddenDir, rel)
      const to = join(paths.visibleDir, rel)
      const fromStat = _lstatMigration(from)
      const handled = sidecar.handled.get(rel)
      const mergeChildren = (childrenRemoved: boolean): void => {
        for (const name of _readdirMigration(from)) mergeEntry(`${rel}/${name}`, childrenRemoved)
        // Per completed directory: a crash loses at most the records of the
        // directory in progress (narrow resurrection window).
        flushSidecar()
      }
      if (fromStat.isSymbolicLink()) {
        const link = _readlinkMigration(from)
        if (handled?.k === 'l' && handled.l === link) return
        const toStat = removed ? undefined : lstatOrUndefined(to)
        if (!toStat) {
          if (handled || removed) {
            stashTree(from, rel)
          } else {
            mkdirSync(_dirnameMigration(to), { recursive: true })
            // A file symlink Windows will not create: kept as a conflict.
            if (!_recreateLink(from, link, to, platform, symlink)) stashTree(from, rel)
          }
        } else {
          let same = false
          try {
            same = toStat.isSymbolicLink() && _readlinkMigration(to) === link
          } catch {
            same = false
          }
          if (!same) stashTree(from, rel)
        }
        record(rel, { k: 'l', l: link })
        return
      }
      if (fromStat.isDirectory()) {
        if (handled?.k === 't') return
        if (removed && !handled) {
          stashTree(from, rel)
          record(rel, { k: 't' })
          return
        }
        const toStat = removed ? undefined : lstatOrUndefined(to)
        if (toStat && !toStat.isDirectory()) {
          stashTree(from, rel)
          record(rel, { k: 't' })
          return
        }
        // Handled by an earlier attempt, gone from ~/rox since: stays removed
        // (only the children that attempt handled are skipped).
        if (!toStat && handled) {
          mergeChildren(true)
          return
        }
        // New dirs stay owner-writable until their subtree is merged, then get
        // the source mode (a failed attempt never leaves an unwritable dir
        // that would block the retry).
        if (!toStat) mkdirSync(to, { recursive: true, mode: 0o700 })
        // Recorded only once ~/rox has it: a failed mkdir (full disk,
        // EACCES) never reads as a user deletion on the retry.
        if (!handled) record(rel, { k: 'd' })
        mergeChildren(false)
        if (!toStat) {
          try {
            _chmodMigration(to, fromStat.mode & 0o777)
          } catch {
            // best effort
          }
        }
        return
      }
      if (!fromStat.isFile()) return
      if (handled?.k === 'f' && handled.s === fromStat.size && handled.m === fromStat.mtimeMs) return
      // Leftover of a copy that crashed on an earlier attempt.
      if (!removed) _dropCopyTemp(to)
      const toStat = removed ? undefined : lstatOrUndefined(to)
      if (!toStat) {
        // Never handled: copy it in. Handled before but gone from ~/rox (the
        // user deleted it) and changed in ~/.rox since, or never handled under
        // a removed dir: keep that version aside.
        if (handled || removed) stash(from, rel)
        else _copyFilePreservingMeta(from, to, fromStat, copyFile)
      } else if (!toStat.isFile() || !_filesIdentical(from, fromStat, to, toStat)) {
        // A link at the ~/rox side (dotfiles, dangling) or different bytes:
        // ~/rox keeps its version; the legacy one is stashed and reported.
        stash(from, rel)
      }
      record(rel, { k: 'f', s: fromStat.size, m: fromStat.mtimeMs })
    }
    try {
      for (const name of _readdirMigration(paths.hiddenDir)) {
        // Migration bookkeeping and per-dir locks stay in the archived legacy
        // dir; they are never carried into ~/rox.
        if (_isMergeRootBookkeeping(name)) continue
        mergeEntry(name)
        flushSidecar()
      }
      flushSidecar()
    } catch (error) {
      // Resumable: the handled paths are kept, and the retry rule applies
      // (no full walk on every launch for an unreadable file or a full disk).
      try {
        flushSidecar()
      } catch {
        // the retry re-checks unrecorded paths (identical ones are skipped)
      }
      recordFailure(error)
      throw error
    }
    // A writer that started during the import (it would write into files
    // already handled): defer the final rename; the next launch resumes.
    holders = lockHolders(true)
    if (holders.length > 0) return deferredByHolders(holders)
    const mergedFrom = `${paths.hiddenDir}.migrated-${timestamp}`
    try {
      rename(paths.hiddenDir, mergedFrom)
    } catch (error) {
      // ~/rox stays authoritative (marker choice 'visible'); ~/.rox keeps
      // everything. Retried by the rule in `_mergeRetryBlocked` or an
      // explicit migrate-config; handled paths are not imported again.
      const failure = recordFailure(error)
      return done('deferred-unmovable', {
        conflicts: mergeConflicts(),
        diagnostics: ['storage.migration.mergeRenameFailed', `rename:${failure.code}`, `attempts:${failure.attempts}`],
      })
    }
    // The import is complete in ~/rox from here on: the marker must not keep
    // describing a legacy tree that is gone (or gets recreated).
    _removeMergeIncompleteMarker(paths.visibleDir)
    const conflicts = mergeConflicts()
    const diagnostics = conflicts.length > 0 ? ['storage.migration.conflictsKept'] : []
    try {
      linkDir(paths.visibleDir, paths.hiddenDir, linkType)
    } catch (error) {
      // Legacy path still free: put the original back (state as before the
      // final step, marker restored with the failure so the retry rule
      // applies; the sidecar keeps the retry from importing again).
      if (!_pathPresent(paths.hiddenDir)) {
        let restored = false
        try {
          rename(mergedFrom, paths.hiddenDir)
          restored = true
        } catch {
          restored = false
        }
        if (restored) {
          recordFailure(error)
          throw error
        }
      }
      _removeImportSidecar(paths.visibleDir)
      const result = done('merged', {
        conflicts,
        diagnostics: [...diagnostics, 'storage.migration.compatLinkMissing'],
        announceToast: true,
        relaunchRequired: true,
      })
      result.reportPath = _writeMigrationReport(paths.visibleDir, timestamp, result, summary)
      return result
    }
    _removeImportSidecar(paths.visibleDir)
    const result = done('merged', {
      conflicts,
      diagnostics,
      announceToast: true,
    })
    result.reportPath = _writeMigrationReport(paths.visibleDir, timestamp, result, summary)
    return result
  } finally {
    release()
  }
}

/**
 * Revert the visible home: remove the `~/.rox` symlink and rename `~/rox`
 * back to `~/.rox`. Refused when `.migration/conflicts` is non-empty, when
 * the visible-root flag is still active (env or persisted — the next start
 * would migrate straight back), or while a live Rox writer holds a lock.
 * Runs under the same process lock as the migration; if the rename fails
 * after the symlink was removed, the symlink is restored.
 */
export function revertVisibleRoxHome(options?: MigrateHiddenRoxHomeOptions): VisibleHomeMigrationResult {
  const env = options?.env ?? process.env
  const paths = defaultVisibleHomePaths(options?.homeDir)
  const dryRun = options?.dryRun === true
  const rename = options?.rename ?? _renameMigration
  const base: VisibleHomeMigrationResult = {
    outcome: 'noop',
    visibleDir: paths.visibleDir,
    hiddenDir: paths.hiddenDir,
    dryRun,
    manifest: [],
    conflicts: [],
    diagnostics: [],
    announceToast: false,
  }
  let hiddenStat: ReturnType<typeof _lstatMigration> | undefined
  try {
    hiddenStat = _lstatMigration(paths.hiddenDir)
  } catch {
    hiddenStat = undefined
  }
  if (hiddenStat?.isSymbolicLink() !== true || !_isSymlinkTo(paths.hiddenDir, paths.visibleDir, options?.platform ?? process.platform)) {
    return { ...base, outcome: 'noop', diagnostics: ['storage.migration.revertNoSymlink'] }
  }
  const flagActive =
    options?.flagActive ?? (visibleRootEnvOverride(env) ?? readPersistedVisibleRootFlag(paths.homeDir))
  if (flagActive) {
    return { ...base, outcome: 'revert-refused', diagnostics: ['storage.migration.revertRefusedFlagActive'] }
  }
  const conflictEntries = _listConflicts(join(paths.visibleDir, ROX_HOME_MIGRATION_DIR_NAME, 'conflicts'))
  if (conflictEntries.length > 0) {
    return {
      ...base,
      outcome: 'revert-refused',
      conflicts: conflictEntries.sort(),
      diagnostics: ['storage.migration.revertRefusedConflicts'],
    }
  }
  // An app launched before the move runs on the compat-link path: its
  // runtime lock is keyed by that path, so probe both spellings.
  const holders = options?.isLocked
    ? options.isLocked(paths.visibleDir)
    : [...new Set([..._liveHomeLockHolders(paths.visibleDir, options), ..._liveHomeLockHolders(paths.hiddenDir, options)])]
  if (holders.length > 0) {
    return {
      ...base,
      outcome: 'revert-refused',
      diagnostics: ['storage.migration.revertRefusedLocked', ...holders.map((h) => `locked:${h}`)],
    }
  }
  if (dryRun) return { ...base, outcome: 'reverted' }
  const release = options?.skipProcessLock === true ? () => {} : _acquireProcessLock(options)
  if (typeof release !== 'function') {
    return {
      ...base,
      outcome: 'revert-refused',
      diagnostics: ['storage.migration.revertRefusedLocked', `locked:${release.deferred}`],
    }
  }
  try {
    const linkTarget = _readlinkMigration(paths.hiddenDir)
    _unlinkMigration(paths.hiddenDir)
    try {
      rename(paths.visibleDir, paths.hiddenDir)
    } catch (error) {
      // Put the compat link back so `~/.rox` never goes missing.
      try {
        _symlinkMigration(linkTarget, paths.hiddenDir, process.platform === 'win32' ? 'junction' : 'dir')
      } catch {
        // nothing more we can do; the data itself is untouched in ~/rox
      }
      throw error
    }
  } finally {
    release()
  }
  return { ...base, outcome: 'reverted' }
}
