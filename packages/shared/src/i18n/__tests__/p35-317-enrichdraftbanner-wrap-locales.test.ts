import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'mindmap.enrichDraftBanner'
const RU_WRAPPED = 'Предпросмотр улучшенной карты — принять (закрепить) или отменить.'
const EN_VALUE = 'Preview improved map — accept to pin, or discard.'

describe('P35-317 leftover Russian превью wrapping on mindmap.enrichDraftBanner', () => {
  it('wraps leftover превью as sibling предпросмотр, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).not.toContain('превью')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
