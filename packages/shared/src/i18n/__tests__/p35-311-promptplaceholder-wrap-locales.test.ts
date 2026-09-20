import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'tasks.promptPlaceholder'
const RU_WRAPPED =
  'Запрос — что должен делать этот узел. Ссылайтесь на вывод вышестоящего узла через ${nodes.<id>.output}.'
const EN_VALUE =
  'Prompt — what this node should do. Reference an upstream output with ${nodes.<id>.output}.'

describe('P35-311 leftover Russian промпт wrapping on tasks.promptPlaceholder', () => {
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
