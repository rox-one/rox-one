import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.orgs.inviteDesc'
const RU_WRAPPED =
  'Пригласите по почте или имени пользователя. Приглашение хранится на этом устройстве. Письмо не отправляется. Погашение локально или через URL сервера Rox, если он задан.'
const EN_VALUE =
  'Invite by email or username. The invite is stored on this device. Email is not sent. Redeem locally or via Rox Server URL when configured.'

describe('P35-397 leftover Russian email wrapping on settings.orgs.inviteDesc', () => {
  it('wraps leftover email as sibling почте, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('по почте')
    expect(ru).toContain('URL сервера Rox')
    expect(ru).not.toContain('email')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
