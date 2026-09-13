import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('AppSettingsPage environment section', () => {
  it('keeps onboarding environment choices editable in Settings', () => {
    const source = readFileSync(join(import.meta.dir, '../AppSettingsPage.tsx'), 'utf8')
    expect(source).toContain('EnvironmentSettingsSection')
  })
})

describe('AppSettingsPage proxy save copy', () => {
  it('uses settings.network.failedToSave instead of hardcoded English', () => {
    const source = readFileSync(join(import.meta.dir, '../AppSettingsPage.tsx'), 'utf8')
    expect(source).toContain("t('settings.network.failedToSave')")
    expect(source).not.toContain("'Failed to save'")
  })
})
