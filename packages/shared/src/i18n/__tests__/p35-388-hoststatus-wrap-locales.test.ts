import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.developer.hostStatus'
const RU_WRAPPED = 'Статус хоста расширений'
const EN_VALUE = 'Host status'

describe('P35-388 leftover Russian хост wrapping on extensions.developer.hostStatus', () => {
  it('wraps leftover хоста as sibling хоста расширений, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('хоста расширений')
    expect(ru).not.toBe('Статус хоста')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Host')
    expect(i18n.t(KEY)).not.toContain('хоста расширений')
  })
})
