import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
})
