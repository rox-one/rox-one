import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const SLICE_KEYS = [
  'settings.runtime.secretAdd',
  'settings.runtime.secretRefPlaceholder',
] as const

describe('P35-163 leftover wrapping in settings.runtime.secretAdd / secretRefPlaceholder', () => {
  it('Russian wrapping around Latin secretRef; leftover secret ref / bare ref wrapping gone', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')

    expect(i18n.t('settings.runtime.secretAdd')).toBe('Добавить secretRef')
    expect(i18n.t('settings.runtime.secretRefPlaceholder')).toBe('secretRef (необязательно)')

    for (const key of SLICE_KEYS) {
      const value = i18n.t(key)
      expect(value, key).toContain('secretRef')
      expect(value, key).not.toContain('секретРеф')
      expect(value, key).not.toMatch(/secret ref/)
      expect(value, key).not.toMatch(/(^|[^A-Za-z])ref([^A-Za-z]|$)/)
      expect(value, key).not.toBe(key)
    }
  })

  it('English catalog still uses leftover wrapping secret ref / ref', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')

    expect(i18n.t('settings.runtime.secretAdd')).toBe('Add secret ref')
    expect(i18n.t('settings.runtime.secretRefPlaceholder')).toBe('ref (optional)')
  })
})
