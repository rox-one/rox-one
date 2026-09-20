import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'meetings.archiveDenied'
const RU_WRAPPED = 'Импорт заблокирован: нужно разрешение архива'
const EN_VALUE = 'Import blocked: archive grant is required'

describe('P35-319 leftover Russian грант wrapping on meetings.archiveDenied', () => {
  it('wraps leftover грант as sibling разрешение, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).not.toContain('грант')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
