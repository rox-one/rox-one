import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.cloudRuns.maxLlmTokensHint'
const RU_WRAPPED =
  'Жёсткий потолок токенов ввода и вывода (вход+выход) на запуск'
const EN_VALUE = 'Hard cap on prompt+completion tokens per run'

describe('P35-379 leftover Russian prompt+completion wrapping on settings.cloudRuns.maxLlmTokensHint', () => {
  it('wraps leftover prompt+completion as sibling вход+выход, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('вход+выход')
    expect(ru).not.toContain('prompt+completion')
    expect(ru).not.toContain('prompt')
    expect(ru).not.toContain('completion')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('prompt+completion')
    expect(i18n.t(KEY)).not.toContain('вход+выход')
  })
})
