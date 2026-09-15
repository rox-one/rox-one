import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'toast.branchSameProvider'
const LEFTOVER_CALQUE = 'провайдер'

describe('P35-267 leftover Russian провайдера wrapping on toast.branchSameProvider', () => {
  it('wraps leftover одного провайдера as одного поставщика', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toBe('Ветвление доступно только внутри одного поставщика. Переключите подключение этой панели и повторите попытку.')
    expect(value).not.toContain(KEY)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Branching is only supported within the same provider. Switch this panel connection and try again.')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
