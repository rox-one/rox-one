import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'notes.sideSession.hint'
const RU_WRAPPED = 'Проверьте запрос и отправьте, когда будете готовы. Заметка остаётся открытой.'
const EN_VALUE = 'Review the prompt and send when ready. The note stays open.'

describe('P35-303 leftover Russian промпт wrapping on notes.sideSession.hint', () => {
  it('wraps leftover промпт as sibling запрос, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toBe('Проверьте запрос и отправьте, когда будете готовы. Заметка остаётся открытой.')
    expect(ru.toLowerCase()).not.toContain('промпт')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
