import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry.ts'
import {
  ROX2_SETTINGS_WAVE2_PAGE_IDS,
  SETTINGS_HUB_REQUIRES_CONATION_FLAG,
  bindSettingsHubContext,
  settingsPageActionResult,
} from '../settings-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const PAGE_FILES: Record<(typeof ROX2_SETTINGS_WAVE2_PAGE_IDS)[number], string> = {
  context: 'apps/electron/src/renderer/pages/settings/ContextSettingsPage.tsx',
  marketplace: 'apps/electron/src/renderer/pages/settings/MarketplaceSettingsPage.tsx',
  knowledge: 'apps/electron/src/renderer/pages/settings/KnowledgeSettingsPage.tsx',
}

describe('ROX2-044..046 native settings pages', () => {
  test('context, marketplace, and knowledge stay in SETTINGS_PAGES without Conation flags', () => {
    expect(SETTINGS_HUB_REQUIRES_CONATION_FLAG).toBe(false)
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(ids.slice(3, 6)).toEqual([...ROX2_SETTINGS_WAVE2_PAGE_IDS])
    expect(bindSettingsHubContext('ws-1', 'context').surfaceId).toBe('settings:context')
    expect(bindSettingsHubContext('ws-1', 'marketplace', 'ask').permissionMode).toBe('ask')
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

  test('native writes are live; fixture, conation, spend, and ungranted install are not', () => {
    expect(
      isClaimableLive(
        settingsPageActionResult({ pageId: 'context', action: 'doc-write', source: 'native' }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'context',
          action: 'doc-delete',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'context',
          action: 'doc-delete',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'marketplace',
          action: 'install',
          source: 'fixture',
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'marketplace',
          action: 'install',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'marketplace',
          action: 'install',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'marketplace',
          action: 'spend',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'knowledge',
          action: 'migrate',
          source: 'conation',
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'knowledge',
          action: 'token-write',
          source: 'native',
        }),
      ),
    ).toBe(true)

    const verified = settingsPageActionResult({
      pageId: 'marketplace',
      action: 'install',
      source: 'native',
      granted: true,
    })
    if (!isClaimableLive(verified)) throw new Error('expected a verified native action result')
    expect(verified.executionMode).toBe('live')
    expect(verified.lifecycle).toBe('succeeded')
    expect(verified.verification).toBe('receipt_verified')
  })

  test('pages call the Rox2 gate and do not treat marketplace as spend', () => {
    const context = source(PAGE_FILES.context)
    expect(context).toContain("action: 'doc-write'")
    expect(context).toContain("action: 'doc-delete'")

    const marketplace = source(PAGE_FILES.marketplace)
    expect(marketplace).toContain("action: 'install' | 'uninstall'")
    expect(marketplace).toContain(", 'uninstall'")
    expect(marketplace).not.toContain('checkout')
    expect(marketplace).not.toContain('stripe')

    const knowledge = source(PAGE_FILES.knowledge)
    expect(knowledge).toContain("action: 'token-write'")
    expect(knowledge).toContain("action: 'migrate'")
    expect(knowledge).toContain('settingsPageActionResult')
  })

  test('playground mocks context docs and knowledge without claiming live Conation', () => {
    const mock = source('apps/electron/src/renderer/playground/mock-utils.ts')
    expect(mock).toContain('listContextDocs')
    expect(mock).toContain('writeContextDoc')
    expect(mock).toContain('installMarketplaceEntry')
    expect(mock).toContain('detectEngine')
    expect(mock).toContain('Playground fixture. Not live.')
    expect(mock).not.toContain('conation.dev')
    const context = source(PAGE_FILES.context)
    expect(context).toContain('onContextDocsChanged?.(')
    expect(context).not.toContain('@craft-agent/shared/config/paths')
  })
})
