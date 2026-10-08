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
//   on Windows / cross-device the original is kept as `.rox.migrated-<ts>`.
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
  statSync as _statMigration,
  symlinkSync as _symlinkMigration,
  unlinkSync as _unlinkMigration,
  utimesSync as _utimesMigration,
  writeFileSync as _writeMigrationFile,
  writeSync as _writeMigrationFd,
} from 'node:fs'
import { uptime as _osUptime } from 'node:os'
import { dirname as _dirnameMigration, relative as _relativeMigration, sep as _pathSep } from 'node:path'

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

/**
 * The single `workbench-flags.json` that decides `storage.visible-root.v1`:
 * it lives in the directory the flag-OFF rules resolve to (`~/rox` if it
 * exists, else the legacy `~/.rox`). Reader and writer share this path so a
 * toggle always lands in the file `resolveConfigDir()` reads.
 */
export function visibleRootFlagFilePath(homeDir: string = homedir()): string {
  const visible = join(homeDir, ROX_VISIBLE_HOME_DIR_NAME)
  const dir = existsSync(visible) ? visible : join(homeDir, ROX_HIDDEN_HOME_LINK_NAME)
  return join(dir, ROX_WORKBENCH_FLAGS_FILE_NAME)
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
  /** Only when built with `{ hash: true }` (EXDEV verification, tests). */
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
  /** Process lock path (default `${tmpdir()}/rox-migrate-${uid}.lock`). */
  processLockPath?: string
  /** Injectable PID liveness probe (tests). */
  isPidAlive?: (pid: number) => boolean
  /** Injectable clock (tests). */
  now?: () => number
  /** Revert only: whether the visible-root flag is active (default: env + persisted file). */
  flagActive?: boolean
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
  if (identity.startedAt > 0 && identity.startedAt < bootTime) return false
  if (options.ttlMs !== undefined && options.now - writtenAt > options.ttlMs) return false
  return true
}

/** Lock files inside a Rox home whose live holders must defer a move. */
export const ROX_HOME_WRITER_LOCK_NAMES = ['config.json.lock', '.server.lock'] as const

function _liveHomeLockHolders(dir: string, options?: MigrateHiddenRoxHomeOptions): string[] {
  const now = options?.now?.() ?? Date.now()
  const isPidAlive = options?.isPidAlive ?? defaultIsPidAlive
  const holders: string[] = []
  for (const name of ROX_HOME_WRITER_LOCK_NAMES) {
    try {
      // `.server.lock` is a long-lived PID file (a server may run for days):
      // liveness + boot time decide, no TTL.
      if (isLockFileLive(join(dir, name), { now, isPidAlive, pidlessTtlMs: ROX_PIDLESS_LOCK_TTL_MS })) {
        holders.push(name)
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

function _copyFilePreservingMeta(source: string, destination: string, st: import('node:fs').Stats): void {
  mkdirSync(_dirnameMigration(destination), { recursive: true })
  _copyMigrationFile(source, destination)
  try {
    _chmodMigration(destination, st.mode & 0o777)
  } catch {
    // best effort
  }
  try {
    _utimesMigration(destination, st.atime, st.mtime)
  } catch {
    // best effort — mtimes feed the merge rule, never correctness
  }
}

function _copyTreeWithModes(source: string, destination: string, isRoot = true): void {
  const st = _lstatMigration(source)
  if (st.isSymbolicLink()) {
    mkdirSync(_dirnameMigration(destination), { recursive: true })
    try {
      _symlinkMigration(_readlinkMigration(source), destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
    }
    return
  }
  if (st.isDirectory()) {
    mkdirSync(destination, { recursive: true, mode: st.mode & 0o777 })
    for (const name of _readdirMigration(source)) {
      // The in-flight manifest is migration scaffolding, not user data.
      if (isRoot && name === ROX_HOME_MIGRATION_MANIFEST_NAME) continue
      _copyTreeWithModes(join(source, name), join(destination, name), false)
    }
    return
  }
  if (st.isFile()) _copyFilePreservingMeta(source, destination, st)
}

/**
 * EXDEV verification: every manifest file exists in the copy with the same
 * size and the same SHA-256 as its source (hashing happens only here).
 */
function _verifyCopyAgainstSource(
  sourceRoot: string,
  copyRoot: string,
  manifest: readonly VisibleHomeManifestEntry[],
): string[] {
  const mismatches: string[] = []
  for (const entry of manifest) {
    const full = join(copyRoot, entry.path)
    try {
      if (entry.kind === 'file') {
        const st = _statMigration(full)
        if (!st.isFile() || st.size !== entry.size || _sha256File(full) !== _sha256File(join(sourceRoot, entry.path))) {
          mismatches.push(entry.path)
        }
      } else if (entry.kind === 'symlink') {
        if (_readlinkMigration(full) !== entry.link) mismatches.push(entry.path)
      } else if (!_lstatMigration(full).isDirectory()) {
        mismatches.push(entry.path)
      }
    } catch {
      mismatches.push(entry.path)
    }
  }
  return mismatches
}

function _isSymlinkTo(path: string, target: string): boolean {
  try {
    if (!_lstatMigration(path).isSymbolicLink()) return false
    const link = _readlinkMigration(path)
    return link === target || join(_dirnameMigration(path), link) === target
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

function _defaultProcessLockPath(): string {
  let uid = 'default'
  try {
    uid = String(process.getuid?.() ?? 'default')
  } catch {
    // non-POSIX — single shared lock name
  }
  return join(tmpdir(), `rox-migrate-${uid}.lock`)
}

/**
 * O_EXCL process lock carrying `{ pid, startedAt }`. A lock left by a dead
 * PID, a previous boot, or older than `ROX_MIGRATION_LOCK_TTL_MS` is stale
 * and taken over once; a live lock defers.
 */
function _acquireProcessLock(options?: MigrateHiddenRoxHomeOptions): (() => void) | { deferred: string } {
  const lockPath = options?.processLockPath ?? _defaultProcessLockPath()
  const now = options?.now?.() ?? Date.now()
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

/**
 * Move `~/.rox` → `~/rox` (MIG-13). Never deletes user data; leaves `~/.rox`
 * as a symlink (Windows: directory junction) to `~/rox`. Throws on I/O
 * failures mid-move (the caller keeps the legacy dir in that case).
 */
export function migrateHiddenRoxHome(options?: MigrateHiddenRoxHomeOptions): VisibleHomeMigrationResult {
  const env = options?.env ?? process.env
  const paths = defaultVisibleHomePaths(options?.homeDir)
  const dryRun = options?.dryRun === true
  const platform = options?.platform ?? process.platform
  const timestamp = _migrationTimestamp(options)
  const rename = options?.rename ?? _renameMigration
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

  let hiddenStat: ReturnType<typeof _lstatMigration> | undefined
  try {
    hiddenStat = _lstatMigration(paths.hiddenDir)
  } catch {
    hiddenStat = undefined
  }
  const hiddenExists = hiddenStat !== undefined
  const hiddenIsSymlink = hiddenStat?.isSymbolicLink() === true
  const visibleExists = existsSync(paths.visibleDir)

  if (hiddenIsSymlink) {
    if (_isSymlinkTo(paths.hiddenDir, paths.visibleDir)) {
      if (!dryRun && visibleExists) _ensurePrivateDir(paths.visibleDir)
      return done('already-symlinked')
    }
    return done('symlink-elsewhere', {
      diagnostics: ['storage.migration.symlinkElsewhere'],
    })
  }

  if (!hiddenExists && !visibleExists) {
    if (!dryRun) _ensurePrivateDir(paths.visibleDir)
    return done('clean-install')
  }

  if (!hiddenExists && visibleExists) {
    if (!dryRun) _ensurePrivateDir(paths.visibleDir)
    return done('already-visible')
  }

  // Only `~/.rox` (real dir), or both real dirs: check live writers first.
  const holders = options?.isLocked
    ? options.isLocked(paths.hiddenDir)
    : [
        ..._liveHomeLockHolders(paths.hiddenDir, options),
        ...(visibleExists ? _liveHomeLockHolders(paths.visibleDir, options).map((h) => `rox/${h}`) : []),
      ]
  if (holders.length > 0) {
    return done('deferred-locked', {
      diagnostics: ['storage.migration.deferredLocked', ...holders.map((h) => `locked:${h}`)],
    })
  }

  // size / mode / mtime only — no content hashing on the atomic path.
  const manifest = buildVisibleHomeManifest(paths.hiddenDir, { hash: false })
  base.manifest = manifest
  const summary = summarizeVisibleHomeManifest(manifest)

  if (dryRun) {
    return visibleExists ? done('merged', { announceToast: true }) : done('migrated', { announceToast: true })
  }

  const release = options?.skipProcessLock === true ? () => {} : _acquireProcessLock(options)
  if (typeof release !== 'function') {
    return done('deferred-locked', {
      diagnostics: ['storage.migration.deferredLocked', `locked:${release.deferred}`],
    })
  }
  try {
    if (!visibleExists) {
      // Crash evidence while the move is in flight; removed once verified.
      const manifestPath = join(paths.hiddenDir, ROX_HOME_MIGRATION_MANIFEST_NAME)
      try {
        _writeMigrationFile(manifestPath, `${JSON.stringify(manifest)}\n`, { encoding: 'utf8', mode: 0o600 })
      } catch {
        // best effort; equality is still verified after the move
      }
      // Only `~/.rox`: atomic rename, EXDEV falls back to copy + verify + swap.
      let moved = false
      try {
        try {
          rename(paths.hiddenDir, paths.visibleDir)
          moved = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException | null)?.code !== 'EXDEV') throw error
        }
        if (!moved) {
          const staging = `${paths.visibleDir}.tmp-${process.pid}`
          rmSync(staging, { recursive: true, force: true })
          _ensurePrivateDir(staging)
          _copyTreeWithModes(paths.hiddenDir, staging)
          const mismatches = _verifyCopyAgainstSource(paths.hiddenDir, staging, manifest)
          if (mismatches.length > 0) {
            // Our own staging copy only; the original is untouched.
            rmSync(staging, { recursive: true, force: true })
            throw new Error(`Cross-device copy verification failed: ${mismatches.slice(0, 5).join(', ')}`)
          }
          rename(staging, paths.visibleDir)
          // Never delete: keep the original under a timestamped name.
          rename(paths.hiddenDir, `${paths.hiddenDir}.migrated-${timestamp}`)
        }
      } catch (error) {
        if (!moved) {
          // Nothing moved: drop our scaffolding so the legacy tree is as before.
          try {
            _unlinkMigration(manifestPath)
          } catch {
            // never written / already gone
          }
        }
        throw error
      }
      _ensurePrivateDir(paths.visibleDir)
      linkDir(paths.visibleDir, paths.hiddenDir, linkType)
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
    // `.migration/conflicts/`.
    _ensurePrivateDir(paths.visibleDir)
    const hiddenHasData = roxHomeHasUserData(paths.hiddenDir)
    const visibleHasData = roxHomeHasUserData(paths.visibleDir)
    const preferHidden = hiddenHasData && !visibleHasData
    const preferVisible = visibleHasData && !hiddenHasData
    const conflicts: string[] = []
    const conflictsRoot = join(paths.visibleDir, ROX_HOME_MIGRATION_DIR_NAME, 'conflicts')
    const stash = (source: string, rel: string): void => {
      const target = join(conflictsRoot, rel)
      _copyFilePreservingMeta(source, target, _lstatMigration(source))
      conflicts.push(rel)
    }
    const mergeEntry = (rel: string): void => {
      const from = join(paths.hiddenDir, rel)
      const to = join(paths.visibleDir, rel)
      const fromStat = _lstatMigration(from)
      if (fromStat.isSymbolicLink()) {
        let toExists = false
        try {
          _lstatMigration(to)
          toExists = true
        } catch {
          toExists = false
        }
        if (!toExists) {
          mkdirSync(_dirnameMigration(to), { recursive: true })
          _symlinkMigration(_readlinkMigration(from), to)
        }
        return
      }
      if (fromStat.isDirectory()) {
        let toStat: ReturnType<typeof _lstatMigration> | undefined
        try {
          toStat = _lstatMigration(to)
        } catch {
          toStat = undefined
        }
        if (toStat && !toStat.isDirectory()) {
          // A file sits where the legacy tree has a directory: keep both.
          for (const name of _readdirMigration(from)) {
            const childRel = `${rel}/${name}`
            const child = join(paths.hiddenDir, childRel)
            if (_lstatMigration(child).isFile()) stash(child, childRel)
          }
          return
        }
        if (!toStat) mkdirSync(to, { recursive: true, mode: fromStat.mode & 0o777 })
        for (const name of _readdirMigration(from)) mergeEntry(rel ? `${rel}/${name}` : name)
        return
      }
      if (!fromStat.isFile()) return
      if (!existsSync(to)) {
        _copyFilePreservingMeta(from, to, fromStat)
        return
      }
      const toStat = _statMigration(to)
      if (!toStat.isFile()) {
        stash(from, rel)
        return
      }
      if (toStat.size === fromStat.size && _sha256File(from) === _sha256File(to)) return
      const hiddenWins = preferHidden ? true : preferVisible ? false : fromStat.mtimeMs > toStat.mtimeMs
      if (hiddenWins) {
        stash(to, rel)
        _copyFilePreservingMeta(from, to, fromStat)
      } else {
        stash(from, rel)
      }
    }
    for (const name of _readdirMigration(paths.hiddenDir)) {
      if (name === ROX_HOME_MIGRATION_MANIFEST_NAME) continue
      mergeEntry(name)
    }
    rename(paths.hiddenDir, `${paths.hiddenDir}.migrated-${timestamp}`)
    linkDir(paths.visibleDir, paths.hiddenDir, linkType)
    const result = done('merged', {
      conflicts: conflicts.sort(),
      diagnostics: conflicts.length > 0 ? ['storage.migration.conflictsKept'] : [],
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
  if (hiddenStat?.isSymbolicLink() !== true || !_isSymlinkTo(paths.hiddenDir, paths.visibleDir)) {
    return { ...base, outcome: 'noop', diagnostics: ['storage.migration.revertNoSymlink'] }
  }
  const flagActive =
    options?.flagActive ?? (visibleRootEnvOverride(env) ?? readPersistedVisibleRootFlag(paths.homeDir))
  if (flagActive) {
    return { ...base, outcome: 'revert-refused', diagnostics: ['storage.migration.revertRefusedFlagActive'] }
  }
  let conflictEntries: string[] = []
  try {
    conflictEntries = _readdirMigration(join(paths.visibleDir, ROX_HOME_MIGRATION_DIR_NAME, 'conflicts'))
  } catch {
    conflictEntries = []
  }
  if (conflictEntries.length > 0) {
    return {
      ...base,
      outcome: 'revert-refused',
      conflicts: conflictEntries.sort(),
      diagnostics: ['storage.migration.revertRefusedConflicts'],
    }
  }
  const holders = options?.isLocked ? options.isLocked(paths.visibleDir) : _liveHomeLockHolders(paths.visibleDir, options)
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
