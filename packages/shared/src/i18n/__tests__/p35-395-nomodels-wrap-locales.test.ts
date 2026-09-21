import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'errors.omp.noModels.message'
const RU_WRAPPED =
  'В среде Rox нет поставщиков моделей. Перед первым ходом нужен API-ключ Rox (ROX_API_KEY) или локальный файл models.yml.'
const EN_VALUE =
  'The Rox runtime has no model providers. A Rox API key (ROX_API_KEY) or a local models.yml is required before the first turn.'

describe('P35-395 leftover calque провайдер wrapping on errors.omp.noModels.message', () => {
  it('wraps leftover провайдеров as поставщиков, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('поставщиков моделей')
    expect(ru).not.toContain('провайдер')
    expect(ru.toLowerCase()).not.toContain('провайдер')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
