import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.appearance.workbenchHarnessChatChromeDesc'
const RU_WRAPPED =
  'История запросов, прогресс хода и стоимость в статусе. По умолчанию включено.'
const EN_VALUE =
  'Prompt history, turn progress, and session cost in the status area. On by default.'

describe('P35-310 leftover Russian промпт wrapping on settings.appearance.workbenchHarnessChatChromeDesc', () => {
  it('wraps leftover промпт as sibling запрос, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).not.toContain('промпт')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
