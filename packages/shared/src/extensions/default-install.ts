/**
 * Default-install the shipped marketplace catalog (P35-06).
 *
 * Seeds lock rows so Installed lists the bundled ~17 entries without a
 * first-run git clone. Tools stay deferred + disabled (high-risk).
 * Does not prefetch catalog bytes — load-time is unchanged.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { MarketplaceCatalog, MarketplaceEntry } from '../marketplace/catalog.ts'
import { marketplacePaths } from '../marketplace/catalog.ts'
import { readLock, upsertLockRecord, type MarketplaceLockRecord } from '../marketplace/lock.ts'
import type { ExtensionStateFile } from './types.ts'

export const DEFAULT_MARKETPLACE_SEED_VERSION = 1 as const

export interface DefaultMarketplaceSeedFile {
  version: typeof DEFAULT_MARKETPLACE_SEED_VERSION
  ids: string[]
}

export interface ExtensionEnableStore {
  getState(): ExtensionStateFile
  setEnabled(id: string, enabled: boolean): ExtensionStateFile
}

export interface SeedDefaultMarketplaceInstallsOptions {
  catalog: MarketplaceCatalog
  configDir: string
  stateStore: ExtensionEnableStore
  now?: number
}

export interface SeedDefaultMarketplaceInstallsResult {
  seeded: string[]
  skipped: string[]
  disabled: string[]
}

export function defaultInstallCatalogEntries(catalog: MarketplaceCatalog): MarketplaceEntry[] {
  return [...(catalog.entries ?? [])]
}

export function isHighRiskDefaultInstall(entry: MarketplaceEntry): boolean {
  return entry.kind === 'tool'
}

export function seedLockStatusFor(entry: MarketplaceEntry): MarketplaceLockRecord['status'] {
  return entry.kind === 'tool' ? 'deferred' : 'installed'
}

export function defaultSeedPath(configDir: string): string {
  return join(marketplacePaths(configDir).dir, 'default-seed.json')
}

function emptySeed(): DefaultMarketplaceSeedFile {
  return { version: DEFAULT_MARKETPLACE_SEED_VERSION, ids: [] }
}

export function readDefaultMarketplaceSeed(seedPath: string): DefaultMarketplaceSeedFile {
  try {
    if (!existsSync(seedPath)) return emptySeed()
    const raw = JSON.parse(readFileSync(seedPath, 'utf8')) as Partial<DefaultMarketplaceSeedFile>
    if (raw.version !== DEFAULT_MARKETPLACE_SEED_VERSION || !Array.isArray(raw.ids)) {
      return emptySeed()
    }
    return {
      version: DEFAULT_MARKETPLACE_SEED_VERSION,
      ids: raw.ids.filter((id): id is string => typeof id === 'string'),
    }
  } catch {
    return emptySeed()
  }
}

function writeDefaultMarketplaceSeed(seedPath: string, seed: DefaultMarketplaceSeedFile): void {
  mkdirSync(dirname(seedPath), { recursive: true })
  writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8')
}

export function marketplaceExtensionId(entryId: string): string {
  return `marketplace:${entryId}`
}

/**
 * Idempotent: each catalog id is considered at most once. User uninstalls
 * are not re-added. High-risk tools are disabled only when no prior flag.
 */
export function seedDefaultMarketplaceInstalls(
  options: SeedDefaultMarketplaceInstallsOptions,
): SeedDefaultMarketplaceInstallsResult {
  const now = options.now ?? Date.now()
  const paths = marketplacePaths(options.configDir)
  const seedPath = defaultSeedPath(options.configDir)
  const previous = readDefaultMarketplaceSeed(seedPath)
  const considered = new Set(previous.ids)
  const lock = readLock(paths.lockFile)
  const result: SeedDefaultMarketplaceInstallsResult = {
    seeded: [],
    skipped: [],
    disabled: [],
  }

  for (const entry of defaultInstallCatalogEntries(options.catalog)) {
    if (considered.has(entry.id)) {
      result.skipped.push(entry.id)
      continue
    }
    considered.add(entry.id)
    if (!lock.entries[entry.id]) {
      upsertLockRecord(paths.lockFile, {
        id: entry.id,
        kind: entry.kind,
        repo: entry.source.repo,
        ref: entry.source.ref,
        installedAt: now,
        updatedAt: now,
        status: seedLockStatusFor(entry),
        targets: [],
        skills: entry.skills,
        toolName: entry.toolName,
      })
      result.seeded.push(entry.id)
    } else {
      result.skipped.push(entry.id)
    }

    if (isHighRiskDefaultInstall(entry)) {
      const extId = marketplaceExtensionId(entry.id)
      if (options.stateStore.getState().enabled[extId] === undefined) {
        options.stateStore.setEnabled(extId, false)
        result.disabled.push(entry.id)
      }
    }
  }

  writeDefaultMarketplaceSeed(seedPath, {
    version: DEFAULT_MARKETPLACE_SEED_VERSION,
    ids: [...considered].sort(),
  })
  return result
}
