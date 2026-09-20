import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'projectInfo.detailsHelpText'
const RU_WRAPPED =
  'Произвольный текст, добавляемый в системный запрос агента, когда сессия привязана к этому проекту.'
const EN_VALUE =
  "Free-form text injected into the agent's system prompt whenever a session is bound to this project."

describe('P35-306 leftover Russian промпт wrapping on projectInfo.detailsHelpText', () => {
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
