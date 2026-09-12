/**
 * Craft-era → Rox config-directory migration with rollback (Issue 33).
 *
 * Copy-only: the original ~/.craft-agent tree is never deleted. Rollback
 * removes the Rox destination that this process created. Explicit env
 * overrides (ROX_CONFIG_DIR / CRAFT_CONFIG_DIR) skip auto-migration.
 */

import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  ROX_BRAND_MIGRATION_VERSION,
  ROX_CONFIG_DIR_NAME,
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
