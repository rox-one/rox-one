import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'meetings.rooms.undecided'
const LEFTOVER_CALQUE = 'провайдер'

describe('P35-264 leftover Russian провайдер wrapping on meetings.rooms.undecided', () => {
  it('wraps leftover SFU-провайдер as SFU-поставщик', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toBe('Комнаты заблокированы: SFU-поставщик не выбран')
    expect(value).toContain('SFU-')
    expect(value).not.toContain(KEY)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Rooms blocked: SFU provider not chosen')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
