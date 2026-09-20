import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cloudRuns.omp'
const RU_WRAPPED = 'Запуск Rox'
const EN_VALUE = 'Rox runner'

describe('P35-332 leftover Russian ран wrapping on cloudRuns.omp', () => {
  it('wraps leftover раннер as sibling запуск, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Rox')
    expect(ru).toContain('Запуск')
    expect(ru).not.toContain('раннер')
    expect(ru).not.toContain('Раннер')
    expect(ru.toLowerCase()).not.toContain('раннер')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
