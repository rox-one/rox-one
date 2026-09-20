import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.context.bundledTitle'
const RU_WRAPPED = 'Пресет-пакеты навыков'
const EN_VALUE = 'Preset skill packs'

describe('P35-313 leftover Russian скилл wrapping on settings.context.bundledTitle', () => {
  it('wraps leftover скиллов as sibling навыков, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).not.toContain('скилл')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
