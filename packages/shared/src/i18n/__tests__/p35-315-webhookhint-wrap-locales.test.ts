import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.cloudRuns.webhookHint'
const RU_WRAPPED = 'Необязательный URL — POST при завершении рана (уведомления вне приложения)'
const EN_VALUE = 'Optional URL — POSTed once when a run finishes (works for out-of-app notifications)'

describe('P35-315 leftover Russian опциональный wrapping on settings.cloudRuns.webhookHint', () => {
  it('wraps leftover опциональный as sibling необязательный, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).not.toContain('опциональн')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
