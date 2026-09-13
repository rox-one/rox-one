import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry.ts'
import {
  ROX2_SETTINGS_WAVE5_PAGE_IDS,
  SETTINGS_HUB_REQUIRES_CONATION_FLAG,
  bindSettingsHubContext,
  settingsPageActionResult,
} from '../settings-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const PAGE_FILES: Record<(typeof ROX2_SETTINGS_WAVE5_PAGE_IDS)[number], string> = {
  workspace: 'apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx',
  accounts: 'apps/electron/src/renderer/pages/settings/AccountsSettingsPage.tsx',
  permissions: 'apps/electron/src/renderer/pages/settings/PermissionsSettingsPage.tsx',
}

describe('ROX2-053..055 native settings pages', () => {
  test('workspace, accounts, and permissions stay in SETTINGS_PAGES without Conation flags', () => {
    expect(SETTINGS_HUB_REQUIRES_CONATION_FLAG).toBe(false)
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(ids.slice(12, 15)).toEqual([...ROX2_SETTINGS_WAVE5_PAGE_IDS])
    expect(bindSettingsHubContext('ws-1', 'workspace').surfaceId).toBe('settings:workspace')
    expect(bindSettingsHubContext('ws-1', 'accounts', 'ask').permissionMode).toBe('ask')
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

  test('native writes are live; fixture, ungranted connect/reset, and spend are not', () => {
    expect(
      isClaimableLive(
        settingsPageActionResult({ pageId: 'workspace', action: 'pref-write', source: 'native' }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'workspace',
          action: 'permission-mode',
          source: 'native',
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'accounts',
          action: 'profile-write',
          source: 'native',
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'accounts',
          action: 'identity-connect',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'accounts',
          action: 'identity-connect',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'accounts',
          action: 'connection-delete',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'accounts',
          action: 'identity-reset',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'accounts',
          action: 'spend',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'permissions',
          action: 'config-read',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'permissions',
          action: 'config-read',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'permissions',
          action: 'config-read',
          source: 'fixture',
        }),
      ),
    ).toBe(false)

    const verified = settingsPageActionResult({
      pageId: 'workspace',
      action: 'pref-write',
      source: 'native',
    })
    expect(verified.executionMode).toBe('live')
    expect(verified.lifecycle).toBe('succeeded')
    expect(verified.verification).toBe('receipt_verified')
  })

  test('pages call the Rox2 gate and do not treat identity connect as spend', () => {
    const workspace = source(PAGE_FILES.workspace)
    expect(workspace).toContain("action: 'pref-write'")
    expect(workspace).toContain("'permission-mode'")
    expect(workspace).toContain('settingsPageActionResult')

    const accounts = source(PAGE_FILES.accounts)
    expect(accounts).toContain("action: 'profile-write'")
    expect(accounts).toContain("action: 'identity-connect'")
    expect(accounts).toContain("action: 'connection-delete'")
    expect(accounts).toContain("action: 'identity-reset'")
    expect(accounts).toContain('settingsPageActionResult')
    expect(accounts).not.toContain('checkout')
    expect(accounts).not.toContain('stripe')

    const permissions = source(PAGE_FILES.permissions)
    expect(permissions).toContain("action: 'config-read'")
    expect(permissions).toContain('settingsPageActionResult')
  })

  test('playground mocks workspace, accounts, and permissions without claiming live Conation', () => {
    const mock = source('apps/electron/src/renderer/playground/mock-utils.ts')
    expect(mock).toContain('updateWorkspaceSetting')
    expect(mock).toContain('identityGetState')
    expect(mock).toContain('getDefaultPermissionsConfig')
    expect(mock).toContain('Playground fixture. Not live.')
    expect(mock).not.toContain('conation.dev')
    const stories = source('apps/electron/src/renderer/playground/registry/settings.tsx')
    expect(stories).toContain("id: 'settings-workspace'")
    expect(stories).toContain("id: 'settings-accounts'")
    expect(stories).toContain("id: 'settings-permissions'")
  })
})
