/**
 * Central intelligence database bootstrap.
 *
 * WAL + `synchronous=NORMAL` are applied before the schema so a concurrent
 * reader (the renderer's stats poll, a running unfurl worker) never sees the
 * writer's partial state and no reader ever receives `SQLITE_BUSY` for a
 * checkpoint that is merely slow.
 *
 * The DDL lives in `schema.sql` next to this module. Packaging copies that file
 * into `dist/resources/browser-intel/`, so the loader searches the module
 * directory first (source checkout, tests, bun) and then the packaged asset
 * roots. A missing schema is a hard error: failing loudly beats creating half a
 * database.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'

/** Bumped whenever `schema.sql` changes shape; recorded in `PRAGMA user_version`. */
export const SCHEMA_VERSION = 1

export const INTELLIGENCE_SCHEMA_BASENAME = 'schema.sql'

export interface OpenIntelligenceDatabaseOptions {
  /** Open without creating; the file must already exist. */
  readOnly?: boolean
  /** Explicit DDL location (tests). Otherwise the candidate search runs. */
  schemaPath?: string
  /** Extra directories to search before the packaged roots. */
  schemaDirs?: string[]
  /** Skip DDL application (read-only consumers, fixtures built by hand). */
  skipSchema?: boolean
}

/**
 * Module directory under both module systems.
 *
 * esbuild's production CJS bundle has `__filename` but an empty `import.meta`;
 * bun and plain ESM have the reverse. Mirrors the guard in
 * `@rox/shared/utils/sqlite-runtime`.
 */
function moduleDirectory(): string {
  if (typeof __filename === 'string') return dirname(__filename)
  return dirname(fileURLToPath(import.meta.url))
}

/** Ordered candidate paths for the DDL file. Exported for diagnostics. */
export function intelligenceSchemaCandidates(options: OpenIntelligenceDatabaseOptions = {}): string[] {
  if (options.schemaPath) return [options.schemaPath]
  const candidates: string[] = []
  const fromEnv = process.env.ROX_BROWSER_INTEL_SCHEMA
  if (fromEnv) candidates.push(fromEnv)
  for (const dir of options.schemaDirs ?? []) {
    candidates.push(join(dir, INTELLIGENCE_SCHEMA_BASENAME))
  }
  candidates.push(join(moduleDirectory(), INTELLIGENCE_SCHEMA_BASENAME))
  // `scripts/copy-assets.ts` ships the DDL to dist/resources/browser-intel/, so
  // the bundle (dev: apps/electron/dist, packaged: <app>/dist) finds it beside
  // the compiled main process rather than in the package source tree.
  candidates.push(join(moduleDirectory(), 'resources', 'browser-intel', INTELLIGENCE_SCHEMA_BASENAME))
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE
  if (resourcesBase) candidates.push(join(resourcesBase, 'resources', 'browser-intel', INTELLIGENCE_SCHEMA_BASENAME))
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    candidates.push(join(resourcesPath, 'app', 'resources', 'browser-intel', INTELLIGENCE_SCHEMA_BASENAME))
    candidates.push(join(resourcesPath, 'resources', 'browser-intel', INTELLIGENCE_SCHEMA_BASENAME))
  }
  const appRoot = process.env.CRAFT_APP_ROOT
  if (appRoot) {
    candidates.push(join(appRoot, 'resources', 'browser-intel', INTELLIGENCE_SCHEMA_BASENAME))
    candidates.push(join(appRoot, 'packages', 'browser-intel', 'src', 'db', INTELLIGENCE_SCHEMA_BASENAME))
  }
  return candidates
}

/** Read the DDL, or throw with every candidate that was tried. */
export function loadIntelligenceSchemaSql(options: OpenIntelligenceDatabaseOptions = {}): string {
  const candidates = intelligenceSchemaCandidates(options)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8')
  }
  throw new Error(
    `browser-intel schema not found. Tried:\n${candidates.map((path) => `  - ${path}`).join('\n')}\n` +
      'Set ROX_BROWSER_INTEL_SCHEMA or ship resources/browser-intel/schema.sql with the app.',
  )
}

/** Apply the durability pragmas. Safe to call repeatedly. */
export function applyIntelligencePragmas(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
}

/** Create the schema when absent and record the schema version. */
export function applyIntelligenceSchema(db: DatabaseSync, options: OpenIntelligenceDatabaseOptions = {}): void {
  db.exec(loadIntelligenceSchemaSql(options))
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
}

export function readIntelligenceSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number | bigint } | undefined
  const value = row?.user_version ?? 0
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
}

/**
 * Open (creating when needed) the central intelligence database.
 *
 * The parent directory is created for writable opens; read-only opens require
 * an existing file so a typo cannot silently produce an empty database.
 */
export function openIntelligenceDatabase(
  dbPath: string,
  options: OpenIntelligenceDatabaseOptions = {},
): DatabaseSync {
  if (options.readOnly === true && !existsSync(dbPath)) {
    throw new Error(`Intelligence database does not exist: ${dbPath}`)
  }
  if (options.readOnly !== true) {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
  const db = new DatabaseSync(dbPath, options.readOnly === true ? { readOnly: true } : {})
  if (options.readOnly === true) {
    // WAL readers still need the pragma to observe committed frames.
    db.exec('PRAGMA busy_timeout = 5000;')
    return db
  }
  applyIntelligencePragmas(db)
  if (options.skipSchema !== true) applyIntelligenceSchema(db, options)
  return db
}