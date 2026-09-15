import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.input.voiceEnhancementConsent'
const RU_WRAPPED = 'Разрешить облачное улучшение запроса'
const EN_VALUE = 'Allow cloud prompt enhancement'

describe('P35-289 leftover Russian промпта wrapping on settings.input.voiceEnhancementConsent', () => {
  it('wraps leftover промпта as sibling запроса, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('запроса')
    expect(ru.toLowerCase()).not.toContain('промпт')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
