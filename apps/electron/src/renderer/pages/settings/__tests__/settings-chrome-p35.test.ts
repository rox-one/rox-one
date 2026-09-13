import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(__dirname, '..')
const cloudRuns = readFileSync(join(dir, 'CloudRunsSettingsPage.tsx'), 'utf8')
const security = readFileSync(join(dir, 'SecuritySettingsPage.tsx'), 'utf8')
const overlay = readFileSync(
  join(__dirname, '../../../components/workspace/WorkspaceCreationScreen.tsx'),
  'utf8',
)
const rail = readFileSync(
  join(__dirname, '../../../components/app-shell/WorkspaceIconRail.tsx'),
  'utf8',
)
const account = readFileSync(join(dir, 'AccountSettingsPage.tsx'), 'utf8')
const accounts = readFileSync(join(dir, 'AccountsSettingsPage.tsx'), 'utf8')
const knowledge = readFileSync(join(dir, 'KnowledgeSettingsPage.tsx'), 'utf8')
const privacy = readFileSync(join(dir, 'PrivacySettingsPage.tsx'), 'utf8')

describe('Program 35 settings chrome', () => {
  it('sizes Cloud Runs and Security to the panel, not the window', () => {
    expect(cloudRuns).not.toContain('100dvh')
    expect(security).not.toContain('100dvh')
    expect(cloudRuns).toContain('h-full min-h-0')
    expect(security).toContain('h-full min-h-0')
  })

  it('keeps Security on the shared 42px PanelHeader so switching settings tabs does not jump', () => {
    const panelHeader = readFileSync(
      join(__dirname, '../../../components/app-shell/PanelHeader.tsx'),
      'utf8',
    )
    expect(panelHeader).toContain('h-[42px]')
    expect(security).toContain('<PanelHeader')
    expect(security).toContain('mask-fade-y')
    expect(security).not.toContain('<header className="flex shrink-0')
  })

  it('keeps the new-workspace overlay opaque', () => {
    expect(overlay).toContain('bg-background')
    expect(overlay).not.toContain('bg-background/95')
  })

  it('falls back to the bundled Rox logo on the workspace rail', () => {
    expect(rail).toContain('rox-logo.svg')
    expect(rail).toContain('bundledRoxLogo')
    expect(rail).not.toContain('fallback={workspace.name.charAt(0)}')
  })

  it('puts usage cards on the account page', () => {
    expect(account).toContain('<MiniDashboardCards')
    expect(account).toContain("t('settings.account.usageSection')")
  })

  it('keeps Privacy on the shared PanelHeader so switching settings tabs does not jump', () => {
    expect(privacy).toContain('<PanelHeader')
    expect(privacy).toContain('h-full min-h-0')
    expect(privacy).toContain('mask-fade-y')
    expect(privacy).not.toContain('100dvh')
    expect(privacy).not.toContain("label={t('settings.privacy.requestExport')}")
  })

  it('keeps Account, Accounts, and Knowledge on the shared PanelHeader', () => {
    for (const source of [account, accounts, knowledge]) {
      expect(source).toContain('<PanelHeader')
      expect(source).toContain('h-full min-h-0')
      expect(source).toContain('mask-fade-y')
      expect(source).not.toContain('100dvh')
      expect(source).not.toContain('<h1 className="text-lg font-semibold">')
    }
    expect(knowledge).not.toContain('<h2 className="text-lg font-semibold">')
  })
})
