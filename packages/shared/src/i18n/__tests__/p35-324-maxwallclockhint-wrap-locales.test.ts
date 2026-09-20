import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.cloudRuns.maxWallClockHint'
const RU_WRAPPED =
  'Бюджет реального времени запуска; watchdog убьёт запуск по превышении'
const EN_VALUE = 'Wall-clock budget per run; watchdog kills the run past it'

describe('P35-324 leftover Russian ран wrapping on settings.cloudRuns.maxWallClockHint', () => {
  it('wraps leftover рана/ран as sibling запуск, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('watchdog')
    expect(ru.toLowerCase()).not.toContain('ран')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
