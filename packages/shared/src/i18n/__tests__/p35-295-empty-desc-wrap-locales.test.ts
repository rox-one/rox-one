import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'automations.emptyDescription'
const RU_WRAPPED =
  'Автоматизации выполняют действия при наступлении событий — запускают команды по расписанию, реагируют на изменения меток или автоматически вызывают запросы.'
const EN_VALUE =
  'Automations run actions when events occur — execute commands on schedules, react to label changes, or trigger prompts automatically.'

describe('P35-295 leftover Russian промпты wrapping on automations.emptyDescription', () => {
  it('wraps leftover промпты as sibling запросы, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('запросы')
    expect(ru.toLowerCase()).not.toContain('промпт')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
