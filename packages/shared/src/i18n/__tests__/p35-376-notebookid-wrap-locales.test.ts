import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'knowledge.publish.field.notebookIdPlaceholder'
const RU_WRAPPED = 'ID блокнота'
const EN_VALUE = 'notebook id'

describe('P35-376 leftover Russian id wrapping on knowledge.publish.field.notebookIdPlaceholder', () => {
  it('wraps leftover id as sibling ID, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('ID')
    expect(ru).not.toMatch(/\bid\b/)

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).not.toContain('ID')
    expect(i18n.t(KEY)).toContain('id')
  })
})
