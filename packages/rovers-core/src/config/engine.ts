/**
 * `@rox/rovers-core` — `<configDir>/rovers/engine.json` (M1-B2).
 *
 * The engine config is the seam that keeps Rox's container engine from touching
 * the user's environment: `cacheRoot` is the single engine-owned directory and
 * every helper cache path (`LIMA_HOME`, `HOME`, `XDG_CACHE_HOME`) lives inside
 * it. `readEngineConfig` fails closed with `no_runtime` on a damaged file —
 * never a partially-applied config — and `writeEngineConfig` is atomic
 * (tmp + `renameSync`, mode `0600`) so a crash cannot leave a torn config.
 *
 * This module imports no `@rox/shared`; the host injects `configDir`.
 */

import { randomUUID } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

import { z } from 'zod'

import { RoversError } from '../errors.ts'
import type { RoversCacheCleanupPolicy, RoversEngineConfig, RoversEnginePaths } from '../types.ts'

/** The engine directory under `<configDir>`; Rox owns everything inside it. */
export const ROVERS_DIRNAME = 'rovers'

/** The engine config filename inside {@link roversDir}. */
export const ENGINE_CONFIG_FILENAME = 'engine.json'

/** The default engine cache retention, in days (the M1-B2 acceptance value). */
export const DEFAULT_ENGINE_CACHE_MAX_AGE_DAYS = 30

const MILLIS_PER_DAY = 86_400_000

/** Russian copy for a damaged/incompatible config (`spec.md` §5.2 step 4). */
const ENGINE_CONFIG_CORRUPT_MESSAGE = 'Файл engine.json повреждён или несовместим.'

/** One registered engine; extra keys are rejected so the file shape cannot drift. */
const engineRecordSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['local', 'cluster', 'remote']),
    runtime: z.enum(['lima', 'detected', 'native']),
    version: z.string().min(1).optional(),
    binaryPath: z.string().min(1).optional(),
  })
  .strict()

/** The v1 `engine.json` schema (`RoversEngineConfig`). */
export const engineConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    cacheRoot: z.string().min(1),
    limaHome: z.string().min(1),
    cleanup: z
      .object({
        maxAgeDays: z.number(),
        onEngineStop: z.boolean(),
      })
      .strict(),
    engines: z.array(engineRecordSchema),
  })
  .strict()

/** The engine directory under a host-provided config dir. */
export function roversDir(configDir: string): string {
  return join(configDir, ROVERS_DIRNAME)
}

/** The absolute path of `<configDir>/rovers/engine.json`. */
export function engineConfigPath(configDir: string): string {
  return join(roversDir(configDir), ENGINE_CONFIG_FILENAME)
}

/** The repair step for a damaged config, naming the exact file to delete. */
function engineConfigRepairAction(configDir: string): string {
  return `Удалите ${engineConfigPath(configDir)}, чтобы Rox пересоздал настройки движка.`
}

/**
 * The M1 defaults: an engine-private cache tree under `<configDir>/rovers/cache`
 * with no registered engines. Cleanup runs only on explicit calls.
 */
export function defaultEngineConfig(configDir: string): RoversEngineConfig {
  const cacheRoot = join(roversDir(configDir), 'cache')
  return {
    schemaVersion: 1,
    cacheRoot,
    limaHome: join(cacheRoot, 'lima'),
    cleanup: {
      maxAgeDays: DEFAULT_ENGINE_CACHE_MAX_AGE_DAYS,
      onEngineStop: false,
    },
    engines: [],
  }
}

/**
 * Derive the absolute engine paths from a config. All four live inside
 * `cacheRoot`, so spawing a helper with these values never reads or writes the
 * user's `HOME` (`packages/rovers-core/src/types.ts`).
 */
export function enginePaths(config: RoversEngineConfig): RoversEnginePaths {
  return {
    cacheRoot: config.cacheRoot,
    limaHome: config.limaHome,
    home: join(config.cacheRoot, 'home'),
    xdgCacheHome: join(config.cacheRoot, 'xdg-cache'),
  }
}

/** A missing `engine.json` is normal (first run) — the defaults apply. */
function isMissingFileError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return error.code === 'ENOENT'
}

/**
 * Read + validate `<configDir>/rovers/engine.json`.
 *
 * A missing file yields {@link defaultEngineConfig}. Unreadable, non-JSON or
 * schema-incompatible files fail closed with `RoversError('no_runtime')` — the
 * caller never sees a partially-applied config.
 */
export function readEngineConfig(configDir: string): RoversEngineConfig {
  const path = engineConfigPath(configDir)

  let body: string
  try {
    body = readFileSync(path, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) return defaultEngineConfig(configDir)
    throw new RoversError('no_runtime', ENGINE_CONFIG_CORRUPT_MESSAGE, {
      repairAction: engineConfigRepairAction(configDir),
      cause: error,
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    throw new RoversError('no_runtime', ENGINE_CONFIG_CORRUPT_MESSAGE, {
      repairAction: engineConfigRepairAction(configDir),
      cause: error,
    })
  }

  const result = engineConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new RoversError('no_runtime', ENGINE_CONFIG_CORRUPT_MESSAGE, {
      repairAction: engineConfigRepairAction(configDir),
      cause: result.error,
    })
  }
  return result.data
}

/**
 * Write the engine config atomically: a `0600` temp file in the same directory
 * is `renameSync`-d into place, so readers see either the old or the new file,
 * never a torn one, and no `.tmp` file survives a successful call.
 */
export function writeEngineConfig(configDir: string, config: RoversEngineConfig): RoversEngineConfig {
  const result = engineConfigSchema.safeParse(config)
  if (!result.success) {
    throw new RoversError('no_runtime', ENGINE_CONFIG_CORRUPT_MESSAGE, {
      repairAction: engineConfigRepairAction(configDir),
      cause: result.error,
    })
  }
  const normalized: RoversEngineConfig = result.data

  const dir = roversDir(configDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const target = engineConfigPath(configDir)
  const tmp = join(dir, `${ENGINE_CONFIG_FILENAME}.${randomUUID()}.tmp`)
  try {
    writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, target)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // The temp file was never created or already moved — nothing to clean up.
    }
    throw error
  }
  return normalized
}

/** Create every engine-owned directory (`cacheRoot`, `limaHome`, `home`, `xdg-cache`). */
export function ensureEngineDirs(config: RoversEngineConfig): RoversEnginePaths {
  const paths = enginePaths(config)
  for (const dir of [paths.cacheRoot, paths.limaHome, paths.home, paths.xdgCacheHome]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  return paths
}

/** Options for {@link cleanupEngineCache}; `now`/`keep` exist for deterministic tests. */
export interface RoversEngineCleanupOptions {
  /** Reference time in epoch ms; defaults to `Date.now()`. */
  now?: number
  /** Absolute paths that are never evicted (e.g. the active instance's path). */
  keep?: readonly string[]
}

/** What a cleanup pass removed. */
export interface RoversEngineCleanupResult {
  /** Absolute paths that were deleted (unsorted `readdir` order). */
  removed: string[]
  /** Total bytes reclaimed (recursive `stat` sizes of the removed entries). */
  bytesFreed: number
}

/** Recursive byte size; unreadable entries count as `0` rather than failing. */
function measureBytes(target: string): number {
  let stats
  try {
    stats = lstatSync(target)
  } catch {
    return 0
  }
  if (stats.isDirectory()) {
    let children: string[]
    try {
      children = readdirSync(target)
    } catch {
      return 0
    }
    let total = 0
    for (const child of children) total += measureBytes(join(target, child))
    return total
  }
  return stats.isFile() ? stats.size : 0
}

/**
 * Evict engine cache entries older than `policy.maxAgeDays`.
 *
 * `maxAgeDays <= 0` is a no-op (age eviction disabled). Entries with an
 * `mtimeMs` strictly older than the cutoff are removed; `cacheRoot` itself and
 * every path in `options.keep` are never touched, and an unreadable entry is
 * skipped instead of aborting the pass.
 */
export function cleanupEngineCache(
  paths: RoversEnginePaths,
  policy: RoversCacheCleanupPolicy,
  options: RoversEngineCleanupOptions = {},
): RoversEngineCleanupResult {
  const result: RoversEngineCleanupResult = { removed: [], bytesFreed: 0 }
  if (!(policy.maxAgeDays > 0)) return result

  const cacheRoot = resolve(paths.cacheRoot)
  const cutoff = (options.now ?? Date.now()) - policy.maxAgeDays * MILLIS_PER_DAY
  const keep = new Set((options.keep ?? []).map((entry) => resolve(entry)))

  let entries: string[]
  try {
    entries = readdirSync(cacheRoot)
  } catch {
    // The cache root does not exist yet — nothing to evict.
    return result
  }

  for (const entry of entries) {
    const entryPath = resolve(cacheRoot, entry)
    if (entryPath === cacheRoot || keep.has(entryPath)) continue

    let stats
    try {
      stats = lstatSync(entryPath)
    } catch {
      continue
    }
    if (stats.mtimeMs >= cutoff) continue

    const size = measureBytes(entryPath)
    try {
      rmSync(entryPath, { recursive: true, force: true })
    } catch {
      continue
    }
    result.removed.push(entryPath)
    result.bytesFreed += size
  }

  return result
}
