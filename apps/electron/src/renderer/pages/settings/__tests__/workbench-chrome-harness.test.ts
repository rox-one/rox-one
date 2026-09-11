import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const settingsPath = join(__dirname, '..', 'WorkbenchChromeSettings.tsx')

describe('WorkbenchChromeSettings harness flags', () => {
  const src = readFileSync(settingsPath, 'utf8')

  it('exposes the four harness toggles from ADR-0019', () => {
    expect(src).toContain('featureWorkbenchHarnessInspectorV1Atom')
    expect(src).toContain('featureWorkbenchHarnessChatChromeV1Atom')
    expect(src).toContain('featureWorkbenchHarnessAgentIntelV1Atom')
    expect(src).toContain('featureWorkbenchHarnessExtCenterV1Atom')
    expect(src).toContain("t('settings.appearance.workbenchHarnessInspector')")
    expect(src).toContain("t('settings.appearance.workbenchHarnessChatChrome')")
    expect(src).toContain("t('settings.appearance.workbenchHarnessAgentIntel')")
    expect(src).toContain("t('settings.appearance.workbenchHarnessExtCenter')")
  })

  it('does not mention DSH in the settings source', () => {
    expect(src).not.toMatch(/dsh-|DSH |Cordis/i)
  })

  it('turns inspector on when agent intel is enabled', () => {
    expect(src).toContain('if (checked) setHarnessInspector(true)')
    expect(src).toContain('if (!checked) setHarnessAgentIntel(false)')
  })

  it('shows the frozen skip-list as not-installed', () => {
    expect(src).toContain('HARNESS_SKIP_LIST')
    expect(src).toContain('data-testid="harness-skip-list"')
    expect(src).toContain("t('settings.appearance.harnessSkipTitle')")
    expect(src).toContain("t('settings.appearance.harnessSkipNotInstalled')")
    const skipBlock = src.slice(src.indexOf('harnessSkipTitle'))
    expect(skipBlock).not.toContain('SettingsToggle')
    expect(src).not.toMatch(/потом возьмём session-buddy/)
  })
})
