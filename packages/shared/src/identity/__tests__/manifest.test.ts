import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ROX_BRAND_MIGRATION_VERSION,
  ROX_BUNDLE_ID,
  ROX_DEEPLINK_SCHEME,
  ROX_LEGACY_BUNDLE_ID,
  ROX_LEGACY_DEEPLINK_SCHEME,
  ROX_MIGRATION_MANIFEST,
  ROX_PRODUCT_NAME,
  ROX_TYPOGRAPHY,
  isRoxDeeplinkProtocol,
  isRoxDeeplinkUrl,
} from '../manifest.ts'
import {
  exportBrandConfig,
  readMigrationStamp,
  rollbackBrandConfigMigration,
  runBrandConfigMigration,
  uninstallBrandConfig,
} from '../config-migration.ts'

let home: string | undefined

function makeHome(): string {
  home = mkdtempSync(join(tmpdir(), 'rox-brand-home-'))
  return home
}

afterEach(() => {
  if (home && existsSync(home)) rmSync(home, { recursive: true, force: true })
  home = undefined
})

function writeLegacyTree(homeDir: string): void {
  const legacy = join(homeDir, '.craft-agent')
  mkdirSync(join(legacy, 'sessions'), { recursive: true })
  writeFileSync(join(legacy, 'config.json'), JSON.stringify({ product: 'craft' }))
  writeFileSync(join(legacy, 'sessions', 'one.json'), '{"id":"s1"}')
  mkdirSync(join(legacy, 'credentials'), { recursive: true })
  writeFileSync(join(legacy, 'credentials', 'token'), 'legacy-token')
}

describe('ROX migration manifest', () => {
  it('names Rox identity, aliases, endpoints and Geist fallback', () => {
    expect(ROX_MIGRATION_MANIFEST.productName).toBe(ROX_PRODUCT_NAME)
    expect(ROX_MIGRATION_MANIFEST.bundleId).toBe(ROX_BUNDLE_ID)
    expect(ROX_MIGRATION_MANIFEST.legacyBundleId).toBe(ROX_LEGACY_BUNDLE_ID)
    expect(ROX_MIGRATION_MANIFEST.deeplinkScheme).toBe(ROX_DEEPLINK_SCHEME)
    expect(ROX_MIGRATION_MANIFEST.legacyDeeplinkScheme).toBe(ROX_LEGACY_DEEPLINK_SCHEME)
    expect(ROX_MIGRATION_MANIFEST.publicOrigin).toBe('https://rox.one')
    expect(ROX_MIGRATION_MANIFEST.broOrigin).toBe('https://bro.rox.one')
    expect(ROX_MIGRATION_MANIFEST.version).toBe(ROX_BRAND_MIGRATION_VERSION)
    expect(ROX_TYPOGRAPHY.distribution).toBe('system-fallback')
  })

  it('accepts rox and craftagents deep-link schemes', () => {
    expect(isRoxDeeplinkProtocol('rox:')).toBe(true)
    expect(isRoxDeeplinkProtocol('craftagents:')).toBe(true)
    expect(isRoxDeeplinkUrl('rox://settings')).toBe(true)
    expect(isRoxDeeplinkUrl('craftagents://allSessions')).toBe(true)
    expect(isRoxDeeplinkUrl('https://rox.one')).toBe(false)
  })
})

describe('Craft → Rox config migration', () => {
  const isolatedEnv = {} as Record<string, string | undefined>

  it('clean-install creates ~/.rox without a Craft tree', () => {
    const homeDir = makeHome()
    const result = runBrandConfigMigration({ homeDir, env: isolatedEnv })
    expect(result.outcome).toBe('clean-install')
    expect(result.configDir).toBe(join(homeDir, '.rox'))
    expect(existsSync(result.configDir)).toBe(true)
    expect(existsSync(join(homeDir, '.craft-agent'))).toBe(false)
  })

  it('upgrade copies Craft data once and keeps the original', () => {
    const homeDir = makeHome()
    writeLegacyTree(homeDir)
    const first = runBrandConfigMigration({ homeDir, env: isolatedEnv, now: '2026-09-12T00:00:00.000Z' })
    expect(first.outcome).toBe('migrated')
    expect(first.diagnostics).toContain('branding.migration.completed')
    expect(readFileSync(join(homeDir, '.rox', 'config.json'), 'utf8')).toContain('craft')
    expect(readFileSync(join(homeDir, '.craft-agent', 'config.json'), 'utf8')).toContain('craft')
    expect(readMigrationStamp(join(homeDir, '.rox'))?.originalPreserved).toBe(true)

    const second = runBrandConfigMigration({ homeDir, env: isolatedEnv })
    expect(second.outcome).toBe('already-migrated')
  })

  it('rollback removes ~/.rox and leaves Craft data', () => {
    const homeDir = makeHome()
    writeLegacyTree(homeDir)
    runBrandConfigMigration({ homeDir, env: isolatedEnv })
    const rolled = rollbackBrandConfigMigration({ homeDir })
    expect(rolled.diagnostics).toContain('branding.migration.rollbackDone')
    expect(existsSync(join(homeDir, '.rox'))).toBe(false)
    expect(existsSync(join(homeDir, '.craft-agent', 'config.json'))).toBe(true)
  })

  it('downgrade after rollback keeps serving the Craft directory', () => {
    const homeDir = makeHome()
    writeLegacyTree(homeDir)
    runBrandConfigMigration({ homeDir, env: isolatedEnv })
    rollbackBrandConfigMigration({ homeDir })
    const again = runBrandConfigMigration({ homeDir, env: isolatedEnv })
    expect(again.outcome).toBe('migrated')
    expect(existsSync(join(homeDir, '.craft-agent', 'sessions', 'one.json'))).toBe(true)
  })

  it('export copies the Rox tree', () => {
    const homeDir = makeHome()
    writeLegacyTree(homeDir)
    runBrandConfigMigration({ homeDir, env: isolatedEnv })
    const dest = join(homeDir, 'export')
    exportBrandConfig(dest, { homeDir })
    expect(readFileSync(join(dest, 'config.json'), 'utf8')).toContain('craft')
  })

  it('uninstall removes Rox data and preserves Craft unless asked', () => {
    const homeDir = makeHome()
    writeLegacyTree(homeDir)
    runBrandConfigMigration({ homeDir, env: isolatedEnv })
    uninstallBrandConfig({ homeDir })
    expect(existsSync(join(homeDir, '.rox'))).toBe(false)
    expect(existsSync(join(homeDir, '.craft-agent'))).toBe(true)
    uninstallBrandConfig({ homeDir, removeLegacy: true })
    expect(existsSync(join(homeDir, '.craft-agent'))).toBe(false)
  })

  it('does not migrate when an env override is set', () => {
    const homeDir = makeHome()
    writeLegacyTree(homeDir)
    const result = runBrandConfigMigration({
      homeDir,
      env: { CRAFT_CONFIG_DIR: join(homeDir, 'custom') },
    })
    expect(result.outcome).toBe('skipped-env-override')
    expect(existsSync(join(homeDir, '.rox'))).toBe(false)
  })
})
