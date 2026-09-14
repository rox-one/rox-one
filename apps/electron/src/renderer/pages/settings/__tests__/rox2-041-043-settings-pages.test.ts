import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry.ts'
import {
  ROX2_SETTINGS_PAGE_IDS,
  SETTINGS_HUB_REQUIRES_CONATION_FLAG,
  bindSettingsHubContext,
  settingsPageActionResult,
} from '../settings-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const PAGE_FILES: Record<(typeof ROX2_SETTINGS_PAGE_IDS)[number], string> = {
  account: 'apps/electron/src/renderer/pages/settings/AccountSettingsPage.tsx',
  privacy: 'apps/electron/src/renderer/pages/settings/PrivacySettingsPage.tsx',
  runtime: 'apps/electron/src/renderer/pages/settings/RuntimeSettingsPage.tsx',
}

describe('ROX2-041..043 native settings pages', () => {
  test('account, privacy, and runtime stay in SETTINGS_PAGES without Conation flags', () => {
    expect(SETTINGS_HUB_REQUIRES_CONATION_FLAG).toBe(false)
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(ids.slice(0, 3)).toEqual([...ROX2_SETTINGS_PAGE_IDS])
    expect(bindSettingsHubContext('ws-1', 'account').surfaceId).toBe('settings:account')
    expect(bindSettingsHubContext('ws-1', 'privacy', 'ask').permissionMode).toBe('ask')
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

  test('native writes are live; fixture, conation, spend, and queued deletion are not', () => {
    expect(
      isClaimableLive(
        settingsPageActionResult({ pageId: 'account', action: 'plan-write', source: 'native' }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'account',
          action: 'spend',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'account',
          action: 'avatar-read',
          source: 'native',
          granted: false,
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'account',
          action: 'avatar-read',
          source: 'native',
          granted: true,
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'privacy',
          action: 'export',
          source: 'fixture',
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'privacy',
          action: 'remote-deletion',
          source: 'native',
          granted: true,
          deletionStatus: 'queued',
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'privacy',
          action: 'remote-deletion',
          source: 'native',
          granted: true,
          deletionStatus: 'completed',
        }),
      ),
    ).toBe(true)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'runtime',
          action: 'permission-mode',
          source: 'conation',
        }),
      ),
    ).toBe(false)
    expect(
      isClaimableLive(
        settingsPageActionResult({
          pageId: 'runtime',
          action: 'permission-mode',
          source: 'native',
        }),
      ),
    ).toBe(true)

    const verified = settingsPageActionResult({
      pageId: 'account',
      action: 'plan-write',
      source: 'native',
    })
    if (!isClaimableLive(verified)) throw new Error('expected a verified native action result')
    expect(verified.executionMode).toBe('live')
    expect(verified.lifecycle).toBe('succeeded')
    expect(verified.verification).toBe('receipt_verified')
    expect(verified.receipt?.provider).toBe('native')
  })

  test('pages call the Rox2 gate and do not toast queued deletion as complete', () => {
    const account = source(PAGE_FILES.account)
    expect(account).toContain("action: 'spend'")
    expect(account).toContain("action: 'plan-write'")
    expect(account).toContain("action: 'avatar-read'")
    expect(account).not.toContain('checkout')
    expect(account).not.toContain('stripe')

    const privacy = source(PAGE_FILES.privacy)
    expect(privacy).toContain("action: 'remote-deletion'")
    expect(privacy).toContain("t('settings.privacy.deletionNotLive')")
    expect(privacy).toContain('normalizeRox2Result')
    expect(privacy).not.toContain("toast.success(t('settings.privacy.deletionQueued'))")

    const runtime = source(PAGE_FILES.runtime)
    expect(runtime).toContain("action: 'permission-mode'")
    expect(runtime).toContain('settingsPageActionResult')
  })
})
