import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.registries.title'
const LEFTOVER_CALQUE = 'провайдер'

describe('P35-265 leftover Russian Провайдеры wrapping on extensions.registries.title', () => {
  it('wraps leftover Провайдеры каталога as Поставщики каталога', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toBe('Поставщики каталога')
    expect(value).not.toContain(KEY)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Catalog providers')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
