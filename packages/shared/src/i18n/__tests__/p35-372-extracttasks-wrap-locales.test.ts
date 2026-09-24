import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'notes.ai.promptExtractTasks'
const RU_WRAPPED =
  'Извлеки все явные и неявные задачи из этой заметки. Оформи как Markdown-список `- [ ] задача`.'
const EN_VALUE =
  'Extract all implied and explicit action items from this note. Format as a markdown task list `- [ ] task`.'

describe('P35-372 leftover Russian markdown wrapping on notes.ai.promptExtractTasks', () => {
  it('wraps leftover markdown-список as Markdown-список, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Markdown-список')
    expect(ru).not.toContain('markdown-список')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).not.toContain('Markdown-список')
    expect(i18n.t(KEY)).not.toContain('markdown-список')
  })
})
