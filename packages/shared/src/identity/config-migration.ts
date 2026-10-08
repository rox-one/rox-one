/**
 * Craft-era → Rox config-directory migration with rollback (Issue 33).
 *
 * Copy-only: the original ~/.craft-agent tree is never deleted. Rollback
 * removes the Rox destination that this process created. Explicit env
 * overrides (ROX_CONFIG_DIR / CRAFT_CONFIG_DIR) skip auto-migration.
 */

import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync, readdirSync, lstatSync, copyFileSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  ROX_BRAND_MIGRATION_VERSION,
  ROX_CONFIG_DIR_NAME,
  ROX_LEGACY_CONFIG_DIR_NAME,
  ROX_VISIBLE_CONFIG_DIR_NAME,
} from './manifest.ts'

export const ROX_MIGRATION_STAMP_NAME = '.rox-brand-migration.json'

/** Stamp recorded in the visible `~/rox` base after the copy-only import (C3). */
export const ROX_VISIBLE_MIGRATION_STAMP_NAME = '.rox-visible-base-migration.json'

export type VisibleMigrationOutcome =
  | 'skipped-env-override'
  | 'already-migrated'
  | 'noop'
  | 'migrated'
  | 'failed'

export interface VisibleMigrationStamp {
  version: number
  source: string
  destination: string
  migratedAt: string
  originalPreserved: true
  /** `config.json` rootPath references rewritten from the hidden base. */
  registryRewrites?: number
  /** Backup of `config.json` taken before rewriting, when rewrites occurred. */
  registryBackup?: string
}

export interface VisibleMigrationResult {
  outcome: VisibleMigrationOutcome
  sourceDir: string
  destinationDir: string
  /** Files copied because they were absent from the destination. */
  copied: number
  /** Registry rootPath references rewritten to the visible base. */
  registryRewrites: number
  diagnostics: string[]
}

export function visibleStampPath(visibleDir: string): string {
  return join(visibleDir, ROX_VISIBLE_MIGRATION_STAMP_NAME)
}

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
 * Copy missing entries from `source` into `destination`, never overwriting an
 * existing file and never deleting anything. Returns the number copied.
 */
function copyMissingTree(source: string, destination: string): number {
  let copied = 0
  if (!existsSync(destination)) mkdirSync(destination, { recursive: true })
  for (const name of readdirSync(source)) {
    const src = join(source, name)
    const dst = join(destination, name)
    const stat = lstatSync(src)
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      copied += copyMissingTree(src, dst)
    } else if (!existsSync(dst)) {
      if (stat.isSymbolicLink()) cpSync(src, dst, { dereference: false, errorOnExist: true, force: false })
      else copyFileSync(src, dst, constants.COPYFILE_EXCL)
      copied++
    }
  }
  return copied
}

/**
 * Rewrite unambiguous `~/.rox/workspaces/<slug>` registry references to the
 * visible `~/rox/workspaces/<slug>` counterpart, but only when that counterpart
 * exists. Backs the registry up first. Best-effort: never throws.
 */
function reconcileVisibleWorkspaceRegistry(
  destinationDir: string,
  homeDir: string,
  now: string,
): { rewrites: number; backup?: string } {
  const configPath = join(destinationDir, 'config.json')
  if (!existsSync(configPath)) return { rewrites: 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return { rewrites: 0 }
  }
  if (typeof parsed !== 'object' || parsed === null) return { rewrites: 0 }
  if (!('workspaces' in parsed)) return { rewrites: 0 }
  const workspaces = parsed.workspaces
  if (!Array.isArray(workspaces)) return { rewrites: 0 }

  const homeNormalized = homeDir.replace(/\\/g, '/').replace(/\/$/, '')
  const hiddenPrefixes = [
    `~/${ROX_CONFIG_DIR_NAME}/workspaces/`,
    `${homeNormalized}/${ROX_CONFIG_DIR_NAME}/workspaces/`,
  ]
  const visiblePrefixes = [
    `~/${ROX_VISIBLE_CONFIG_DIR_NAME}/workspaces/`,
    `${homeNormalized}/${ROX_VISIBLE_CONFIG_DIR_NAME}/workspaces/`,
  ]

  let rewrites = 0
  for (const workspace of workspaces) {
    if (typeof workspace !== 'object' || workspace === null) continue
    if (!('rootPath' in workspace)) continue
    const rootPath = workspace.rootPath
    if (typeof rootPath !== 'string') continue
    const normalized = rootPath.replace(/\\/g, '/')
    for (let i = 0; i < hiddenPrefixes.length; i++) {
      const prefix = hiddenPrefixes[i]!
      if (!normalized.startsWith(prefix)) continue
      const suffix = normalized.slice(prefix.length)
      if (!existsSync(join(homeDir, ROX_VISIBLE_CONFIG_DIR_NAME, 'workspaces', suffix))) break
      workspace.rootPath = visiblePrefixes[i]! + suffix
      rewrites++
      break
    }
  }

  if (rewrites === 0) return { rewrites: 0 }
  const backup = `${configPath}.bak-${now.replace(/[:.]/g, '-')}`
  copyFileSync(configPath, backup, constants.COPYFILE_EXCL)
  writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  return { rewrites, backup }
}

/**
 * Copy ~/.rox → ~/rox once so the visible product base exists (C3).
 *
 * Copy-only: files already present under ~/rox are never overwritten and the
 * ~/.rox source tree is left untouched. A stamp is written inside ~/rox after
 * the first pass, making repeated calls no-ops. Skipped entirely when
 * ROX_CONFIG_DIR / CRAFT_CONFIG_DIR selects an explicit root. Best-effort:
 * filesystem errors never throw.
 */
export function runVisibleConfigMigration(options?: {
  homeDir?: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  now?: string
}): VisibleMigrationResult {
  const env = options?.env ?? process.env
  const homeDir = options?.homeDir ?? homedir()
  const sourceDir = join(homeDir, ROX_CONFIG_DIR_NAME)
  const destinationDir = join(homeDir, ROX_VISIBLE_CONFIG_DIR_NAME)
  const diagnostics: string[] = []

  if (hasEnvOverride(env)) {
    diagnostics.push('visible.migration.skipped')
    return { outcome: 'skipped-env-override', sourceDir, destinationDir, copied: 0, registryRewrites: 0, diagnostics }
  }

  try {
    if (!existsSync(sourceDir)) {
      return { outcome: 'noop', sourceDir, destinationDir, copied: 0, registryRewrites: 0, diagnostics }
    }
    if (existsSync(visibleStampPath(destinationDir))) {
      return { outcome: 'already-migrated', sourceDir, destinationDir, copied: 0, registryRewrites: 0, diagnostics }
    }
    // Only reconcile a registry this pass created; a pre-existing destination
    // config.json belongs to the user and is never rewritten here.
    const destinationHadConfig = existsSync(join(destinationDir, 'config.json'))
    const copied = copyMissingTree(sourceDir, destinationDir)
    const now = options?.now ?? new Date().toISOString()
    const stamp: VisibleMigrationStamp = {
      version: ROX_BRAND_MIGRATION_VERSION,
      source: sourceDir,
      destination: destinationDir,
      migratedAt: now,
      originalPreserved: true,
    }
    let registryRewrites = 0
    if (!destinationHadConfig) {
      const reconciled = reconcileVisibleWorkspaceRegistry(destinationDir, homeDir, now)
      registryRewrites = reconciled.rewrites
      if (reconciled.rewrites > 0) {
        stamp.registryRewrites = reconciled.rewrites
        if (reconciled.backup) stamp.registryBackup = reconciled.backup
        diagnostics.push('visible.migration.registryRewritten')
      }
    }
    mkdirSync(destinationDir, { recursive: true })
    writeFileSync(visibleStampPath(destinationDir), `${JSON.stringify(stamp, null, 2)}\n`, 'utf8')
    diagnostics.push('visible.migration.completed')
    return { outcome: 'migrated', sourceDir, destinationDir, copied, registryRewrites, diagnostics }
  } catch {
    diagnostics.push('visible.migration.failed')
    return { outcome: 'failed', sourceDir, destinationDir, copied: 0, registryRewrites: 0, diagnostics }
  }
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
