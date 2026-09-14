import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry.ts'
import {
  ROX2_SETTINGS_WAVE4_PAGE_IDS,
  SETTINGS_HUB_REQUIRES_CONATION_FLAG,
  bindSettingsHubContext,
  settingsPageActionResult,
} from '../settings-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const PAGE_FILES: Record<(typeof ROX2_SETTINGS_WAVE4_PAGE_IDS)[number], string> = {
  ai: 'apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx',
  appearance: 'apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx',
  input: 'apps/electron/src/renderer/pages/settings/InputSettingsPage.tsx',
}

describe('ROX2-050..052 native settings pages', () => {
  test('ai, appearance, and input stay in SETTINGS_PAGES without Conation flags', () => {
    expect(SETTINGS_HUB_REQUIRES_CONATION_FLAG).toBe(false)
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(ids.slice(9, 12)).toEqual([...ROX2_SETTINGS_WAVE4_PAGE_IDS])
    expect(bindSettingsHubContext('ws-1', 'ai').surfaceId).toBe('settings:ai')
    expect(bindSettingsHubContext('ws-1', 'appearance', 'ask').permissionMode).toBe('ask')
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

  test('native writes are live; fixture, ungranted delete/test, and spend are not', () => {
    expect(
      isClaimableLive(
        settingsPageActionResult({ pageId: 'ai', action: 'pref-write', source: 'native' }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'ai',
          action: 'connection-write',
          source: 'native',
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'ai',
          action: 'connection-delete',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'ai',
          action: 'connection-delete',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'ai',
          action: 'connection-test',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'ai',
          action: 'connection-test',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'ai',
          action: 'spend',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'appearance',
          action: 'pref-write',
          source: 'native',
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'appearance',
          action: 'pref-write',
          source: 'fixture',
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({ pageId: 'input', action: 'pref-write', source: 'native' }),
      ),
    ).toBe(true)

    const verified = settingsPageActionResult({
      pageId: 'ai',
      action: 'connection-test',
      source: 'native',
      granted: true,
    })
    if (!isClaimableLive(verified)) throw new Error('expected a verified native action result')
    expect(verified.executionMode).toBe('live')
    expect(verified.lifecycle).toBe('succeeded')
    expect(verified.verification).toBe('receipt_verified')
  })

  test('pages call the Rox2 gate and do not treat connection test as spend', () => {
    const ai = source(PAGE_FILES.ai)
    expect(ai).toContain("action: 'pref-write'")
    expect(ai).toContain("action: 'connection-write'")
    expect(ai).toContain("action: 'connection-delete'")
    expect(ai).toContain("action: 'connection-test'")
    expect(ai).toContain('settingsPageActionResult')
    expect(ai).not.toContain('checkout')
    expect(ai).not.toContain('stripe')

    const appearance = source(PAGE_FILES.appearance)
    expect(appearance).toContain("action: 'pref-write'")
    expect(appearance).toContain('settingsPageActionResult')

    const input = source(PAGE_FILES.input)
    expect(input).toContain("action: 'pref-write'")
    expect(input).toContain('settingsPageActionResult')
  })

  test('playground mocks AI prefs and input without claiming live Conation', () => {
    const mock = source('apps/electron/src/renderer/playground/mock-utils.ts')
    expect(mock).toContain('getWorkspaces')
    expect(mock).toContain('getExtendedPromptCache')
    expect(mock).toContain('getKanbanConfig')
    expect(mock).toContain('setAutoCapitalisation')
    expect(mock).toContain('Playground fixture. Not live.')
    expect(mock).not.toContain('conation.dev')
    const stories = source('apps/electron/src/renderer/playground/registry/settings.tsx')
    expect(stories).toContain("id: 'settings-ai'")
    expect(stories).toContain("id: 'settings-appearance'")
    expect(stories).toContain("id: 'settings-input'")
  })
})
