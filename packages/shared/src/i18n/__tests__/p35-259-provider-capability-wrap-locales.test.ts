import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'calendar.capability'
const LEFTOVER_CALQUE = 'провайдер'

describe('P35-259 leftover Russian провайдер wrapping on calendar.capability', () => {
  it('wraps leftover провайдера as поставщика', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain('поставщика')
    expect(value).not.toContain('calendar.capability')
    expect(value).toBe('Ограничения поставщика')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Provider limits')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
