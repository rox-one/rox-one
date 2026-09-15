import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')

const KEYS = [
  'settings.messaging.telegram.supergroup.autoTopicNote',
  'settings.messaging.telegram.supergroup.noTopicsHint',
] as const

const RU = {
  'settings.messaging.telegram.supergroup.autoTopicNote':
    'Автоматизации с заданным параметром telegramTopic будут публиковать в соответствующие темы здесь (создаются при первом использовании).',
  'settings.messaging.telegram.supergroup.noTopicsHint':
    'Темы ещё не привязаны — автоматизации с параметром telegramTopic создадут их.',
} as const

const EN = {
  'settings.messaging.telegram.supergroup.autoTopicNote':
    "Automations with a 'telegramTopic' set will post into matching topics here (created on first use).",
  'settings.messaging.telegram.supergroup.noTopicsHint':
    'No topics bound yet — automations with `telegramTopic` will create them.',
} as const

const LEFTOVER_RU = {
  'settings.messaging.telegram.supergroup.autoTopicNote':
    "Автоматизации с заданным 'telegramTopic' будут публиковать в соответствующие темы здесь (создаются при первом использовании).",
  'settings.messaging.telegram.supergroup.noTopicsHint':
    'Темы ещё не привязаны — автоматизации с `telegramTopic` создадут их.',
} as const

describe('P35-192 leftover telegramTopic wrapping in telegram supergroup copy', () => {
  it('wraps leftover telegramTopic as параметром around the Latin identifier', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    for (const key of KEYS) {
      expect(ru[key], key).toBe(RU[key])
      expect(ru[key], key).toContain('параметром telegramTopic')
      expect(ru[key], key).toContain('telegramTopic')
      expect(ru[key], key).not.toBe(LEFTOVER_RU[key])
      expect(ru[key], key).not.toMatch(/'telegramTopic'|`telegramTopic`/)
    }
  })

  it('keeps English telegramTopic as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.resolvedLanguage).toBe('en')
    for (const key of KEYS) {
      expect(i18n.t(key), key).toBe(EN[key])
      expect(i18n.t(key), key).toContain('telegramTopic')
      expect(i18n.t(key), key).not.toContain('параметром')
    }
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.resolvedLanguage).toBe('ru')
    for (const key of KEYS) {
      expect(i18n.t(key), key).toBe(RU[key])
      expect(i18n.t(key), key).not.toBe(LEFTOVER_RU[key])
      expect(i18n.t(key), key).not.toBe(EN[key])
      expect(i18n.t(key), key).not.toBe(i18n.t(key, { lng: 'en' }))
    }

    await setupI18n().changeLanguage('en')
    expect(i18n.resolvedLanguage).toBe('en')
    for (const key of KEYS) {
      expect(i18n.t(key), key).toBe(EN[key])
    }

    await setupI18n().changeLanguage('ru')
  })

  it('defines the keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
        expect(locale[key], `${file} ${key}`).toContain('telegramTopic')
      }
    }
  })
})
