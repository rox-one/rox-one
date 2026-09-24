import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.developer.hostStop'
const RU_WRAPPED = 'Остановить хост расширений'
const EN_VALUE = 'Stop host'

describe('P35-387 leftover Russian хост wrapping on extensions.developer.hostStop', () => {
  it('wraps leftover хост as sibling хост расширений, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('хост расширений')
    expect(ru).not.toBe('Остановить хост')

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
