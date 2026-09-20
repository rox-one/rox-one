import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'knowledge.local.aiPrompts'
const RU_WRAPPED = 'Запросы ИИ для заметок'
const EN_VALUE = 'Note AI prompts'

describe('P35-300 leftover Russian промпты wrapping on knowledge.local.aiPrompts', () => {
  it('wraps leftover Промпты as sibling Запросы, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toBe('Запросы ИИ для заметок')
    expect(ru.toLowerCase()).not.toContain('промпт')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
