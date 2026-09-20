import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.cloudRuns.maxLlmTokensHint'
const RU_WRAPPED =
  'Жёсткий потолок токенов ввода и вывода (prompt+completion) на запуск'
const EN_VALUE = 'Hard cap on prompt+completion tokens per run'

describe('P35-323 leftover Russian ран wrapping on settings.cloudRuns.maxLlmTokensHint', () => {
  it('wraps leftover ран as sibling запуск, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('prompt+completion')
    expect(ru.toLowerCase()).not.toContain('ран')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
