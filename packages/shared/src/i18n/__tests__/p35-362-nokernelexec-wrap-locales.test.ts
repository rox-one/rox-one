import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.host.noKernelExec'
const RU_WRAPPED = 'Плагины Rox Notes выполняются в рантайме Rox Notes, не в хосте расширений'
const EN_VALUE = 'Rox Notes plugins run inside Rox Notes runtime, not Extension Host'

describe('P35-362 leftover Russian Extension Host wrapping on extensions.host.noKernelExec', () => {
  it('wraps leftover Extension Host as sibling хост расширений, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('хосте расширений')
    expect(ru).toContain('рантайме')
    expect(ru).toContain('Rox Notes')
    expect(ru).not.toContain('Extension Host')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Extension Host')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('хосте расширен')
  })
})
