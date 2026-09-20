import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'meetings.capabilityDenied'
const RU_WRAPPED = 'Захват заблокирован: нужно разрешение микрофона'
const EN_VALUE = 'Capture blocked: microphone grant is required'

describe('P35-320 leftover Russian грант wrapping on meetings.capabilityDenied', () => {
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
