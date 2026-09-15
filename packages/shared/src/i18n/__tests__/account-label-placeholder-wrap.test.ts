import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEY = 'settings.accounts.accountLabelPlaceholder'

describe('P35-270 leftover account label placeholder wrap', () => {
  it('wraps Russian copy and keeps English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Метка аккаунта (email)')
    expect(i18n.t(KEY)).not.toBe('Account label (email)')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Account label (email)')
  })
})
