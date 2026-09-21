import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.messaging.telegram.access.pending.audit.notOwner'
const RU_WRAPPED =
  'Отклонён как не-владелец рабочего пространства. Разрешить добавляет этот точный идентификатор отправителя как владельца.'
const EN_VALUE = 'Rejected as a workspace non-owner. Allow adds this exact sender id as an owner.'

describe('P35-378 leftover Russian id wrapping on settings.messaging.telegram.access.pending.audit.notOwner', () => {
  it('wraps leftover prose id as sibling идентификатор, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('идентификатор')
    expect(ru).toContain('рабочего пространства')
    expect(ru).not.toMatch(/\bid\b/)

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('id')
    expect(i18n.t(KEY)).not.toContain('идентификатор')
  })
})
