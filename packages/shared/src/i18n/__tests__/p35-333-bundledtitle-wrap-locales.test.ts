import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.context.bundledTitle'
const RU_WRAPPED = 'Шаблон-пакеты навыков'
const EN_VALUE = 'Preset skill packs'

describe('P35-333 leftover Russian пресет wrapping on settings.context.bundledTitle', () => {
  it('wraps leftover пресет as sibling шаблон, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Шаблон')
    expect(ru).toContain('навыков')
    expect(ru.toLowerCase()).not.toContain('пресет')
    expect(ru.toLowerCase()).not.toContain('скилл')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('пресет')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('шаблон')
  })
})
