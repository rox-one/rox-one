import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cli.command.vibe.label'
const RU_WRAPPED = 'Творческий сценарий'
const EN_VALUE = 'Vibe'

describe('P35-341 leftover Russian вайб wrapping on cli.command.vibe.label', () => {
  it('wraps leftover вайб as sibling творческий сценарий, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('творческий сценарий')
    expect(ru.toLowerCase()).not.toContain('вайб')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('вайб')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('творческий сценарий')
  })
})
