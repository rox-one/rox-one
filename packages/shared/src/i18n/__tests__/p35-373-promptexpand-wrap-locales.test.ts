import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'notes.ai.promptExpand'
const RU_WRAPPED =
  'Расширь и дополни эту заметку контекстом, примерами и деталями. Напиши расширенную версию в Markdown.'
const EN_VALUE =
  'Expand and enrich this note with additional context, examples, and detail. Write the expanded version as markdown.'

describe('P35-373 leftover Russian markdown wrapping on notes.ai.promptExpand', () => {
  it('wraps leftover markdown as sibling Markdown, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('в Markdown.')
    expect(ru).not.toContain('в markdown.')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).not.toContain('в Markdown.')
    expect(i18n.t(KEY)).not.toContain('в markdown.')
  })
})
