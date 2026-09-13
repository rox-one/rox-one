import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry.ts'
import {
  ROX2_SETTINGS_WAVE8_PAGE_IDS,
  SETTINGS_HUB_REQUIRES_CONATION_FLAG,
  bindSettingsHubContext,
  settingsPageActionResult,
} from '../settings-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const PAGE_FILE = 'apps/electron/src/renderer/pages/settings/ShortcutsPage.tsx'

describe('ROX2-062 native shortcuts settings page', () => {
  test('shortcuts stays in SETTINGS_PAGES without Conation flags', () => {
    expect(SETTINGS_HUB_REQUIRES_CONATION_FLAG).toBe(false)
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(ids.slice(21, 22)).toEqual([...ROX2_SETTINGS_WAVE8_PAGE_IDS])
    expect(bindSettingsHubContext('ws-1', 'shortcuts').surfaceId).toBe('settings:shortcuts')
    expect(bindSettingsHubContext('ws-1', 'shortcuts', 'ask').permissionMode).toBe('ask')
  })

  test('page uses PanelHeader chrome and does not embed conation.dev', () => {
    const text = source(PAGE_FILE)
    expect(text).toContain('<PanelHeader')
    expect(text).toContain('h-full min-h-0')
    expect(text).toContain('mask-fade-y')
    expect(text).not.toContain('conation.dev')
    expect(text).not.toMatch(/<iframe\b/i)
  })

  test('native catalog load is live; fixture, ungranted, and spend are not', () => {
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'shortcuts',
          action: 'config-read',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'shortcuts',
          action: 'config-read',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'shortcuts',
          action: 'spend',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'shortcuts',
          action: 'config-read',
          source: 'fixture',
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'shortcuts',
          action: 'config-read',
          source: 'conation',
        }),
      ),
    ).toBe(false)

    const verified = settingsPageActionResult({
      pageId: 'shortcuts',
      action: 'config-read',
      source: 'native',
      granted: true,
    })
    expect(verified.executionMode).toBe('live')
    expect(verified.lifecycle).toBe('succeeded')
    expect(verified.verification).toBe('receipt_verified')
  })

  test('page calls the Rox2 gate and does not treat shortcuts as spend', () => {
    const text = source(PAGE_FILE)
    expect(text).toContain("action: 'config-read'")
    expect(text).toContain('settingsPageActionResult')
    expect(text).toContain('shortcutsCatalogLive')
    expect(text).not.toContain('checkout')
    expect(text).not.toContain('stripe')
    expect(text).not.toContain("action: 'spend'")
  })

  test('playground registers shortcuts without claiming live Conation', () => {
    const stories = source('apps/electron/src/renderer/playground/registry/settings.tsx')
    expect(stories).toContain("id: 'settings-shortcuts'")
    expect(stories).toContain('ShortcutsPage')
    expect(stories).toContain('ActionRegistryProvider')
    expect(stories).not.toContain('conation.dev')
  })
})
