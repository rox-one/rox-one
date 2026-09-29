import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.developer.noHosts'
const RU_WRAPPED = 'Нет запущенных хостов расширений'
const EN_VALUE = 'No extension hosts started'

describe('P35-361 leftover Russian Extension Host wrapping on extensions.developer.noHosts', () => {
  it('wraps leftover Extension Host as sibling хост расширений, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('хостов расширений')
    expect(ru).not.toContain('Extension Host')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('extension hosts')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('хостов расширен')
  })
})
