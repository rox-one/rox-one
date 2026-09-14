import { describe, expect, it } from 'bun:test'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEYS = [
  'settings.context.bundledDesc',
  'settings.context.bundledEmpty',
  'settings.context.memoryDesc',
  'settings.context.projectOverrideActive',
] as const

const ENGLISH = {
  'settings.context.bundledDesc':
    'Shipped with the app into ~/.agents/skills. Disable skips future sync; files on disk are kept.',
  'settings.context.bundledEmpty': 'No bundled skill packs found in this build.',
  'settings.context.memoryDesc': 'Self-learning lessons and project memory used by agents.',
  'settings.context.projectOverrideActive':
    'Project file {{filename}} overrides the global document for sessions in this workspace.',
} as const

const RUSSIAN = {
  'settings.context.bundledDesc':
    'Поставляются с приложением в ~/.agents/skills. Отключение пропускает будущую синхронизацию; файлы на диске остаются.',
  'settings.context.bundledEmpty': 'В этой сборке нет пресет-пакетов скиллов.',
  'settings.context.memoryDesc': 'Уроки самообучения и память проекта, которые видит агент.',
  'settings.context.projectOverrideActive':
    'Проектный файл {{filename}} переопределяет глобальный документ для сессий в этой рабочей области.',
} as const

describe('settings.context leftover chrome locales', () => {
  it('keeps English copy for leftover context strings', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(ENGLISH[key])
    }
  })

  it('resolves Russian copy distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(RUSSIAN[key])
      expect(i18n.t(key)).not.toBe(ENGLISH[key])
    }
    expect(i18n.t('settings.context.bundledEmpty')).not.toContain('bundled skill packs')
    expect(i18n.t('settings.context.memoryDesc')).not.toContain('project memory')
    expect(i18n.t('settings.context.bundledDesc')).not.toContain('будущий sync')
    expect(i18n.t('settings.context.projectOverrideActive')).not.toContain('workspace')
  })
})
