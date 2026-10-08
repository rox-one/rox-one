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
// - Never deletes. The hidden tree is moved/renamed, never removed; on
//   Windows / cross-device the original is kept as `.rox.migrated-<ts>`.
// - `~/.rox` is left as a symlink (Windows: directory junction) to `~/rox`.
// - Locked files (server-core / storage writers) defer the migration.
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
  writeFileSync as _writeMigrationFile,
} from 'node:fs'
import { dirname as _dirnameMigration, relative as _relativeMigration, sep as _pathSep } from 'node:path'

/** Name of the visible Rox home inside a home directory. */
export const ROX_VISIBLE_HOME_DIR_NAME = ROX_HOME_DIR_NAME
/** Name left behind as a compatibility symlink. */
export const ROX_HIDDEN_HOME_LINK_NAME = ROX_COMPAT_SYMLINK_NAME

/**
 * Persisted workbench-flag file inside a candidate config dir.
 * Shape: `{ "enabled": ["storage.visible-root.v1", ...] }`.
 * Written by Settings → Storage (or tests); read before the config dir is
 * resolved, from whichever candidate dir (`~/rox`, then `~/.rox`) exists.
 */
export const ROX_WORKBENCH_FLAGS_FILE_NAME = 'workbench-flags.json'

/**
 * Best-effort read of the persisted `storage.visible-root.v1` flag.
 * Malformed JSON or missing files read as OFF — never throws.
 */
export function readPersistedVisibleRootFlag(homeDir: string = homedir()): boolean {
  for (const name of [ROX_VISIBLE_HOME_DIR_NAME, ROX_HIDDEN_HOME_LINK_NAME]) {
    const file = join(homeDir, name, ROX_WORKBENCH_FLAGS_FILE_NAME)
    try {
      if (!existsSync(file)) continue
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      const enabled =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as { enabled?: unknown }).enabled
          : undefined
      if (Array.isArray(enabled) && enabled.includes('storage.visible-root.v1')) {
        return true
      }
    } catch {
      continue
    }
  }
  return false
}

/** Manifest file written into the hidden tree before it moves. */
export const ROX_HOME_MIGRATION_MANIFEST_NAME = '.migration-manifest.json'
/** Directory (under `~/rox`) for reports, conflicts and the audit trail. */
export const ROX_HOME_MIGRATION_DIR_NAME = '.migration'

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

export interface VisibleHomeManifestEntry {
  /** POSIX-style path relative to the migrated root. */
  path: string
  kind: 'file' | 'symlink' | 'dir'
  size?: number
  sha256?: string
  /** Permission bits (`stat.mode & 0o777`). */
  mode?: number
  /** Symlink target (for `kind: 'symlink'`). */
  link?: string
  mtimeMs?: number
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
   * the known server-core / storage lock files inside the hidden tree.
   */
  isLocked?: (hiddenDir: string) => string[]
  /** Skip the process lock file (tests running migrations concurrently). */
  skipProcessLock?: boolean
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

function _defaultHiddenLockHolders(hiddenDir: string): string[] {
  const holders: string[] = []
  for (const name of ['config.json.lock', '.server.lock']) {
    try {
      if (existsSync(join(hiddenDir, name))) holders.push(name)
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
 * Walk `root` and record every entry (files with size + sha256 + mode).
 * `.migration/` output and the migration manifest itself are excluded so the
 * manifest is stable across the move (equality property test).
 */
export function buildVisibleHomeManifest(root: string): VisibleHomeManifestEntry[] {
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
          sha256: _sha256File(full),
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

/** Manifest equality: same set of files with identical checksums. */
export function visibleHomeManifestsEqual(
  before: readonly VisibleHomeManifestEntry[],
  after: readonly VisibleHomeManifestEntry[],
): boolean {
  const key = (entry: VisibleHomeManifestEntry): string =>
    `${entry.kind}:${entry.path}:${entry.size ?? ''}:${entry.sha256 ?? ''}:${entry.link ?? ''}`
  if (before.length !== after.length) return false
  return before.every((entry, index) => key(entry) === key(after[index]))
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

function _copyTreeWithModes(source: string, destination: string): void {
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
  if (st.isDirectory() && !st.isSymbolicLink()) {
    mkdirSync(destination, { recursive: true, mode: st.mode & 0o777 })
    for (const name of _readdirMigration(source)) {
      _copyTreeWithModes(join(source, name), join(destination, name))
    }
    return
  }
  if (st.isFile()) {
    mkdirSync(_dirnameMigration(destination), { recursive: true })
    _copyMigrationFile(source, destination)
    try {
      _chmodMigration(destination, st.mode & 0o777)
    } catch {
      // best effort
    }
  }
}

function _verifyTreeAgainstManifest(root: string, manifest: readonly VisibleHomeManifestEntry[]): string[] {
  const mismatches: string[] = []
  for (const entry of manifest) {
    if (entry.kind !== 'file') continue
    const full = join(root, entry.path)
    try {
      const st = _statMigration(full)
      if (!st.isFile() || st.size !== entry.size || _sha256File(full) !== entry.sha256) {
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
): string | undefined {
  try {
    const dir = join(visibleDir, ROX_HOME_MIGRATION_DIR_NAME)
    mkdirSync(dir, { recursive: true })
    const reportPath = join(dir, `report-${timestamp}.json`)
    _writeMigrationFile(
      reportPath,
      `${JSON.stringify(
        {
          outcome: result.outcome,
          visibleDir: result.visibleDir,
          hiddenDir: result.hiddenDir,
          migratedAt: new Date().toISOString(),
          files: result.manifest.length,
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

function _acquireProcessLock(): (() => void) | { deferred: string } {
  let uid = 'default'
  try {
    uid = String(process.getuid?.() ?? 'default')
  } catch {
    // non-POSIX — single shared lock name
  }
  const lockPath = join(tmpdir(), `rox-migrate-${uid}.lock`)
  try {
    const fd = _openMigrationLock(lockPath, 'wx', 0o600)
    _closeMigrationLock(fd)
    return () => {
      try {
        _unlinkMigration(lockPath)
      } catch {
        // best effort
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') {
      return { deferred: lockPath }
    }
    throw error
  }
}

/**
 * Move `~/.rox` → `~/rox` (MIG-13). Never deletes; leaves `~/.rox` as a
 * symlink (Windows: directory junction) to `~/rox`.
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
  const hiddenIsDir = hiddenStat?.isDirectory() === true && !hiddenIsSymlink
  const visibleExists = existsSync(paths.visibleDir)

  if (hiddenIsSymlink) {
    if (_isSymlinkTo(paths.hiddenDir, paths.visibleDir)) {
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
    return done('already-visible')
  }

  // Only `~/.rox` (real dir), or both real dirs: check live writers first.
  const holders = (options?.isLocked ?? _defaultHiddenLockHolders)(paths.hiddenDir)
  if (holders.length > 0) {
    return done('deferred-locked', {
      diagnostics: ['storage.migration.deferredLocked', ...holders.map((h) => `locked:${h}`)],
    })
  }

  const manifest = buildVisibleHomeManifest(paths.hiddenDir)
  base.manifest = manifest
  if (!dryRun) {
    try {
      _writeMigrationFile(
        join(paths.hiddenDir, ROX_HOME_MIGRATION_MANIFEST_NAME),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      )
    } catch {
      // manifest write is best effort; equality is still verified after copy
    }
  }

  const release = options?.skipProcessLock === true ? () => {} : _acquireProcessLock()
  if (typeof release !== 'function') {
    return done('deferred-locked', {
      diagnostics: ['storage.migration.deferredLocked', `locked:${release.deferred}`],
    })
  }
  try {
    if (!visibleExists) {
      // Only `~/.rox`: atomic rename, EXDEV falls back to copy + verify + swap.
      if (dryRun) return done('migrated', { announceToast: true })
      let moved = false
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
        const mismatches = _verifyTreeAgainstManifest(staging, manifest)
        if (mismatches.length > 0) {
          rmSync(staging, { recursive: true, force: true })
          throw new Error(`Cross-device copy verification failed: ${mismatches.slice(0, 5).join(', ')}`)
        }
        rename(staging, paths.visibleDir)
        // Never delete: keep the original under a timestamped name.
        rename(paths.hiddenDir, `${paths.hiddenDir}.migrated-${timestamp}`)
      }
      linkDir(paths.visibleDir, paths.hiddenDir, linkType)
      const after = buildVisibleHomeManifest(paths.visibleDir)
      const equal = visibleHomeManifestsEqual(manifest, after)
      const result = done('migrated', {
        manifest: after,
        diagnostics: equal ? [] : ['storage.migration.checksumMismatch'],
        announceToast: true,
      })
      result.reportPath = _writeMigrationReport(paths.visibleDir, timestamp, result)
      return result
    }

    // Both real dirs: per-file merge into `~/rox` (newer mtime wins).
    if (dryRun) return done('merged', { announceToast: true })
    const conflicts: string[] = []
    const conflictsRoot = join(paths.visibleDir, ROX_HOME_MIGRATION_DIR_NAME, 'conflicts')
    const mergeEntry = (rel: string): void => {
      const from = join(paths.hiddenDir, rel)
      const to = join(paths.visibleDir, rel)
      const fromStat = _lstatMigration(from)
      if (fromStat.isSymbolicLink()) {
        if (!existsSync(to)) {
          mkdirSync(_dirnameMigration(to), { recursive: true })
          _symlinkMigration(_readlinkMigration(from), to)
        }
        return
      }
      if (fromStat.isDirectory()) {
        mkdirSync(to, { recursive: true, mode: fromStat.mode & 0o777 })
        for (const name of _readdirMigration(from)) mergeEntry(rel ? `${rel}/${name}` : name)
        return
      }
      if (!fromStat.isFile()) return
      if (!existsSync(to)) {
        mkdirSync(_dirnameMigration(to), { recursive: true })
        _copyMigrationFile(from, to)
        return
      }
      const toStat = _statMigration(to)
      if (!toStat.isFile()) {
        const stash = join(conflictsRoot, rel)
        mkdirSync(_dirnameMigration(stash), { recursive: true })
        _copyMigrationFile(from, stash)
        conflicts.push(rel)
        return
      }
      if (_sha256File(from) === _sha256File(to)) return
      const winner = fromStat.mtimeMs > toStat.mtimeMs ? from : to
      const loser = winner === from ? to : from
      const stash = join(conflictsRoot, rel)
      mkdirSync(_dirnameMigration(stash), { recursive: true })
      _copyMigrationFile(loser, stash)
      if (winner === from) _copyMigrationFile(from, to)
      conflicts.push(rel)
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
    result.reportPath = _writeMigrationReport(paths.visibleDir, timestamp, result)
    return result
  } finally {
    release()
  }
}

/**
 * Revert the visible home: remove the `~/.rox` symlink and rename `~/rox`
 * back to `~/.rox`. Refused when `.migration/conflicts` is non-empty.
 */
export function revertVisibleRoxHome(options?: MigrateHiddenRoxHomeOptions): VisibleHomeMigrationResult {
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
  if (!dryRun) {
    _unlinkMigration(paths.hiddenDir)
    rename(paths.visibleDir, paths.hiddenDir)
  }
  return { ...base, outcome: 'reverted' }
}
