import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'projectsList.emptyDescription'
const RU_WRAPPED =
  'Группируйте сессии, ресурсы и контекст в проекты. Настройки каждого проекта — рабочая директория, детали и ресурсы — автоматически добавляются в системный запрос агента.'
const EN_VALUE =
  "Group sessions, assets, and project context into Projects. Each project's settings — working directory, details, and assets — are automatically injected into the agent's system prompt."

describe('P35-307 leftover Russian промпт wrapping on projectsList.emptyDescription', () => {
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
