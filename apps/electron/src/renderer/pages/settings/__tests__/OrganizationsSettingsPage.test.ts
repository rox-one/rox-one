import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const source = readFileSync(join(import.meta.dir, '..', 'OrganizationsSettingsPage.tsx'), 'utf8')

describe('OrganizationsSettingsPage', () => {
  it('renders userId, username, and email for each member', () => {
    expect(source).toContain("t('settings.orgs.userId')")
    expect(source).toContain("t('settings.orgs.username')")
    expect(source).toContain("t('settings.orgs.email')")
    expect(source).toContain('formatOrgMemberIdentity')
    expect(source).toContain('data-testid="org-member-row"')
  })

  it('explains member vs admin roles next to the invite UI', () => {
    expect(source).toContain("t('settings.orgs.roleMemberHint')")
    expect(source).toContain("t('settings.orgs.roleAdminHint')")
  })

  it('does not pretend invites are emailed', () => {
    expect(source).toContain("t('settings.orgs.inviteNoMailer')")
    expect(source).toContain('window.electronAPI.inviteToOrganization')
    expect(source).toContain("t('settings.orgs.inviteFailed')")
  })

  it('labels Rox Server URL in identity copy', () => {
    expect(source).toContain("t('settings.orgs.roxServerUrl')")
    expect(source).toContain("t('settings.orgs.roxServerUrlHint')")
    expect(source).not.toContain('Craft Server URL')
    expect(source).not.toContain('CraftServerURL')
  })

  it('keeps English Rox Server URL copy', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.orgs.roxServerUrl')).toBe('Rox Server URL')
    expect(i18n.t('settings.orgs.roxServerUrlHint')).toBe(
      'Optional remote server for invite redemption. Local invites still work without it.',
    )
  })

  it('uses Russian copy distinct from English for Rox Server URL', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.orgs.roxServerUrl')).toBe('URL сервера Rox')
    expect(i18n.t('settings.orgs.roxServerUrl')).not.toBe('Rox Server URL')
    expect(i18n.t('settings.orgs.roxServerUrlHint')).not.toBe(
      'Optional remote server for invite redemption. Local invites still work without it.',
    )
  })
})
