import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.appearance.conationShellDesc'
const RU_WRAPPED = 'Необязательные панели данных Conation в Rox. Все выключены по умолчанию; режима Timeline нет.'
const EN_VALUE = 'Opt-in Conation data-plane panes in Rox. All off by default; no Timeline mode.'

describe('P35-316 leftover Russian опциональный wrapping on settings.appearance.conationShellDesc', () => {
  it('wraps leftover опциональный as sibling необязательный, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).not.toContain('опциональн')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
