import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.runtime.craft-sandbox.hint'
const RU_WRAPPED = 'Хост расширений utilityProcess (в песочнице)'
const EN_VALUE = 'Extension Host utilityProcess (sandboxed)'

describe('P35-363 leftover Russian Extension Host wrapping on extensions.runtime.craft-sandbox.hint', () => {
  it('wraps leftover Extension Host as sibling хост расширений, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Хост расширений')
    expect(ru).toContain('utilityProcess')
    expect(ru).not.toContain('Extension Host')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Extension Host')
    expect(i18n.t(KEY)).toContain('utilityProcess')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('хост расширен')
  })
})
