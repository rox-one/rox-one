import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'notes.dialog.renameAssetDesc'
const RU_WRAPPED = 'Переименовать файл вложения и обновить Markdown-ссылки на него.'
const EN_VALUE = 'Rename the asset file and update markdown references that point to it.'

describe('P35-370 leftover Russian markdown wrapping on notes.dialog.renameAssetDesc', () => {
  it('wraps leftover markdown-ссылки as sibling Markdown-ссылки, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Markdown-ссылки')
    expect(ru).not.toContain('markdown-ссылки')
    expect(ru.endsWith('.')).toBe(true)

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).not.toContain('Markdown-ссылки')
    expect(i18n.t(KEY)).not.toContain('вложения')
  })
})
