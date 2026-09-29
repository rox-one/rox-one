import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.messaging.telegram.access.pending.audit.notOnBindingAllowlist'
const RU_WRAPPED =
  'Отклонён в этом чате. Разрешить добавляет этот точный идентификатор отправителя в список доступа привязки.'
const EN_VALUE = 'Rejected on this chat. Allow adds this exact sender id to the binding allow-list.'

describe('P35-377 leftover Russian id wrapping on settings.messaging.telegram.access.pending.audit.notOnBindingAllowlist', () => {
  it('wraps leftover prose id as sibling идентификатор, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('идентификатор')
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
