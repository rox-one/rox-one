import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry.ts'
import {
  ROX2_SETTINGS_WAVE3_PAGE_IDS,
  SETTINGS_HUB_REQUIRES_CONATION_FLAG,
  bindSettingsHubContext,
  settingsPageActionResult,
} from '../settings-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const PAGE_FILES: Record<(typeof ROX2_SETTINGS_WAVE3_PAGE_IDS)[number], string> = {
  extensions: 'apps/electron/src/renderer/pages/settings/ExtensionsSettingsPage.tsx',
  import: 'apps/electron/src/renderer/pages/settings/ImportSettingsPage.tsx',
  app: 'apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx',
}

describe('ROX2-047..049 native settings pages', () => {
  test('extensions, import, and app stay in SETTINGS_PAGES without Conation flags', () => {
    expect(SETTINGS_HUB_REQUIRES_CONATION_FLAG).toBe(false)
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(ids.slice(6, 9)).toEqual([...ROX2_SETTINGS_WAVE3_PAGE_IDS])
    expect(bindSettingsHubContext('ws-1', 'extensions').surfaceId).toBe('settings:extensions')
    expect(bindSettingsHubContext('ws-1', 'import', 'ask').permissionMode).toBe('ask')
  })

  test('pages use PanelHeader chrome and do not embed conation.dev', () => {
    for (const [id, rel] of Object.entries(PAGE_FILES)) {
      const text = source(rel)
      expect(text, id).toContain('<PanelHeader')
      expect(text, id).toContain('h-full min-h-0')
      expect(text, id).toContain('mask-fade-y')
      expect(text, id).not.toContain('conation.dev')
      expect(text, id).not.toMatch(/<iframe\b/i)
    }
  })

  test('native writes are live; fixture, ungranted install, and spend are not', () => {
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'extensions',
          action: 'install',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'extensions',
          action: 'install',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'extensions',
          action: 'install',
          source: 'fixture',
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'extensions',
          action: 'spend',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'extensions',
          action: 'toggle',
          source: 'native',
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'import',
          action: 'scan',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'import',
          action: 'scan',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'import',
          action: 'persist',
          source: 'native',
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'app',
          action: 'pref-write',
          source: 'native',
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'app',
          action: 'pref-write',
          source: 'fixture',
        }),
      ),
    ).toBe(false)

    const verified = settingsPageActionResult({
      pageId: 'extensions',
      action: 'install',
      source: 'native',
      granted: true,
    })
    if (!isClaimableLive(verified)) throw new Error('expected a verified native action result')
    expect(verified.executionMode).toBe('live')
    expect(verified.lifecycle).toBe('succeeded')
    expect(verified.verification).toBe('receipt_verified')
  })

  test('pages call the Rox2 gate and do not treat extension install as spend', () => {
    const extensions = source(PAGE_FILES.extensions)
    expect(extensions).toContain("action: 'install' | 'uninstall' | 'toggle' | 'pref-write'")
    expect(extensions).toContain(", 'install'")
    expect(extensions).toContain(", 'uninstall'")
    expect(extensions).toContain(", 'toggle'")
    expect(extensions).toContain(", 'pref-write'")
    expect(extensions).toContain('settingsPageActionResult')
    expect(extensions).not.toContain('checkout')
    expect(extensions).not.toContain('stripe')

    const importPage = source(PAGE_FILES.import)
    expect(importPage).toContain("action: 'scan'")
    expect(importPage).toContain("action: 'persist'")
    expect(importPage).toContain('settingsPageActionResult')

    const app = source(PAGE_FILES.app)
    expect(app).toContain("action: 'pref-write'")
    expect(app).toContain('settingsPageActionResult')
  })

  test('playground mocks extensions catalog and app prefs without claiming live Conation', () => {
    const mock = source('apps/electron/src/renderer/playground/mock-utils.ts')
    expect(mock).toContain('extensionsListCatalog')
    expect(mock).toContain('extensionsListInstalled')
    expect(mock).toContain('onExtensionsChanged')
    expect(mock).toContain('setNotificationsEnabled')
    expect(mock).toContain('getUpdateInfo')
    expect(mock).toContain('foreignDiscoverSessions')
    expect(mock).toContain('discoverBrowserProfiles')
    expect(mock).toContain('Playground fixture. Not live.')
    expect(mock).not.toContain('conation.dev')
    const stories = source('apps/electron/src/renderer/playground/registry/settings.tsx')
    expect(stories).toContain("id: 'settings-extensions'")
    expect(stories).toContain("id: 'settings-app'")
    expect(stories).toContain("id: 'settings-import'")
  })
})
