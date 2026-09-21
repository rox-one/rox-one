import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'notes.dialog.renameNoteDesc'
const RU_WRAPPED = 'Переименовать Markdown-файл и обновить совпадающие вики-ссылки.'
const EN_VALUE = 'Rename the markdown file and update any matching wiki links.'

describe('P35-369 leftover Russian markdown wrapping on notes.dialog.renameNoteDesc', () => {
  it('wraps leftover markdown-файл as sibling Markdown-файл, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Markdown-файл')
    expect(ru).not.toContain('markdown-файл')
    expect(ru.endsWith('.')).toBe(true)

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).not.toContain('Markdown-файл')
    expect(i18n.t(KEY)).not.toContain('вики-ссылки')
  })
})
