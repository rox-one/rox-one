import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.developer.hostStart'
const RU_WRAPPED = 'Запустить хост расширений'
const EN_VALUE = 'Start host'

describe('P35-386 leftover Russian хост wrapping on extensions.developer.hostStart', () => {
  it('wraps leftover хост as sibling хост расширений, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('хост расширений')
    expect(ru).not.toBe('Запустить хост')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('host')
    expect(i18n.t(KEY)).not.toContain('хост расширений')
  })
})
