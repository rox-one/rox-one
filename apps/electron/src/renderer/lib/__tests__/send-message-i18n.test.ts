import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const source = readFileSync(join(import.meta.dir, '../../App.tsx'), 'utf8')

describe('App send-message error card is i18n', () => {
  it('uses chat.failedToSendMessage and toast.unknownError', () => {
    expect(source).toContain("t('chat.failedToSendMessage'")
    expect(source).toContain("error instanceof Error ? error.message : t('toast.unknownError')")
    expect(source).toContain("console.error('Failed to send message:', error)")
    expect(source).not.toContain(
      "`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`",
    )
  })

  it('English locale interpolates the native error', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('chat.failedToSendMessage', { error: 'boom' })).toBe(
      'Failed to send message: boom',
    )
  })
})
