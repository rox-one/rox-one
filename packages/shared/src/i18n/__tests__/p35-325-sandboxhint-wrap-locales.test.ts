import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.cloudRuns.sandboxHint'
const RU_WRAPPED = 'Префикс имени песочницы; id запуска добавляется'
const EN_VALUE = 'Prefix for sandbox names; the run id is appended'

describe('P35-325 leftover Russian ран wrapping on settings.cloudRuns.sandboxHint', () => {
  it('wraps leftover рана as sibling запуск, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('id')
    expect(ru).not.toContain('рана')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
