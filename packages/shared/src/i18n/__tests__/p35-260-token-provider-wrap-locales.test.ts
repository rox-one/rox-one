import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.cloudRuns.token'
const LEFTOVER_CALQUE = 'провайдер'

describe('P35-260 leftover Russian провайдер wrapping on settings.cloudRuns.token', () => {
  it('wraps leftover провайдера as поставщика', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain('поставщика')
    expect(value).not.toContain('settings.cloudRuns.token')
    expect(value).toBe('Токен поставщика')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Provider token')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
