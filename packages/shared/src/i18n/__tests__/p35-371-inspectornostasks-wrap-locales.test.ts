import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'notes.inspector.noTasks'
const RU_WRAPPED = 'Нет Markdown-задач'
const EN_VALUE = 'No markdown tasks'

describe('P35-371 leftover Russian markdown wrapping on notes.inspector.noTasks', () => {
  it('wraps leftover markdown-задач as sibling Markdown-задач, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Markdown-задач')
    expect(ru).not.toContain('markdown-задач')
    expect(ru).not.toContain('.')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).not.toContain('Markdown-задач')
    expect(i18n.t(KEY)).not.toContain('Нет')
  })
})
