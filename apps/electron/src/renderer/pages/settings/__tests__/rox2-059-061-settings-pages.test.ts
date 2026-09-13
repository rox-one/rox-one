import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry.ts'
import {
  ROX2_SETTINGS_WAVE7_PAGE_IDS,
  SETTINGS_HUB_REQUIRES_CONATION_FLAG,
  bindSettingsHubContext,
  settingsPageActionResult,
} from '../settings-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const PAGE_FILES: Record<(typeof ROX2_SETTINGS_WAVE7_PAGE_IDS)[number], string> = {
  messaging: 'apps/electron/src/renderer/pages/settings/MessagingSettingsPage.tsx',
  server: 'apps/electron/src/renderer/pages/settings/ServerSettingsPage.tsx',
  cloudRuns: 'apps/electron/src/renderer/pages/settings/CloudRunsSettingsPage.tsx',
}

describe('ROX2-059..061 native settings pages', () => {
  test('messaging, server, and cloudRuns stay in SETTINGS_PAGES without Conation flags', () => {
    expect(SETTINGS_HUB_REQUIRES_CONATION_FLAG).toBe(false)
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(ids.slice(18, 21)).toEqual([...ROX2_SETTINGS_WAVE7_PAGE_IDS])
    expect(bindSettingsHubContext('ws-1', 'messaging').surfaceId).toBe('settings:messaging')
    expect(bindSettingsHubContext('ws-1', 'server', 'ask').permissionMode).toBe('ask')
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

  test('native writes are live; fixture, ungranted connect/forget, and spend are not', () => {
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'messaging',
          action: 'identity-connect',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'messaging',
          action: 'identity-connect',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'messaging',
          action: 'identity-reset',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'messaging',
          action: 'identity-reset',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({ pageId: 'messaging', action: 'pref-write', source: 'native' }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'server',
          action: 'pref-write',
          source: 'native',
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'server',
          action: 'config-read',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'server',
          action: 'config-read',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({ pageId: 'cloudRuns', action: 'pref-write', source: 'native' }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'cloudRuns',
          action: 'config-read',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'cloudRuns',
          action: 'spend',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'messaging',
          action: 'identity-connect',
          source: 'fixture',
        }),
      ),
    ).toBe(false)

    const verified = settingsPageActionResult({
      pageId: 'messaging',
      action: 'identity-connect',
      source: 'native',
      granted: true,
    })
    expect(verified.executionMode).toBe('live')
    expect(verified.lifecycle).toBe('succeeded')
    expect(verified.verification).toBe('receipt_verified')
  })

  test('pages call the Rox2 gate and do not treat connect or cloudRuns as spend', () => {
    const messaging = source(PAGE_FILES.messaging)
    expect(messaging).toContain("messagingActionLive('identity-connect'")
    expect(messaging).toContain("messagingActionLive('identity-reset'")
    expect(messaging).toContain("messagingActionLive('connection-delete'")
    expect(messaging).toContain("messagingActionLive('pref-write'")
    expect(messaging).toContain('settingsPageActionResult')
    expect(messaging).not.toContain('checkout')
    expect(messaging).not.toContain('stripe')

    const server = source(PAGE_FILES.server)
    expect(server).toContain("action: 'pref-write'")
    expect(server).toContain("action: 'config-read'")
    expect(server).toContain("action: 'toggle'")
    expect(server).toContain('settingsPageActionResult')

    const cloudRuns = source(PAGE_FILES.cloudRuns)
    expect(cloudRuns).toContain("action: 'pref-write'")
    expect(cloudRuns).toContain("action: 'config-read'")
    expect(cloudRuns).toContain('settingsPageActionResult')
  })

  test('playground mocks messaging and server without claiming live Conation', () => {
    const mock = source('apps/electron/src/renderer/playground/mock-utils.ts')
    expect(mock).toContain('getMessagingBindings')
    expect(mock).toContain('forgetMessagingPlatform')
    expect(mock).toContain('getServerConfig')
    expect(mock).toContain('setServerConfig')
    expect(mock).toContain('setCloudRunsConfig')
    expect(mock).toContain('Playground fixture. Not live.')
    expect(mock).not.toContain('conation.dev')
    const stories = source('apps/electron/src/renderer/playground/registry/settings.tsx')
    expect(stories).toContain("id: 'settings-messaging'")
    expect(stories).toContain("id: 'settings-server'")
    expect(stories).toContain("id: 'settings-cloud-runs'")
    expect(stories).toContain('NavigationProvider')
  })
})
