import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cloudRuns.usageHint'
const RU_WRAPPED = 'LLM-токены (вход+выход) · время работы запуска'
const EN_VALUE = 'LLM tokens (prompt+completion) · runner wall time'

describe('P35-330 leftover Russian ран wrapping on cloudRuns.usageHint', () => {
  it('wraps leftover раннера as sibling запуск, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('LLM')
    expect(ru).toContain('запуск')
    expect(ru).not.toContain('раннер')
    expect(ru.toLowerCase()).not.toContain('раннер')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
