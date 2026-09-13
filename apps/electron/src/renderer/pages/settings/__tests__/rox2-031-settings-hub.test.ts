import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry.ts'
import {
  SETTINGS_HUB_REQUIRES_CONATION_FLAG,
  SETTINGS_SURFACE_ID,
  bindSettingsHubContext,
  settingsHubActionResult,
} from '../settings-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-031 native settings hub', () => {
  test('settings hub stays registered and reachable without Conation', () => {
    expect(SETTINGS_SURFACE_ID).toBe('settings')
    expect(SETTINGS_HUB_REQUIRES_CONATION_FLAG).toBe(false)
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(ids).toContain('account')
    expect(ids).toContain('permissions')
    expect(ids).toContain('security')
    expect(ids).toHaveLength(22)
    const registry = source('apps/electron/src/shared/settings-registry.ts')
    expect(registry).toContain('SETTINGS_HUB_REQUIRES_CONATION_FLAG = false')
    expect(registry).not.toContain('conation.dev')
  })

  test('SettingsNavigator has no conation.dev iframe', () => {
    const nav = source('apps/electron/src/renderer/pages/settings/SettingsNavigator.tsx')
    expect(nav).not.toContain('conation.dev')
    expect(nav).not.toMatch(/<iframe\b/i)
  })

  test('native settings actions are live; fixture, conation, and ungranted spend are not', () => {
    const ctx = bindSettingsHubContext('ws-1', 'account')
    expect(ctx.surfaceId).toBe('settings:account')
    expect(isClaimableLive(settingsHubActionResult({ source: 'native' }))).toBe(true)
    expect(isClaimableLive(settingsHubActionResult({ source: 'fixture' }))).toBe(false)
    expect(isClaimableLive(settingsHubActionResult({ source: 'conation' }))).toBe(false)
    expect(
      isClaimableLive(settingsHubActionResult({ source: 'native', permission: 'spend', granted: false })),
    ).toBe(false)
    expect(
      isClaimableLive(settingsHubActionResult({ source: 'native', permission: 'spend', granted: true })),
    ).toBe(true)
  })
})
