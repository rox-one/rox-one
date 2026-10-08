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
//   that cannot be renamed (cross-device, mount point) defers; nothing is copied.
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
  readdirSync as _readdirMigration,
  readFileSync as _readMigrationFile,
  readlinkSync as _readlinkMigration,
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
import { basename as _basenameMigration, dirname as _dirnameMigration, relative as _relativeMigration, sep as _pathSep, posix as _posixPath, win32 as _win32Path } from 'node:path'
import { createHash as _createLockHash } from 'node:crypto'
import { constants as _fsConstants, realpathSync as _realpathMigration } from 'node:fs'

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
  const file = visibleRootFlagFilePath(homeDir)
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
  /** Older lock locations still honoured when live (tests; default the tmpdir lock). */
  legacyProcessLockPaths?: string[]
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
}

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

interface LockLivenessOptions {
  now: number
  isPidAlive: (pid: number) => boolean
  /** Locks older than this are stale even with a live PID (PID reuse). */
  ttlMs?: number
  /** Max age for locks without a parseable PID. */
  pidlessTtlMs: number
}

/**
 * Whether a lock file still has a live holder. Stale: own PID (previous
 * container lifecycle), dead PID, written before the current boot, older
 * than `ttlMs`, or PID-less and older than `pidlessTtlMs`.
 */
export function isLockFileLive(path: string, options: LockLivenessOptions): boolean {
  let st: ReturnType<typeof _lstatMigration>
  try {
    st = _lstatMigration(path)
  } catch {
    return false
  }
  let identity: MigrationLockIdentity | null = null
  if (st.isFile()) {
    try {
      identity = parseMigrationLockContent(_readMigrationFile(path, 'utf8'))
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
  if (options.ttlMs !== undefined && options.now - writtenAt > options.ttlMs) return false
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

function _lockUid(): string {
  try {
    return String(process.getuid?.() ?? 'default')
  } catch {
    return 'default' // non-POSIX
  }
}

/**
 * Per-user runtime twin of the desktop app lock, outside the home (tmpdir),
 * keyed by the config dir path the app runs on. Lets an explicit
 * `migrate-config` defer while a flag-OFF app runs without adding a file to
 * the config dir. This is the original (compat) location; see
 * `desktopAppRuntimeLockPaths` for every location written and probed.
 */
export function desktopAppRuntimeLockPath(configDir: string, tmp: string = tmpdir()): string {
  const key = _createLockHash('sha256').update(configDir).digest('hex').slice(0, 16)
  return join(tmp, `rox-desktop-${_lockUid()}-${key}.lock`)
}

/**
 * Every runtime desktop-lock location, written by the app and probed by a
 * migration: the process tmpdir (compat), `$XDG_RUNTIME_DIR` when set, and
 * `/tmp` on POSIX. A CLI and an app with different `TMPDIR`s still meet in
 * one of them. Never under `$HOME`: a flag-OFF app adds nothing to the home.
 * Limitation: processes in different mount namespaces (snap/flatpak private
 * `/tmp` without a shared runtime dir) or under another uid cannot see each
 * other's runtime lock; the in-config-dir `.app.lock` (flag ON) still does.
 */
export function desktopAppRuntimeLockPaths(
  configDir: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  tmp: string = tmpdir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  const dirs = [tmp]
  const runtimeDir = env.XDG_RUNTIME_DIR?.trim()
  if (runtimeDir && _posixPath.isAbsolute(runtimeDir)) dirs.push(runtimeDir)
  if (platform !== 'win32') dirs.push('/tmp')
  return [...new Set(dirs.map((dir) => desktopAppRuntimeLockPath(configDir, dir)))]
}

/**
 * Electron main: hold the desktop app lock(s) for the process lifetime.
 * Returns the release function (call on quit). Best effort: a failed write
 * never blocks startup.
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
  const content = JSON.stringify({ pid: process.pid, startedAt: options.now ?? Date.now(), kind: 'desktop-app' })
  const paths = [...(options.runtimeLockPaths ?? desktopAppRuntimeLockPaths(configDir, options.env ?? process.env))]
  if (options.inConfigDir) paths.push(join(configDir, ROX_DESKTOP_APP_LOCK_NAME))
  const held: string[] = []
  for (const path of paths) {
    try {
      const temp = `${path}.tmp-${process.pid}`
      _writeMigrationFile(temp, content, { encoding: 'utf8', mode: 0o600 })
      _renameMigration(temp, path)
      held.push(path)
    } catch {
      // best effort
    }
  }
  return () => {
    for (const path of held) {
      try {
        const identity = parseMigrationLockContent(_readMigrationFile(path, 'utf8'))
        if (identity?.pid === process.pid) _unlinkMigration(path)
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
  const runtimeLocks = options?.desktopRuntimeLockPath
    ? [options.desktopRuntimeLockPath(dir)]
    : desktopAppRuntimeLockPaths(dir, options?.env ?? process.env)
  for (const path of runtimeLocks) probes.push(['desktop-app', path])
  let desktopLive = false
  for (const [name, path] of probes) {
    if (name === 'desktop-app' && desktopLive) continue
    try {
      // `.server.lock` / `.app.lock` are long-lived PID files (a server or the
      // app may run for days): liveness + boot time decide, no TTL.
      if (isLockFileLive(path, { now, isPidAlive, pidlessTtlMs: ROX_PIDLESS_LOCK_TTL_MS })) {
        holders.push(name)
        if (name === 'desktop-app') desktopLive = true
      }
    } catch {
      // unreadable — do not block on a failed probe
    }
  }
  return holders
}

function _sha256File(path: string): string {
  const hash = _createMigrationHash('sha256')
  hash.update(_statMigration(path).isFile() ? _readMigrationFile(path) : Buffer.alloc(0))
  return hash.digest('hex')
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

/** Lock location of earlier builds (`${tmpdir()}/rox-migrate-<uid>.lock`): still honoured when live. */
function _legacyProcessLockPaths(options?: MigrateHiddenRoxHomeOptions): string[] {
  return options?.legacyProcessLockPaths ?? [join(tmpdir(), `rox-migrate-${_lockUid()}.lock`)]
}

/**
 * O_EXCL process lock carrying `{ pid, startedAt }`. A lock left by a dead
 * PID, a previous boot, or older than `ROX_MIGRATION_LOCK_TTL_MS` is stale
 * and taken over once; a live lock defers.
 */
function _acquireProcessLock(options?: MigrateHiddenRoxHomeOptions): (() => void) | { deferred: string } {
  const lockPath = options?.processLockPath ?? _defaultProcessLockPath(options)
  const now = options?.now?.() ?? Date.now()
  // A live lock at the old tmpdir location (a still-running older build) defers too.
  for (const legacy of _legacyProcessLockPaths(options)) {
    if (legacy === lockPath) continue
    const legacyLive = isLockFileLive(legacy, {
      now,
      isPidAlive: options?.isPidAlive ?? defaultIsPidAlive,
      ttlMs: ROX_MIGRATION_LOCK_TTL_MS,
      pidlessTtlMs: 60_000,
    })
    if (legacyLive) return { deferred: legacy }
  }
  const tryCreate = (): (() => void) | null => {
    try {
      const fd = _openMigrationLock(lockPath, 'wx', 0o600)
      try {
        _writeMigrationFd(fd, JSON.stringify({ pid: process.pid, startedAt: now }))
      } finally {
        _closeMigrationLock(fd)
      }
      return () => {
        try {
          _unlinkMigration(lockPath)
        } catch {
          // best effort
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') return null
      throw error
    }
  }
  const first = tryCreate()
  if (first) return first
  const live = isLockFileLive(lockPath, {
    now,
    isPidAlive: options?.isPidAlive ?? defaultIsPidAlive,
    ttlMs: ROX_MIGRATION_LOCK_TTL_MS,
    // A lock being written right now has no PID for a moment.
    pidlessTtlMs: 60_000,
  })
  if (live) return { deferred: lockPath }
  try {
    _unlinkMigration(lockPath)
  } catch {
    // raced with another process — fall through to one retry
  }
  return tryCreate() ?? { deferred: lockPath }
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

export interface MergeIncompleteMarker {
  startedAt: number
  /** Pre-merge snapshot: whether each tree held user data. */
  hiddenHasData: boolean
  visibleHasData: boolean
  /** The dir processes keep using until the merge completes. */
  choice: 'hidden' | 'visible'
  /** `dev:ino` of the hidden tree the snapshot was taken from. */
  hiddenId?: string
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
 * paths relative to it; empty directories end with `/`.
 */
function _listConflicts(conflictsRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string): void => {
    let names: string[]
    try {
      names = _readdirMigration(dir)
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
    }
  } catch {
    try {
      // Present but unreadable/garbled: still an incomplete merge.
      _lstatMigration(mergeIncompleteMarkerPath(visibleDir))
      return { startedAt: 0, hiddenHasData: true, visibleHasData: false, choice: 'hidden' }
    } catch {
      return undefined
    }
  }
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
 * before its single-instance lock). Never writes. `~/rox` only when it
 * already is the home (symlinked / visible-only / a fresh machine); a legacy
 * home awaiting migration, a foreign `~/rox`, or an incomplete merge whose
 * pre-merge snapshot chose the legacy dir keep `~/.rox`.
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

  // States that need no move. Re-evaluated after the process lock: another
  // process may have migrated meanwhile.
  const settled = (state: VisibleHomeState): VisibleHomeMigrationResult | undefined => {
    switch (state) {
      case 'symlinked':
        if (!dryRun && existsSync(paths.visibleDir)) _ensurePrivateDir(paths.visibleDir)
        return done('already-symlinked')
      case 'symlink-elsewhere':
        return done('symlink-elsewhere', { diagnostics: ['storage.migration.symlinkElsewhere'] })
      case 'foreign':
        return done('deferred-foreign', { diagnostics: ['storage.migration.deferredForeign'] })
      case 'clean':
        if (!dryRun) _ensurePrivateDir(paths.visibleDir)
        return done('clean-install')
      case 'visible-only':
        if (!dryRun) _ensurePrivateDir(paths.visibleDir)
        return done('already-visible')
      default:
        return undefined
    }
  }
  // The legacy dir must be renamable in place (it is not a mount point and
  // its parent allows the rename): otherwise the final rename of a merge
  // would fail after all the work, and every launch would repeat it.
  // Probed by renaming it to a sibling and straight back.
  const legacyRenameBlocker = (): string | undefined => {
    try {
      if (_statMigration(paths.hiddenDir).dev !== _statMigration(paths.homeDir).dev) return 'mount-point'
    } catch {
      // fall through to the rename probe
    }
    const probe = `${paths.hiddenDir}.migrated-${timestamp}-probe`
    if (_pathPresent(probe)) return 'probe-path-busy'
    try {
      rename(paths.hiddenDir, probe)
    } catch (error) {
      return (error as NodeJS.ErrnoException | null)?.code ?? 'rename-failed'
    }
    try {
      rename(probe, paths.hiddenDir)
    } catch {
      try {
        rename(probe, paths.hiddenDir)
      } catch (error) {
        // Keep the legacy path resolving (never strand on a vanished dir).
        try {
          linkDir(probe, paths.hiddenDir, linkType)
        } catch {
          // reported below
        }
        throw new Error(
          `Legacy home rename probe could not move back (data intact at ${probe}): ${(error as Error).message}`,
        )
      }
    }
    return undefined
  }
  const deferredUnmovable = (blocker: string): VisibleHomeMigrationResult =>
    done('deferred-unmovable', { diagnostics: ['storage.migration.legacyNotRenamable', `rename:${blocker}`] })
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

  let state = _classifyVisibleHome(paths, platform)
  const early = settled(state)
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

  const release = options?.skipProcessLock === true ? () => {} : _acquireProcessLock(options)
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

    if (state === 'hidden-only') {
      // Crash evidence while the move is in flight; removed once verified.
      const manifestPath = join(paths.hiddenDir, ROX_HOME_MIGRATION_MANIFEST_NAME)
      try {
        _writeMigrationFile(manifestPath, `${JSON.stringify(manifest)}\n`, { encoding: 'utf8', mode: 0o600 })
      } catch {
        // best effort; equality is still verified after the move
      }
      // Only `~/.rox`: one atomic rename. EXDEV means `~/.rox` cannot leave
      // its volume (mount point, overlayfs lower dir): defer, copy nothing.
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
        if ((error as NodeJS.ErrnoException | null)?.code === 'EXDEV') return deferredUnmovable('EXDEV')
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
        const result = done('migrated', {
          manifest: buildVisibleHomeManifest(paths.visibleDir, { hash: false }),
          diagnostics: ['storage.migration.compatLinkMissing'],
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
      const result = done('migrated', {
        manifest: after,
        diagnostics: equal ? [] : ['storage.migration.checksumMismatch'],
        announceToast: true,
      })
      result.reportPath = _writeMigrationReport(paths.visibleDir, timestamp, result, summary)
      return result
    }

    // Both real dirs: per-file merge into `~/rox`. Identical files are
    // skipped; for differing files a tree without user data (fresh defaults)
    // always loses; otherwise the newer mtime wins. The loser is kept under
    // `.migration/conflicts/`. The user-data snapshot is taken once, before
    // the first attempt, and recorded in an incomplete-merge marker: a merge
    // that failed halfway never lets its partial copy (or later writes to it)
    // win a retry, and read-only resolution keeps the pre-merge choice.
    // A legacy dir that cannot be renamed away defers before anything is
    // copied or stashed (no repeated merge per launch).
    const mergeBlocker = legacyRenameBlocker()
    if (mergeBlocker) return deferredUnmovable(mergeBlocker)
    _ensurePrivateDir(paths.visibleDir)
    const hiddenId = _treeId(paths.hiddenDir)
    let previous = readMergeIncompleteMarker(paths.visibleDir)
    // A snapshot of a different hidden tree (the original was renamed away
    // and something recreated `~/.rox`) is stale: take a fresh one.
    if (previous && !_markerMatchesHidden(previous, paths.hiddenDir)) previous = undefined
    const hiddenHasData = previous?.hiddenHasData ?? roxHomeHasUserData(paths.hiddenDir)
    const visibleHasData = previous?.visibleHasData ?? roxHomeHasUserData(paths.visibleDir)
    const marker: MergeIncompleteMarker = previous ?? {
      startedAt: options?.now?.() ?? Date.now(),
      hiddenHasData,
      visibleHasData,
      // Until the merge completes, the intact legacy home wins whenever it
      // holds user data (a partial ~/rox is mixed); ~/rox only when the
      // legacy home had nothing to lose.
      choice: hiddenHasData || !visibleHasData ? 'hidden' : 'visible',
      ...(hiddenId ? { hiddenId } : {}),
    }
    // Strict: without the marker a partial merge could later win.
    if (!previous) _writeMergeIncompleteMarker(paths.visibleDir, marker)
    const preferHidden = hiddenHasData && !visibleHasData
    const preferVisible = visibleHasData && !hiddenHasData
    const conflictsRoot = join(paths.visibleDir, ROX_HOME_MIGRATION_DIR_NAME, 'conflicts')
    // Per attempt: a retry never overwrites an earlier stash (it may be the
    // only copy left of a losing file). Same-attempt collisions get a suffix.
    const attemptRoot = join(conflictsRoot, timestamp)
    const freeTarget = (rel: string): string => {
      const base = join(attemptRoot, rel)
      if (!_pathPresent(base)) return base
      for (let n = 1; ; n++) {
        const candidate = `${base}.${n}`
        if (!_pathPresent(candidate)) return candidate
      }
    }
    const stash = (source: string, rel: string): void => {
      _copyFilePreservingMeta(source, freeTarget(rel), _lstatMigration(source), copyFile)
    }
    // A legacy directory where `~/rox` has a file: keep the whole subtree.
    const stashTree = (source: string, rel: string): void => {
      const st = _lstatMigration(source)
      if (st.isSymbolicLink()) {
        const target = freeTarget(rel)
        mkdirSync(_dirnameMigration(target), { recursive: true })
        _symlinkMigration(_readlinkMigration(source), target)
        return
      }
      if (st.isDirectory()) {
        mkdirSync(join(attemptRoot, rel), { recursive: true })
        for (const name of _readdirMigration(source)) stashTree(join(source, name), `${rel}/${name}`)
        return
      }
      if (st.isFile()) stash(source, rel)
    }
    const mergeEntry = (rel: string): void => {
      const from = join(paths.hiddenDir, rel)
      const to = join(paths.visibleDir, rel)
      const fromStat = _lstatMigration(from)
      if (fromStat.isSymbolicLink()) {
        let toStat: import('node:fs').Stats | undefined
        try {
          toStat = _lstatMigration(to)
        } catch {
          toStat = undefined
        }
        const link = _readlinkMigration(from)
        if (!toStat) {
          mkdirSync(_dirnameMigration(to), { recursive: true })
          _symlinkMigration(link, to)
          return
        }
        // Same link on both sides: nothing to keep. Anything else in ~/rox
        // stays; the legacy link is stashed (and reported), never dropped.
        let same = false
        try {
          same = toStat.isSymbolicLink() && _readlinkMigration(to) === link
        } catch {
          same = false
        }
        if (!same) stashTree(from, rel)
        return
      }
      if (fromStat.isDirectory()) {
        let toStat: import('node:fs').Stats | undefined
        try {
          toStat = _lstatMigration(to)
        } catch {
          toStat = undefined
        }
        if (toStat && !toStat.isDirectory()) {
          stashTree(from, rel)
          return
        }
        // New dirs stay owner-writable until their subtree is merged, then get
        // the source mode (a failed attempt never leaves an unwritable dir
        // that would block the retry).
        if (!toStat) mkdirSync(to, { recursive: true, mode: 0o700 })
        for (const name of _readdirMigration(from)) mergeEntry(rel ? `${rel}/${name}` : name)
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
      // Leftover of a copy that crashed on an earlier attempt.
      _dropCopyTemp(to)
      // lstat: a link at the ~/rox side (to a dotfiles repo, or dangling) is
      // a conflict — the legacy file is stashed and the link and its target
      // stay untouched. Nothing is ever written through a link.
      let toStat: import('node:fs').Stats | undefined
      try {
        toStat = _lstatMigration(to)
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
        toStat = undefined
      }
      if (!toStat) {
        _copyFilePreservingMeta(from, to, fromStat, copyFile)
        return
      }
      if (!toStat.isFile()) {
        stash(from, rel)
        return
      }
      if (toStat.size === fromStat.size && _sha256File(from) === _sha256File(to)) return
      const hiddenWins = preferHidden ? true : preferVisible ? false : fromStat.mtimeMs > toStat.mtimeMs
      if (hiddenWins) {
        stash(to, rel)
        _copyFilePreservingMeta(from, to, fromStat, copyFile)
      } else {
        stash(from, rel)
      }
    }
    for (const name of _readdirMigration(paths.hiddenDir)) {
      if (name === ROX_HOME_MIGRATION_MANIFEST_NAME) continue
      mergeEntry(name)
    }
    const mergedFrom = `${paths.hiddenDir}.migrated-${timestamp}`
    rename(paths.hiddenDir, mergedFrom)
    // The merge is complete in ~/rox from here on: the marker must not keep
    // pointing processes at a legacy path that is gone (or gets recreated).
    _removeMergeIncompleteMarker(paths.visibleDir)
    const conflicts = _listConflicts(conflictsRoot)
    const diagnostics = conflicts.length > 0 ? ['storage.migration.conflictsKept'] : []
    try {
      linkDir(paths.visibleDir, paths.hiddenDir, linkType)
    } catch (error) {
      // Legacy path still free: put the original back (state as before the
      // final step, marker restored; a retry re-merges identical files).
      if (!_pathPresent(paths.hiddenDir)) {
        try {
          rename(mergedFrom, paths.hiddenDir)
          _writeMergeIncompleteMarker(paths.visibleDir, marker)
          throw error
        } catch (rollbackError) {
          if (rollbackError === error) throw error
        }
      }
      const result = done('merged', {
        conflicts,
        diagnostics: [...diagnostics, 'storage.migration.compatLinkMissing'],
        announceToast: true,
        relaunchRequired: true,
      })
      result.reportPath = _writeMigrationReport(paths.visibleDir, timestamp, result, summarizeVisibleHomeManifest(manifest))
      return result
    }
    const result = done('merged', {
      conflicts,
      diagnostics,
      announceToast: true,
    })
    result.reportPath = _writeMigrationReport(paths.visibleDir, timestamp, result, summarizeVisibleHomeManifest(manifest))
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
