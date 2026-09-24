import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.accounts.localProfileDesc'
const RU_WRAPPED =
  'На этом устройстве используется локальный профиль. Это не облачный вход. Необязательный URL сервера Rox подключает удалённый экземпляр Rox.'
const EN_VALUE =
  'This device uses a local profile. It is not a cloud login. An optional Rox Server URL connects a remote Rox instance.'

describe('P35-381 leftover Russian Server wrapping on settings.accounts.localProfileDesc', () => {
  it('wraps leftover Server as sibling URL сервера Rox, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('URL сервера Rox')
    expect(ru).toContain('Rox')
    expect(ru).not.toContain('Rox Server URL')
    expect(ru).not.toMatch(/\bServer\b/)

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Rox Server URL')
    expect(i18n.t(KEY)).not.toContain('URL сервера Rox')
  })
})
