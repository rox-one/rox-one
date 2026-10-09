/**
 * Runtime capability probe (port row e1.2).
 *
 * Re-expresses the installer's `node_binary_is_supported` /
 * `node_binary_has_safe_sqlite` contract (`scripts/install.sh:1557-1597`,
 * `scripts/install-policy.sh:48-93`) for an Electron/Bun host that never runs a
 * `curl | bash` installer:
 *
 *  - a **version-floor** check against the WAL-reset-safe SQLite range
 *    (`3.51.3+`, `3.50.7+` within `3.50.x`, `3.44.6+` within `3.44.x`, else
 *    `> 3.51.x`);
 *  - a **real WAL write** round-trip in a scratch directory, because the floor
 *    alone does not prove the bundled SQLite has a working WAL/copy path;
 *  - the embedded-NUL TEXT/BLOB round-trip guard (nodejs/node#61954).
 *
 * The probe reports the exact runtime/SQLite versions it observed. When it
 * fails it returns a typed downgrade pointing at the user-space runtime
 * fallback under `<state>/tools/` (`scripts/install.sh:2089-2111`) and how that
 * binary is located and used. No writes happen outside `<state>`.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'

export interface RuntimeVersionSummary {
  /** Active runtime family. */
  runtime: 'bun' | 'node' | 'unknown'
  /** Version of the active runtime (`process.versions.bun` or `.node`). */
  runtimeVersion: string
  /** `process.versions.node` when present (Bun also reports a Node compat version). */
  nodeVersion: string | null
  platform: string
  /** `SELECT sqlite_version()`, or null when the runtime exposes no SQLite. */
  sqliteVersion: string | null
}

export type CapabilityCheckId = 'sqlite-version-floor' | 'sqlite-wal-write' | 'sqlite-nul-roundtrip'

export interface CapabilityCheckResult {
  id: CapabilityCheckId
  ok: boolean
  detail: string
}

/** The user-space runtime provisioned under `<state>/tools/` when the host fails. */
export interface UserSpaceRuntimeFallback {
  /** `<state>/tools` — user-space tools root. */
  toolsDir: string
  /** `<state>/tools/runtime` — where a downloaded Bun/Node distribution is unpacked. */
  runtimeDir: string
  /** `<state>/tools/runtime/bin/<binary>` — the executable to invoke. */
  binaryPath: string
  /** How the fallback is located and used. */
  description: string
}

/** Typed downgrade returned when at least one capability check fails. */
export interface RuntimeDowngrade {
  reason: 'runtime-capability-unsupported'
  failedChecks: readonly CapabilityCheckId[]
  fallback: UserSpaceRuntimeFallback
}

export interface RuntimeCapabilityReport {
  ok: boolean
  versions: RuntimeVersionSummary
  checks: readonly CapabilityCheckResult[]
  /** Present only when `ok` is false. */
  downgrade: RuntimeDowngrade | null
}

/** Minimal synchronous SQLite surface the probe needs (matches `DatabaseSync`). */
export interface ProbeDatabase {
  exec(sql: string): void
  prepare(sql: string): {
    get(...bindings: unknown[]): Record<string, unknown> | undefined
    run(...bindings: unknown[]): unknown
  }
  close(): void
}

export interface CapabilityProbeOptions {
  /** ROX state dir; the scratch dir and the fallback path live under it. */
  configDir: string
  /** Scratch root for the WAL write test; defaults to `<configDir>/tmp`. */
  scratchDir?: string
  /** Injectable for the simulated-failure path; defaults to the real driver. */
  openDatabase?: (path: string) => ProbeDatabase
  /** Injectable version source; defaults to `process.versions` + a live query. */
  readVersions?: (openDatabase: (path: string) => ProbeDatabase) => RuntimeVersionSummary
}

/**
 * WAL-reset-safe SQLite floor, mirroring `scripts/install-policy.sh:48-93`.
 * The embedded-NUL fix landed alongside this range in Node 24.16/26.1.
 */
export function isWalResetSafeSqliteVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  return (
    major > 3 ||
    (major === 3 &&
      (minor > 51 ||
        (minor === 51 && patch >= 3) ||
        (minor === 50 && patch >= 7) ||
        (minor === 44 && patch >= 6)))
  )
}

/** Locates the user-space runtime fallback under `<state>/tools/`. */
export function resolveUserSpaceRuntimeFallback(configDir: string, platform: string = process.platform): UserSpaceRuntimeFallback {
  const toolsDir = join(configDir, 'tools')
  const runtimeDir = join(toolsDir, 'runtime')
  const binDir = join(runtimeDir, 'bin')
  const binaryName = platform === 'win32' ? 'bun.exe' : 'bun'
  const binaryPath = join(binDir, binaryName)
  return {
    toolsDir,
    runtimeDir,
    binaryPath,
    description:
      `Host runtime failed the capability probe. Provision a user-space runtime under ${toolsDir}: ` +
      `unpack the downloaded runtime distribution into ${runtimeDir}, then invoke ${binaryPath} ` +
      `directly (a "process.execPath") or prepend ${binDir} to PATH for child processes. ` +
      `Re-run the probe against that binary before starting the workspace.`,
  }
}

function defaultOpenDatabase(path: string): ProbeDatabase {
  return new DatabaseSync(path) as unknown as ProbeDatabase
}

function readRuntimeVersions(openDatabase: (path: string) => ProbeDatabase): RuntimeVersionSummary {
  const bunVersion = process.versions.bun
  const isBun = typeof bunVersion === 'string' && bunVersion.length > 0
  let sqliteVersion: string | null = null
  try {
    const db = openDatabase(':memory:')
    try {
      const row = db.prepare('SELECT sqlite_version() AS version').get()
      sqliteVersion = typeof row?.version === 'string' ? row.version : null
    } finally {
      db.close()
    }
  } catch {
    sqliteVersion = null
  }
  return {
    runtime: isBun ? 'bun' : typeof process.versions.node === 'string' ? 'node' : 'unknown',
    runtimeVersion: isBun ? bunVersion! : (process.versions.node ?? 'unknown'),
    nodeVersion: process.versions.node ?? null,
    platform: process.platform,
    sqliteVersion,
  }
}

function checkVersionFloor(sqliteVersion: string | null): CapabilityCheckResult {
  if (!sqliteVersion) {
    return { id: 'sqlite-version-floor', ok: false, detail: 'SQLite version unavailable from the active runtime' }
  }
  const ok = isWalResetSafeSqliteVersion(sqliteVersion)
  return {
    id: 'sqlite-version-floor',
    ok,
    detail: ok
      ? `SQLite ${sqliteVersion} meets the WAL-reset-safe floor`
      : `SQLite ${sqliteVersion} is below the WAL-reset-safe floor (need 3.51.3+, 3.50.7+, or 3.44.6+)`,
  }
}

/** Real WAL write: journal_mode=WAL, insert + read back, checkpoint, all under `<state>`. */
function checkWalWrite(openDatabase: (path: string) => ProbeDatabase, scratchDir: string): CapabilityCheckResult {
  const id: CapabilityCheckId = 'sqlite-wal-write'
  let dir: string | null = null
  let db: ProbeDatabase | null = null
  try {
    mkdirSync(scratchDir, { recursive: true })
    dir = mkdtempSync(join(scratchDir, 'capability-probe-'))
    db = openDatabase(join(dir, 'probe.db'))
    const modeRow = db.prepare('PRAGMA journal_mode = WAL').get()
    const journalMode = typeof modeRow?.journal_mode === 'string' ? modeRow.journal_mode : null
    db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    db.prepare('INSERT INTO probe (value) VALUES (?)').run('wal-write')
    const row = db.prepare('SELECT value FROM probe WHERE id = 1').get()
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    if (journalMode !== 'wal') {
      return { id, ok: false, detail: `journal_mode is ${journalMode ?? 'unavailable'}, expected wal` }
    }
    if (row?.value !== 'wal-write') {
      return { id, ok: false, detail: `WAL write round-trip lost data (read ${JSON.stringify(row?.value)})` }
    }
    return { id, ok: true, detail: 'WAL write round-trip succeeded with journal_mode=wal' }
  } catch (error) {
    return { id, ok: false, detail: `WAL write test threw: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    try {
      db?.close()
    } catch {
      /* best-effort close before cleanup */
    }
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

/** Embedded-NUL TEXT/BLOB/JSON round-trip guard (nodejs/node#61954). */
function checkNulRoundtrip(openDatabase: (path: string) => ProbeDatabase): CapabilityCheckResult {
  const id: CapabilityCheckId = 'sqlite-nul-roundtrip'
  let db: ProbeDatabase | null = null
  try {
    db = openDatabase(':memory:')
    const text = 'a\u0000b\u0000'
    const bytes = new TextEncoder().encode(text)
    const json = JSON.stringify({ value: text })
    db.exec('CREATE TABLE probe (text_value TEXT, blob_value BLOB, json_value TEXT)')
    db.prepare('INSERT INTO probe VALUES (?, ?, ?)').run(text, bytes, json)
    const row = db.prepare('SELECT text_value, blob_value, json_value FROM probe').get()
    const textValue = row?.text_value
    const blobValue = row?.blob_value
    const jsonValue = row?.json_value
    const textSafe = typeof textValue === 'string' && new TextEncoder().encode(textValue).length === bytes.length
    const blobSafe = blobValue instanceof Uint8Array && blobValue.length === bytes.length
    const jsonSafe = jsonValue === json
    if (textSafe && blobSafe && jsonSafe) {
      return { id, ok: true, detail: 'embedded-NUL TEXT/BLOB/JSON round-trip preserved' }
    }
    return {
      id,
      ok: false,
      detail: `embedded-NUL round-trip failed (text=${textSafe} blob=${blobSafe} json=${jsonSafe})`,
    }
  } catch (error) {
    return { id, ok: false, detail: `embedded-NUL probe threw: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    try {
      db?.close()
    } catch {
      /* best-effort close */
    }
  }
}

/**
 * Probe the active runtime. Runs the real WAL write under `<state>/tmp` plus the
 * version floor and NUL round-trip; returns a typed report and, on failure, the
 * typed downgrade with the user-space fallback location.
 */
export function probeRuntimeCapabilities(options: CapabilityProbeOptions): RuntimeCapabilityReport {
  const scratchDir = options.scratchDir ?? join(options.configDir, 'tmp')
  const openDatabase = options.openDatabase ?? defaultOpenDatabase
  const versions = (options.readVersions ?? readRuntimeVersions)(openDatabase)
  const checks: CapabilityCheckResult[] = [
    checkVersionFloor(versions.sqliteVersion),
    checkWalWrite(openDatabase, scratchDir),
    checkNulRoundtrip(openDatabase),
  ]
  const failedChecks = checks.filter(check => !check.ok).map(check => check.id)
  const ok = failedChecks.length === 0
  return {
    ok,
    versions,
    checks,
    downgrade: ok
      ? null
      : {
          reason: 'runtime-capability-unsupported',
          failedChecks,
          fallback: resolveUserSpaceRuntimeFallback(options.configDir, versions.platform),
        },
  }
}