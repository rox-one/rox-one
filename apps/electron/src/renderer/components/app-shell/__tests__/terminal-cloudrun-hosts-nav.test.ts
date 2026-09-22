import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const mainContentSource = readFileSync(join(__dirname, '../MainContentPanel.tsx'), 'utf8')
const navContextSource = readFileSync(
  join(__dirname, '../../../contexts/NavigationContext.tsx'),
  'utf8',
)
const terminalPage = readFileSync(
  join(__dirname, '../../../pages/TerminalSurfacePage.tsx'),
  'utf8',
)
const cloudRunPage = readFileSync(
  join(__dirname, '../../../pages/CloudRunSurfacePage.tsx'),
  'utf8',
)
const localesDir = join(__dirname, '../../../../../../../packages/shared/src/i18n/locales')

const SURFACE_KEYS = [
  'terminal.surface.noTerminalSelected',
  'terminal.surface.openDock',
  'terminal.surface.useDockHint',
  'cloudRuns.surface.noRunSelected',
  'cloudRuns.surface.unavailable',
  'cloudRuns.surface.notFound',
  'cloudRuns.surface.openSettings',
  'cloudRuns.surface.useChipHint',
  'cloudRuns.surface.openSession',
] as const

describe('MainContentPanel terminal + cloud-run hosts (#571)', () => {
  it('wires isTerminalNavigation / isCloudRunNavigation to dedicated surface pages', () => {
    expect(mainContentSource).toContain('isTerminalNavigation')
    expect(mainContentSource).toContain('isCloudRunNavigation')
    expect(mainContentSource).toContain('TerminalSurfacePage')
    expect(mainContentSource).toContain('CloudRunSurfacePage')
    expect(navContextSource).toContain('isTerminalNavigation')
  })

  it('never mute-falls terminal/cloud-run through to session.selectConversation', () => {
    const terminalIdx = mainContentSource.indexOf('isTerminalNavigation(navState)')
    const cloudIdx = mainContentSource.indexOf('isCloudRunNavigation(navState)')
    const fallbackIdx = mainContentSource.lastIndexOf('session.selectConversation')
    expect(terminalIdx).toBeGreaterThan(0)
    expect(cloudIdx).toBeGreaterThan(0)
    expect(fallbackIdx).toBeGreaterThan(cloudIdx)
    expect(fallbackIdx).toBeGreaterThan(terminalIdx)
  })

  it('leaves browser/extension hosts intact', () => {
    expect(mainContentSource).toContain('isBrowserNavigation')
    expect(mainContentSource).toContain('BrowserPanelPage')
    expect(mainContentSource).toContain('isExtensionNavigation')
    expect(mainContentSource).toContain('ExtensionSurfacePage')
    expect(mainContentSource).toContain("t('browser.noInstanceSelected')")
    expect(mainContentSource).toContain("t('extensions.surface.noViewSelected')")
  })

  it('terminal host uses InspectorTerminal or honest empty + dock path', () => {
    expect(terminalPage).toContain('InspectorTerminal')
    expect(terminalPage).toContain('bottomTerminalOpenAtom')
    expect(terminalPage).toContain("t('terminal.surface.noTerminalSelected')")
    expect(terminalPage).toContain("t('terminal.surface.openDock')")
    expect(terminalPage).toContain("data-testid=\"terminal-surface-host\"")
    expect(terminalPage).toContain("data-testid=\"terminal-surface-empty\"")
  })

  it('cloud-run host loads run status or honest unavailable + settings path', () => {
    expect(cloudRunPage).toContain('listCloudRuns')
    expect(cloudRunPage).toContain('getCloudRunsConfig')
    expect(cloudRunPage).toContain("t('cloudRuns.surface.unavailable')")
    expect(cloudRunPage).toContain("t('cloudRuns.surface.openSettings')")
    expect(cloudRunPage).toContain("settings('cloudRuns')")
    expect(cloudRunPage).toContain("data-testid=\"cloud-run-surface-host\"")
  })

  it('English and Russian locales keep distinct surface copy', () => {
    const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(en['terminal.surface.noTerminalSelected']).toBe('No terminal selected')
    expect(ru['terminal.surface.noTerminalSelected']).toBe('Терминал не выбран')
    expect(ru['terminal.surface.noTerminalSelected']).not.toBe(en['terminal.surface.noTerminalSelected'])
    expect(en['cloudRuns.surface.unavailable']).toBe('Cloud Runs surface is unavailable')
    expect(ru['cloudRuns.surface.unavailable']).toBe('Поверхность Cloud Runs недоступна')
  })

  it('all 12 locales define the wired surface keys', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([
      'ar.json',
      'de.json',
      'en.json',
      'es.json',
      'fr.json',
      'hu.json',
      'ja.json',
      'ko.json',
      'pl.json',
      'ru.json',
      'zh-Hans.json',
      'zh-Hant.json',
    ])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of SURFACE_KEYS) {
        expect(locale[key]?.length ?? 0).toBeGreaterThan(0)
      }
    }
  })
})
