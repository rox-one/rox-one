/**
 * Record which shipped marketplace entries were presented to the user.
 *
 * Catalog presence is not installation: a row is added to the install lock
 * only after the pinned artifact has actually been installed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { MarketplaceCatalog, MarketplaceEntry } from '../marketplace/catalog.ts'
import { marketplacePaths } from '../marketplace/catalog.ts'
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
 * Idempotently records entries that have been exposed as defaults. User
 * removal is respected; actual installation is exclusively installer-owned.
 */
export function seedDefaultMarketplaceInstalls(
  options: SeedDefaultMarketplaceInstallsOptions,
): SeedDefaultMarketplaceInstallsResult {
  const seedPath = defaultSeedPath(options.configDir)
  const considered = new Set(readDefaultMarketplaceSeed(seedPath).ids)
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
    result.seeded.push(entry.id)

    // Default entries remain suggestions until the pinned installer writes a
    // real artifact and provenance lock. Never fabricate installed/deferred.
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
