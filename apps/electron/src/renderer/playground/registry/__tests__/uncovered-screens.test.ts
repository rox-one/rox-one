import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const playground = join(import.meta.dir, '../..')

describe('uncovered playground screens', () => {
  it('registers Security, Cloud Runs, quest empty, and Reauth stories', () => {
    const settings = readFileSync(join(playground, 'registry/settings.tsx'), 'utf8')
    const onboarding = readFileSync(join(playground, 'registry/onboarding.tsx'), 'utf8')
    expect(settings).toContain("id: 'settings-security'")
    expect(settings).toContain("id: 'settings-cloud-runs'")
    expect(settings).toContain("id: 'settings-marketplace'")
    expect(settings).toContain("id: 'settings-import'")
    expect(settings).toContain('MarketplaceSettingsPage')
    expect(settings).toContain('ImportSettingsPage')
    expect(settings).toContain("id: 'home-quests-empty'")
    expect(settings).toContain("id: 'home-quests-active'")
    expect(settings).toContain('QuestProgressCard')
    expect(onboarding).toContain("id: 'onboarding-reauth'")
    expect(onboarding).toContain('ReauthScreen')
    expect(onboarding).toContain("id: 'onboarding-environment'")
    expect(onboarding).toContain('EnvironmentSetupStep')
    const chat = readFileSync(join(playground, 'registry/chat.tsx'), 'utf8')
    expect(chat).toContain("inputMode: 'credential'")
    expect(chat).toContain('sampleCredentialRequest')
    expect(chat).toContain("t('auth.signInToContinueSource')")
    expect(chat).not.toContain('Sign in to continue the source connection.')
  })

  it('mocks cloud-run, security, and quest IPC for those screens', () => {
    const mock = readFileSync(join(playground, 'mock-utils.ts'), 'utf8')
    expect(mock).toContain('getCloudRunsConfig')
    expect(mock).toContain('getMarketplaceCatalog')
    expect(mock).toContain('foreignDiscoverSessions')
    expect(mock).toContain('openclawRuntime')
    expect(mock).toContain('securityAudit')
    expect(mock).toContain("id: 'first_note'")
    expect(mock).toContain('findings: []')
    expect(mock).toContain('getEnvironmentSetup')
  })
})
