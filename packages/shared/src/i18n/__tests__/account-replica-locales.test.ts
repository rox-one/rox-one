import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEY = 'accountReplica.excludedCredentials'
const ENGLISH = 'Passwords, cookies and passkeys stay on this device'
const RUSSIAN = 'Пароли, файлы cookie и ключи доступа остаются на этом устройстве'

describe('accountReplica leftover excluded-credentials chrome', () => {
  it('Russian copy drops leftover English cookie; English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RUSSIAN)
    expect(i18n.t(KEY)).not.toBe(ENGLISH)
    expect(i18n.t(KEY)).not.toMatch(/Пароли, cookie /)
    expect(i18n.t(KEY)).toContain('файлы cookie')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(ENGLISH)

    await setupI18n().changeLanguage('ru')
  })
})
