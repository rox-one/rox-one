import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')

const KEYS = [
  'onboarding.apiSetup.description',
  'settings.runtime.description',
  'settings.runtime.llmEmpty',
] as const

const RU: Record<(typeof KEYS)[number], string> = {
  'onboarding.apiSetup.description':
    'Выберите, от чего будут работать ваши ИИ-агенты. Дополнительные подключения можно добавить позже.',
  'settings.runtime.description': 'ИИ-рантайм, уровень размышлений и консольные инструменты',
  'settings.runtime.llmEmpty': 'Пока нет LLM-подключений. Добавьте в настройках ИИ.',
}

const LEFTOVER_RU: Record<(typeof KEYS)[number], string> = {
  'onboarding.apiSetup.description':
    'Выберите, от чего будут работать ваши AI-агенты. Дополнительные подключения можно добавить позже.',
  'settings.runtime.description': 'AI-рантайм, уровень размышлений и консольные инструменты',
  'settings.runtime.llmEmpty': 'Пока нет LLM-подключений. Добавьте в настройках AI.',
}

const EN: Record<(typeof KEYS)[number], string> = {
  'onboarding.apiSetup.description':
    "Select how you'd like to power your AI agents. You can add more connections later.",
  'settings.runtime.description': 'AI runtime, thinking level, and command-line tools',
  'settings.runtime.llmEmpty': 'No LLM connections yet. Add one in AI settings.',
}

describe('P35-194 leftover AI wrapping in ru.json', () => {
  it('wraps leftover English AI as ИИ and keeps LLM Latin', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    for (const key of KEYS) {
      expect(ru[key]).toBe(RU[key])
      expect(ru[key]).toContain('ИИ')
      expect(ru[key]).not.toMatch(/\bAI\b/)
      expect(ru[key]).not.toBe(LEFTOVER_RU[key])
      expect(ru[key]).not.toBe(EN[key])
    }
    expect(ru['settings.runtime.llmEmpty']).toContain('LLM')
  })

  it('keeps English AI copy as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.resolvedLanguage).toBe('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(EN[key])
      expect(i18n.t(key)).toMatch(/\bAI\b/)
      expect(i18n.t(key)).not.toContain('ИИ')
    }
    expect(i18n.t('settings.runtime.llmEmpty')).toContain('LLM')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.resolvedLanguage).toBe('ru')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(RU[key])
      expect(i18n.t(key)).not.toBe(LEFTOVER_RU[key])
      expect(i18n.t(key)).not.toBe(EN[key])
      expect(i18n.t(key)).not.toBe(i18n.t(key, { lng: 'en' }))
    }

    await setupI18n().changeLanguage('en')
    expect(i18n.resolvedLanguage).toBe('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(EN[key])
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
      }
    }
  })
})
