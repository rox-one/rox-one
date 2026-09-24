import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.developer.allHosts'
const RU_WRAPPED = 'Все хосты расширений'
const EN_VALUE = 'All hosts'

describe('P35-384 leftover Russian хост wrapping on extensions.developer.allHosts', () => {
  it('wraps leftover хост as sibling хосты расширений, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('хосты расширений')
    expect(ru).not.toBe('Все хосты')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('hosts')
    expect(i18n.t(KEY)).not.toContain('хосты расширений')
  })
})
