import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '..', 'AccountsSettingsPage.tsx'), 'utf8')

describe('AccountsSettingsPage account & security copy', () => {
  it('explains local profile and optional Rox Server URL instead of a fake login', () => {
    expect(source).toContain("t('settings.accounts.securitySection')")
    expect(source).toContain("t('settings.accounts.localProfileDesc')")
    expect(source).toContain("t('settings.accounts.roxServerUrl')")
    expect(source).toContain("t('settings.accounts.roxServerUrlHint')")
    expect(source).not.toContain('Craft Server URL')
  })
})
