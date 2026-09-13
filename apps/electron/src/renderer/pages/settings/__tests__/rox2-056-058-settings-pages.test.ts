import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry.ts'
import {
  ROX2_SETTINGS_WAVE6_PAGE_IDS,
  SETTINGS_HUB_REQUIRES_CONATION_FLAG,
  bindSettingsHubContext,
  settingsPageActionResult,
} from '../settings-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const PAGE_FILES: Record<(typeof ROX2_SETTINGS_WAVE6_PAGE_IDS)[number], string> = {
  security: 'apps/electron/src/renderer/pages/settings/SecuritySettingsPage.tsx',
  labels: 'apps/electron/src/renderer/pages/settings/LabelsSettingsPage.tsx',
  organizations: 'apps/electron/src/renderer/pages/settings/OrganizationsSettingsPage.tsx',
}

describe('ROX2-056..058 native settings pages', () => {
  test('security, labels, and organizations stay in SETTINGS_PAGES without Conation flags', () => {
    expect(SETTINGS_HUB_REQUIRES_CONATION_FLAG).toBe(false)
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(ids.slice(15, 18)).toEqual([...ROX2_SETTINGS_WAVE6_PAGE_IDS])
    expect(bindSettingsHubContext('ws-1', 'security').surfaceId).toBe('settings:security')
    expect(bindSettingsHubContext('ws-1', 'labels', 'ask').permissionMode).toBe('ask')
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

  test('native writes are live; fixture, ungranted install/delete/invite, and spend are not', () => {
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'security',
          action: 'install',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'security',
          action: 'install',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'security',
          action: 'scan',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'security',
          action: 'uninstall',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({ pageId: 'labels', action: 'pref-write', source: 'native' }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'labels',
          action: 'doc-delete',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'labels',
          action: 'doc-delete',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'organizations',
          action: 'pref-write',
          source: 'native',
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'organizations',
          action: 'org-invite',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'organizations',
          action: 'org-invite',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'security',
          action: 'spend',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'labels',
          action: 'pref-write',
          source: 'fixture',
        }),
      ),
    ).toBe(false)

    const verified = settingsPageActionResult({
      pageId: 'security',
      action: 'install',
      source: 'native',
      granted: true,
    })
    expect(verified.executionMode).toBe('live')
    expect(verified.lifecycle).toBe('succeeded')
    expect(verified.verification).toBe('receipt_verified')
  })

  test('pages call the Rox2 gate and do not treat install or invite as spend', () => {
    const security = source(PAGE_FILES.security)
    expect(security).toContain("action: 'install'")
    expect(security).toContain("action: 'scan'")
    expect(security).toContain("action: 'uninstall'")
    expect(security).toContain('settingsPageActionResult')
    expect(security).not.toContain('checkout')
    expect(security).not.toContain('stripe')

    const labels = source(PAGE_FILES.labels)
    expect(labels).toContain("action: 'pref-write'")
    expect(labels).toContain("action: 'doc-delete'")
    expect(labels).toContain('settingsPageActionResult')

    const organizations = source(PAGE_FILES.organizations)
    expect(organizations).toContain("action: 'pref-write'")
    expect(organizations).toContain("action: 'org-invite'")
    expect(organizations).toContain("action: 'profile-write'")
    expect(organizations).toContain('settingsPageActionResult')
  })

  test('playground mocks labels and organizations without claiming live Conation', () => {
    const mock = source('apps/electron/src/renderer/playground/mock-utils.ts')
    expect(mock).toContain('createLabel')
    expect(mock).toContain('listOrganizations')
    expect(mock).toContain('openclawRuntime')
    expect(mock).toContain('Playground fixture. Not live.')
    expect(mock).not.toContain('conation.dev')
    const stories = source('apps/electron/src/renderer/playground/registry/settings.tsx')
    expect(stories).toContain("id: 'settings-security'")
    expect(stories).toContain("id: 'settings-labels'")
    expect(stories).toContain("id: 'settings-organizations'")
  })
})
