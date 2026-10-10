import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'entityView.playbookHoles'
// Wave В4 renamed this copy to task fan-outs; the guard's contract stays:
// Russian must carry the current term and never the legacy «плейбук» phonetics.
const RU_WRAPPED = 'Веера задач'
const EN_VALUE = 'Task fan-outs'

describe('P35-354 no legacy плейбук wording on entityView.playbookHoles', () => {
  it('serves the current Russian fan-out copy, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('веер')
    expect(ru.toLowerCase()).not.toContain('плейбук')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('плейбук')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('веер')
  })
})