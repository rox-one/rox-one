import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const settingsDir = join(__dirname, '..')
const overviewSrc = readFileSync(join(settingsDir, 'SettingsOverviewPage.tsx'), 'utf8')
const navigatorSrc = readFileSync(join(settingsDir, 'SettingsNavigator.tsx'), 'utf8')
const panelSrc = readFileSync(
  join(__dirname, '../../../components/app-shell/MainContentPanel.tsx'),
  'utf8',
)

describe('settings command center presentation', () => {
  it('routes the bare settings page to Overview instead of an App fallback', () => {
    expect(panelSrc).toContain("import { SettingsOverviewPage } from '@/pages/settings/SettingsOverviewPage'")
    expect(panelSrc).toContain('navState.subpage === null')
    expect(panelSrc).toContain('<SettingsOverviewPage />')
    expect(panelSrc).not.toContain("?? 'app'")
    expect(panelSrc).not.toContain("?? 'account'")
    expect(panelSrc).toContain('recordRecentSetting(activeWorkspaceId, navState.subpage, { signal: controller.signal })')
  })

  it('keeps overview actions on existing settings routes', () => {
    expect(overviewSrc).toContain('navigate(routes.view.settings(subpage))')
    expect(overviewSrc).toContain("'runtime'")
    expect(overviewSrc).toContain("'ai'")
    expect(overviewSrc).toContain("'permissions'")
    expect(overviewSrc).toContain("'marketplace'")
    expect(overviewSrc).toContain("'accounts'")
    expect(overviewSrc).toContain("'appearance'")
    expect(overviewSrc).toContain("'shortcuts'")
    expect(overviewSrc).toContain('data-testid="settings-overview"')
    expect(overviewSrc).toContain('data-testid={`settings-quick-${id}`}')
    expect(overviewSrc).toContain('data-testid="settings-recent"')
    expect(overviewSrc).toContain('data-testid={`settings-recent-${id}`}')
    expect(overviewSrc).toContain('t(page.labelKey)')
    expect(overviewSrc).not.toContain("settings.overview.runtime")
    expect(overviewSrc).not.toContain("id === 'runtime'")
  })

  it('groups and searches navigator rows without changing the selection contract', () => {
    expect(navigatorSrc).toContain('filterSettingsPages')
    expect(navigatorSrc).toContain('groupSettingsPages')
    expect(navigatorSrc).toContain("t('settings.navigator.search')")
    expect(navigatorSrc).toContain("t('settings.navigator.clearSearch')")
    expect(navigatorSrc).toContain("t('settings.navigator.noResults', { query })")
    expect(navigatorSrc).toContain('onSelectSubpage(item.id)')
    expect(navigatorSrc).toContain('data-testid="settings-navigator-search"')
    expect(navigatorSrc).toContain('data-testid="settings-navigator-clear"')
    expect(navigatorSrc).toContain('data-testid="settings-navigator-empty"')
  })

  it('starts Tailwind utility generation in the renderer CSS entry', () => {
    const css = readFileSync(join(__dirname, '../../../index.css'), 'utf8')
    expect(css).toContain('@import "tailwindcss" source(none)')
    expect(css).toContain('@import "@craft-agent/ui/styles"')
  })

  it('labels the bare settings home as Overview hub (not a second Settings title)', () => {
    expect(overviewSrc).toContain("t('settings.overview.title'")
    expect(overviewSrc).toContain("t('settings.overview.subtitle'")
    expect(overviewSrc).toContain('data-testid="settings-overview-subtitle"')
    expect(overviewSrc).not.toContain("title={t('sidebar.settings')}")
  })
})
