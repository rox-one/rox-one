import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.cloudRuns.providerHint'
const RU_WRAPPED = 'Daytona — облачный запуск; локальный и нативный sidecar остаются на этой машине'
const EN_VALUE = 'Daytona is the cloud runner; local and native stay on this machine'

describe('P35-331 leftover Russian ран wrapping on settings.cloudRuns.providerHint', () => {
  it('wraps leftover раннер as sibling запуск, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Daytona')
    expect(ru).toContain('sidecar')
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
