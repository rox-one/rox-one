import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'knowledge.nav.sectionEmpty'
const LEFTOVER_CALQUE = 'провайдер'

describe('P35-261 leftover Russian провайдер wrapping on knowledge.nav.sectionEmpty', () => {
  it('wraps leftover провайдера знаний as поставщика знаний', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain('поставщика знаний')
    expect(value).not.toContain(KEY)
    expect(value).toBe('Здесь пока пусто — раздел заполнится по мере развития поставщика знаний.')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Nothing here yet — this section fills in as the knowledge provider grows.')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
