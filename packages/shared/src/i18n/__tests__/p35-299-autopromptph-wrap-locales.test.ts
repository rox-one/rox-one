import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'kanban.column.autoPromptPlaceholder'
const RU_WRAPPED = 'Запрос при переносе карточки сюда…'
const EN_VALUE = 'Prompt sent when a card is dropped here…'

describe('P35-299 leftover Russian промпт wrapping on kanban.column.autoPromptPlaceholder', () => {
  it('wraps leftover промпт as sibling запрос, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toBe('Запрос при переносе карточки сюда…')
    expect(ru.toLowerCase()).not.toContain('промпт')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
