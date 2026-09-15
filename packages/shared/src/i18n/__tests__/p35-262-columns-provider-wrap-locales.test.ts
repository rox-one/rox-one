import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'connections.credentials.columns.provider'
const LEFTOVER_CALQUE = 'провайдер'

describe('P35-262 leftover Russian Провайдер wrapping on connections.credentials.columns.provider', () => {
  it('wraps leftover column header Провайдер as Поставщик', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toBe('Поставщик')
    expect(value).not.toContain(KEY)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Provider')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
