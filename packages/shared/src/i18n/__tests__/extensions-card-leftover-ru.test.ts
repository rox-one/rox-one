import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const localesDir = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const KEYS = {
  'extensions.card.noPermissions': { en: 'No permissions', ru: 'Нет разрешений' },
  'extensions.card.permissions': { en: 'Permissions', ru: 'Разрешения' },
  'extensions.card.readOnly': { en: 'projection', ru: 'Только чтение' },
  'extensions.card.runtime': { en: 'Runtime', ru: 'Рантайм' },
  'extensions.card.worksIn': { en: 'Works in', ru: 'Работает в' },
  'extensions.installTarget.global': { en: 'Global', ru: 'Глобально' },
  'extensions.installTarget.project': { en: 'Project', ru: 'Проект' },
  'extensions.installTarget.workspace': { en: 'Workspace', ru: 'Рабочая область' },
} as const

describe('P35-111 leftover extensions card chrome', () => {
  it('English locale keeps leftover English wording', async () => {
    await setupI18n().changeLanguage('en')
    for (const [key, expected] of Object.entries(KEYS)) {
      expect(i18n.t(key)).toBe(expected.en)
      expect(en[key]).toBe(expected.en)
    }
  })

  it('Russian copy is not leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const [key, expected] of Object.entries(KEYS)) {
      expect(i18n.t(key)).toBe(expected.ru)
      expect(i18n.t(key)).not.toBe(expected.en)
      expect(ru[key]).toBe(expected.ru)
      expect(ru[key]).not.toBe(en[key])
      expect(ru[key]).not.toBe(expected.en)
    }
  })
})
