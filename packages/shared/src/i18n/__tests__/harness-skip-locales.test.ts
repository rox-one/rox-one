import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'settings.appearance.harnessSkip.extraAutomationRuntime',
  'settings.appearance.harnessSkip.extraAutomationRuntimeDesc',
  'settings.appearance.harnessSkip.mnemon',
  'settings.appearance.harnessSkip.mnemonDesc',
  'settings.appearance.harnessSkip.pluginHotReloadDesc',
  'settings.appearance.harnessSkip.remoteControlCompat',
  'settings.appearance.harnessSkip.searchCliPluginDesc',
  'settings.appearance.harnessSkip.visionCliPluginDesc',
  'settings.appearance.harnessSkipDesc',
] as const

const EN: Record<(typeof keys)[number], string> = {
  'settings.appearance.harnessSkip.extraAutomationRuntime': 'Extra automation runtime',
  'settings.appearance.harnessSkip.extraAutomationRuntimeDesc': 'Automations are already first-party.',
  'settings.appearance.harnessSkip.mnemon': 'Extra memory runtime',
  'settings.appearance.harnessSkip.mnemonDesc':
    'Memory already lives in Rox. We will not add another memory host.',
  'settings.appearance.harnessSkip.pluginHotReloadDesc':
    'Flags and RPC refresh are the hot path. No plugin HMR runtime.',
  'settings.appearance.harnessSkip.remoteControlCompat': 'Remote-control compatibility',
  'settings.appearance.harnessSkip.searchCliPluginDesc':
    'Use MCP or API sources. Do not embed search keys.',
  'settings.appearance.harnessSkip.visionCliPluginDesc':
    'Vision models and the browser tool already cover this.',
  'settings.appearance.harnessSkipDesc': 'These runtimes stay out of Rox. The list is frozen.',
}

const RU: Record<(typeof keys)[number], string> = {
  'settings.appearance.harnessSkip.extraAutomationRuntime': 'Отдельный рантайм автоматизаций',
  'settings.appearance.harnessSkip.extraAutomationRuntimeDesc': 'Автоматизации уже встроены.',
  'settings.appearance.harnessSkip.mnemon': 'Отдельный рантайм памяти',
  'settings.appearance.harnessSkip.mnemonDesc': 'Память уже в Rox. Второй хост памяти не ставим.',
  'settings.appearance.harnessSkip.pluginHotReloadDesc':
    'Горячий путь — флаги и RPC. Отдельный рантайм горячей перезагрузки не ставим.',
  'settings.appearance.harnessSkip.remoteControlCompat': 'Совместимость удалённого управления',
  'settings.appearance.harnessSkip.searchCliPluginDesc':
    'Используй источники MCP/API. Ключи поиска не вшиваем.',
  'settings.appearance.harnessSkip.visionCliPluginDesc':
    'Модели зрения и инструмент браузера уже покрывают это.',
  'settings.appearance.harnessSkipDesc': 'Эти рантаймы в Rox не входят. Список заморожен.',
}

describe('appearance harnessSkip leftover chrome locales', () => {
  it('keeps Russian copy distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBe(EN[key])
      expect(ru[key], key).toBe(RU[key])
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['settings.appearance.harnessSkip.extraAutomationRuntimeDesc']).not.toContain('first-party')
    expect(ru['settings.appearance.harnessSkip.extraAutomationRuntime']).not.toContain('runtime')
    expect(ru['settings.appearance.harnessSkip.mnemon']).not.toContain('runtime')
    expect(ru['settings.appearance.harnessSkip.mnemonDesc']).not.toContain('host')
    expect(ru['settings.appearance.harnessSkip.pluginHotReloadDesc']).not.toContain('HMR')
    expect(ru['settings.appearance.harnessSkip.remoteControlCompat']).not.toContain('remote-control')
    expect(ru['settings.appearance.harnessSkip.searchCliPluginDesc']).not.toContain('sources')
    expect(ru['settings.appearance.harnessSkip.visionCliPluginDesc']).not.toContain('Vision')
    expect(ru['settings.appearance.harnessSkip.visionCliPluginDesc']).not.toContain('browser_tool')
    expect(ru['settings.appearance.harnessSkipDesc']).not.toContain('runtime')
  })

  it('setupI18n ru is not English; en stays English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(RU[key])
      expect(i18n.t(key)).not.toBe(EN[key])
    }
    expect(i18n.t('settings.appearance.harnessSkip.extraAutomationRuntimeDesc')).not.toContain('OMP')
    expect(i18n.t('settings.appearance.harnessSkip.extraAutomationRuntimeDesc')).not.toContain(
      'oh-my-pi',
    )
    expect(i18n.t('settings.appearance.harnessSkipDesc')).not.toContain('Craft Agents')
    expect(i18n.t('settings.appearance.harnessSkip.visionCliPluginDesc')).not.toContain('Vercel')

    await setupI18n().changeLanguage('en')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(EN[key])
    }
  })
})
