import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const DESCRIPTION = 'onboarding.ompCredential.description' as const
const TEST_FAILED = 'onboarding.ompCredential.testFailed' as const

const EN_DESCRIPTION =
  'The local Rox runtime needs a Rox API key or an existing local model config before the first turn.'
const EN_TEST_FAILED =
  'Rox connection test failed — check the local runtime and its model config'

const RU_DESCRIPTION =
  'Локальному рантайму Rox нужен ключ API Rox или существующую локальную конфигурацию моделей до первого хода.'
const RU_TEST_FAILED =
  'Проверка подключения Rox не удалась — проверьте локальный рантайм и его конфигурацию моделей'

const KEYS = [DESCRIPTION, TEST_FAILED] as const
const EN_VALUES = [EN_DESCRIPTION, EN_TEST_FAILED] as const
const RU_VALUES = [RU_DESCRIPTION, RU_TEST_FAILED] as const

const LEFTOVER_KONFIG = /(^|[^а-яёА-ЯЁ])конфиг(?![а-яёА-ЯЁ])/

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover Russian конфиг wrapping in ru onboarding ompCredential copy', () => {
  it('keeps English catalog copy unchanged', () => {
    for (const [i, key] of KEYS.entries()) {
      expect(en[key]).toBe(EN_VALUES[i])
      expect(en[key]).toContain('config')
    }
  })

  it('wraps leftover конфиг as sibling конфигурацию on the same family', () => {
    for (const [i, key] of KEYS.entries()) {
      expect(ru[key]).toBe(RU_VALUES[i])
      expect(ru[key]).not.toMatch(LEFTOVER_KONFIG)
      expect(ru[key]).toContain('конфигурацию')
      expect(ru[key]).toContain('рантайм')
      expect(ru[key]).not.toBe(en[key])
    }
  })

  it("resolves Russian through setupI18n without leftover calque конфиг", async () => {
    await setupI18n().changeLanguage('ru')
    for (const [i, key] of KEYS.entries()) {
      expect(i18n.t(key)).toBe(RU_VALUES[i])
      expect(i18n.t(key)).not.toBe(EN_VALUES[i])
      expect(i18n.t(key)).not.toMatch(LEFTOVER_KONFIG)
      expect(i18n.t(key)).toContain('конфигурацию')
    }
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    for (const [i, key] of KEYS.entries()) {
      expect(i18n.t(key)).toBe(EN_VALUES[i])
      expect(i18n.t(key)).toContain('config')
      expect(i18n.t(key)).not.toContain('конфигурацию')
    }
  })
})
