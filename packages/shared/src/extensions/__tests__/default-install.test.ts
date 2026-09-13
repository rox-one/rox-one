import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MarketplaceCatalog, MarketplaceEntry } from '../../marketplace/catalog.ts'
import { marketplacePaths } from '../../marketplace/catalog.ts'
import { readLock, writeLock } from '../../marketplace/lock.ts'
import { ExtensionStateStore, resetExtensionStateStoreCache } from '../state-store.ts'
import {
  defaultInstallCatalogEntries,
  isHighRiskDefaultInstall,
  marketplaceExtensionId,
  seedDefaultMarketplaceInstalls,
  seedLockStatusFor,
} from '../default-install.ts'
import { countInstalledExtensionRecords } from '../installed-counts.ts'

const REF = 'a'.repeat(40)
const PIN = 'b'.repeat(64)

function skillpack(id: string): MarketplaceEntry {
  return {
    id,
    kind: 'skillpack',
    title: id,
    descriptionRu: 'пак',
    source: { type: 'github', repo: 'acme/pack', ref: REF },
    skills: ['foo'],
    expectedContentSha256: { foo: PIN },
  }
}

function tool(id: string): MarketplaceEntry {
  return {
    id,
    kind: 'tool',
    title: id,
    descriptionRu: 'инструмент',
    source: { type: 'github', repo: 'acme/tool', ref: REF },
    toolName: id,
  }
}

const CATALOG: MarketplaceCatalog = {
  catalogVersion: 1,
  entries: [skillpack('superpowers'), tool('just-bash'), skillpack('hallmark')],
}

describe('default marketplace install seed', () => {
  const dirs: string[] = []
  afterEach(() => {
    resetExtensionStateStoreCache()
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0
  })

  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'mp-seed-'))
    dirs.push(d)
    return d
  }

  it('lists every shipped catalog entry for default-install', () => {
    expect(defaultInstallCatalogEntries(CATALOG).map((e) => e.id)).toEqual([
      'superpowers',
      'just-bash',
      'hallmark',
    ])
  })

  it('marks tools deferred/high-risk and skillpacks installed', () => {
    expect(isHighRiskDefaultInstall(tool('just-bash'))).toBe(true)
    expect(isHighRiskDefaultInstall(skillpack('superpowers'))).toBe(false)
    expect(seedLockStatusFor(tool('just-bash'))).toBe('deferred')
    expect(seedLockStatusFor(skillpack('superpowers'))).toBe('installed')
  })

  it('seeds missing lock rows once and disables high-risk tools', () => {
    const configDir = tmp()
    const store = new ExtensionStateStore({ configDir })
    const first = seedDefaultMarketplaceInstalls({
      catalog: CATALOG,
      configDir,
      stateStore: store,
      now: 42,
    })
    expect(first.seeded.sort()).toEqual(['hallmark', 'just-bash', 'superpowers'])
    expect(first.disabled).toEqual(['just-bash'])

    const lock = readLock(marketplacePaths(configDir).lockFile)
    expect(lock.entries.superpowers?.status).toBe('installed')
    expect(lock.entries.superpowers?.targets).toEqual([])
    expect(lock.entries['just-bash']?.status).toBe('deferred')
    expect(store.isEnabled(marketplaceExtensionId('just-bash'))).toBe(false)
    expect(store.isEnabled(marketplaceExtensionId('superpowers'))).toBe(true)

    const second = seedDefaultMarketplaceInstalls({
      catalog: CATALOG,
      configDir,
      stateStore: store,
      now: 99,
    })
    expect(second.seeded).toEqual([])
    expect(second.skipped.sort()).toEqual(['hallmark', 'just-bash', 'superpowers'])
    expect(readLock(marketplacePaths(configDir).lockFile).entries.superpowers?.installedAt).toBe(42)
  })

  it('does not re-add an id after the user removes the lock row', () => {
    const configDir = tmp()
    const store = new ExtensionStateStore({ configDir })
    seedDefaultMarketplaceInstalls({ catalog: CATALOG, configDir, stateStore: store })
    const paths = marketplacePaths(configDir)
    const lock = readLock(paths.lockFile)
    delete lock.entries.hallmark
    writeLock(paths.lockFile, lock)

    const again = seedDefaultMarketplaceInstalls({ catalog: CATALOG, configDir, stateStore: store })
    expect(again.seeded).toEqual([])
    expect(readLock(paths.lockFile).entries.hallmark).toBeUndefined()
  })

  it('counts disabled separately from the installed total', () => {
    expect(
      countInstalledExtensionRecords([
        { status: 'enabled' },
        { status: 'disabled' },
        { status: 'disabled' },
        { status: 'update-available' },
      ]),
    ).toEqual({ total: 4, disabled: 2, enabled: 2 })
  })
})
