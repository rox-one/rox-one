/**
 * Path resolution for the Browser Intelligence Pipeline.
 *
 * Everything the pipeline writes lives under the ROX config dir, so
 * `ROX_CONFIG_DIR` isolation (tests, portable installs, the visible-home flag)
 * applies unchanged:
 *
 *   <config>/intelligence/intelligence.db     central database
 *   <config>/cache/browser_staging/<id>/      shadow-copy sandbox per profile
 *   <config>/browser-intel.json               opt-in + last run receipt
 *
 * `resolveConfigDir()` is called per invocation rather than through the
 * import-time `CONFIG_DIR` snapshot, so a caller that sets `ROX_CONFIG_DIR`
 * after module load still gets the right tree.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { resolveConfigDir } from '@rox/shared/config'

export const INTELLIGENCE_DIR_NAME = 'intelligence'
export const INTELLIGENCE_DB_BASENAME = 'intelligence.db'
export const CACHE_DIR_NAME = 'cache'
export const BROWSER_STAGING_DIR_NAME = 'browser_staging'
export const BROWSER_INTEL_STATE_BASENAME = 'browser-intel.json'

export interface BrowserIntelPaths {
  configDir: string
  intelligenceDir: string
  dbPath: string
  cacheDir: string
  stagingDir: string
  statePath: string
}

/**
 * Resolve the pipeline's filesystem layout.
 *
 * @param configDir explicit override; defaults to the live ROX config dir.
 */
export function resolveBrowserIntelPaths(configDir: string = resolveConfigDir()): BrowserIntelPaths {
  const intelligenceDir = join(configDir, INTELLIGENCE_DIR_NAME)
  const cacheDir = join(configDir, CACHE_DIR_NAME)
  return {
    configDir,
    intelligenceDir,
    dbPath: join(intelligenceDir, INTELLIGENCE_DB_BASENAME),
    cacheDir,
    stagingDir: join(cacheDir, BROWSER_STAGING_DIR_NAME),
    statePath: join(configDir, BROWSER_INTEL_STATE_BASENAME),
  }
}

/**
 * Filesystem-safe, deterministic directory name for a profile id.
 *
 * Profile ids embed an absolute path (`chromium:/Users/me/…`), which is neither
 * portable nor legal as a single path segment on Windows. The slug keeps the
 * vendor readable for humans debugging the sandbox and adds a stable digest so
 * two profiles with the same vendor never collide.
 */
export function stagingDirNameForProfile(profileId: string): string {
  const [family, ...rest] = profileId.split(':')
  const slug = (family ?? 'profile').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 24) || 'profile'
  const digest = createHash('sha256').update(profileId).digest('hex').slice(0, 16)
  return `${slug}-${digest}`
}

/** Absolute staging directory for one profile. */
export function stagingDirForProfile(paths: BrowserIntelPaths, profileId: string): string {
  return join(paths.stagingDir, stagingDirNameForProfile(profileId))
}