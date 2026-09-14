import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import { actions } from '../definitions'

const actionsDir = join(import.meta.dir, '..')
const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')

const EXISTING_LABEL_KEYS = [
  'settings.appearance.workbenchHarnessAgentTeams',
  'settings.import.title',
  'shortcuts.action.clearSelection',
  'shortcuts.action.collectionViewBoard',
  'shortcuts.action.collectionViewHeatmap',
  'shortcuts.action.collectionViewList',
  'shortcuts.action.collectionViewNext',
  'shortcuts.action.collectionViewPrev',
  'shortcuts.action.collectionViewTable',
  'shortcuts.action.cyclePermissionMode',
  'shortcuts.action.focusChat',
  'shortcuts.action.focusNavigator',
  'shortcuts.action.focusNextPanel',
  'shortcuts.action.focusNextZone',
  'shortcuts.action.focusPrevPanel',
  'shortcuts.action.focusSidebar',
  'shortcuts.action.goBack',
  'shortcuts.action.goForward',
  'shortcuts.action.keyboardShortcuts',
  'shortcuts.action.newChat',
  'shortcuts.action.newChatInPanel',
  'shortcuts.action.newWindow',
  'shortcuts.action.nextSearchMatch',
  'shortcuts.action.omnibox',
  'shortcuts.action.prevSearchMatch',
  'shortcuts.action.quit',
  'shortcuts.action.search',
  'shortcuts.action.selectAll',
  'shortcuts.action.settings',
  'shortcuts.action.stopProcessing',
  'shortcuts.action.toggleFocusMode',
  'shortcuts.action.toggleSidebar',
  'shortcuts.action.toggleTheme',
  'workspace.openInEditor',
] as const

const NEW_LABEL_KEYS = [
  'shortcuts.action.advisorReview',
  'shortcuts.action.focusPanelDown',
  'shortcuts.action.focusPanelLeft',
  'shortcuts.action.focusPanelRight',
  'shortcuts.action.focusPanelUp',
  'shortcuts.action.sessionWorkflow',
  'shortcuts.action.simplifyDiff',
] as const

const ENGLISH_LEFTOVER_LABELS = [
  "label: 'New Chat'",
  "label: 'New Chat in Panel'",
  "label: 'Settings'",
  "label: 'Toggle Theme'",
  "label: 'Search'",
  "label: 'Command Palette'",
  "label: 'Keyboard Shortcuts'",
  "label: 'New Window'",
  "label: 'Quit'",
  "label: 'Focus Sidebar'",
  "label: 'Focus Navigator'",
  "label: 'Focus Chat'",
  "label: 'Focus Next Zone'",
  "label: 'Go Back'",
  "label: 'Go Forward'",
  "label: 'Toggle Sidebar'",
  "label: 'Toggle Focus Mode'",
  "label: 'Next collection view'",
  "label: 'Previous collection view'",
  "label: 'Sessions list'",
  "label: 'Sessions board'",
  "label: 'Sessions table'",
  "label: 'Sessions heatmap'",
  "label: 'Select All'",
  "label: 'Clear Selection'",
  "label: 'Focus Next Panel'",
  "label: 'Focus Previous Panel'",
  "label: 'Stop Processing'",
  "label: 'Cycle Permission Mode'",
  "label: 'Next Search Match'",
  "label: 'Previous Search Match'",
  "label: 'Open in Editor'",
  "label: 'Import chats'",
  "label: 'Advisor review'",
  "label: 'Simplify diff'",
  "label: 'Session workflow'",
  "label: 'Agent Teams'",
] as const

function read(rel: string): string {
  return readFileSync(join(actionsDir, rel), 'utf8')
}

describe('action labels are i18n', () => {
  it('definitions store catalog keys and skip English leftover labels', () => {
    const definitions = read('definitions.ts')
    const hook = read('useHotkeyLabel.ts')
    const bootstrap = readFileSync(
      join(actionsDir, '..', 'platform', 'omnibox-bootstrap.ts'),
      'utf8',
    )

    expect(definitions).toContain("labelKey: 'shortcuts.action.newChat'")
    expect(definitions).toContain("labelKey: 'shortcuts.action.omnibox'")
    expect(definitions).toContain("labelKey: 'workspace.openInEditor'")
    expect(definitions).toContain("labelKey: 'settings.import.title'")
    expect(definitions).toContain("labelKey: 'shortcuts.action.advisorReview'")
    expect(definitions).toContain("labelKey: 'shortcuts.action.simplifyDiff'")
    expect(definitions).toContain("labelKey: 'shortcuts.action.sessionWorkflow'")
    expect(definitions).toContain("labelKey: 'settings.appearance.workbenchHarnessAgentTeams'")
    expect(definitions).not.toContain('label:')
    for (const leftover of ENGLISH_LEFTOVER_LABELS) {
      expect(definitions).not.toContain(leftover)
    }

    expect(hook).toContain('t(action.labelKey)')
    expect(hook).not.toContain('action.label,')
    expect(hook).not.toContain('label: action.label')
    expect(bootstrap).toContain('i18n.t(action.labelKey)')
    expect(bootstrap).not.toContain('title: action.label')
  })

  it('every action points at a catalog key', () => {
    const wired = Object.values(actions).map((action) => action.labelKey)
    expect(new Set(wired)).toEqual(new Set([...EXISTING_LABEL_KEYS, ...NEW_LABEL_KEYS]))
  })

  it('English locale keeps the existing action labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('shortcuts.action.newChat')).toBe('New Chat')
    expect(i18n.t('shortcuts.action.omnibox')).toBe('Command Palette')
    expect(i18n.t('shortcuts.action.settings')).toBe('Settings')
    expect(i18n.t('workspace.openInEditor')).toBe('Open in editor')
    expect(i18n.t('settings.import.title')).toBe('Import chats')
    expect(i18n.t('settings.appearance.workbenchHarnessAgentTeams')).toBe('Agent Teams')
    expect(i18n.t('shortcuts.action.advisorReview')).toBe('Advisor review')
    expect(i18n.t('shortcuts.action.sessionWorkflow')).toBe('Session workflow')
    expect(i18n.t('shortcuts.action.simplifyDiff')).toBe('Simplify diff')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('shortcuts.action.newChat')).toBe('Новый чат')
    expect(i18n.t('shortcuts.action.omnibox')).toBe('Палитра команд')
    expect(i18n.t('shortcuts.action.advisorReview')).toBe('Проверка советника')
    expect(i18n.t('shortcuts.action.sessionWorkflow')).toBe('Рабочий процесс сессии')
    expect(i18n.t('shortcuts.action.simplifyDiff')).toBe('Упростить diff')
    expect(i18n.t('shortcuts.action.newChat')).not.toBe('New Chat')
  })

  it('all 12 locales define the wired action label keys', () => {
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
      for (const key of [...EXISTING_LABEL_KEYS, ...NEW_LABEL_KEYS]) {
        expect(locale[key]?.length).toBeGreaterThan(0)
      }
    }
  })
})
