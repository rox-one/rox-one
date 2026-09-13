import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const source = readFileSync(join(import.meta.dir, '../../App.tsx'), 'utf8')

describe('App Open File URL hint is i18n', () => {
  it('uses toast.localPathUseOpenFile and skips the English tail', () => {
    expect(source).toContain("t('toast.localPathUseOpenFile')")
    expect(source).toContain("error instanceof Error ? error.message : t('toast.unknownError')")
    expect(source).toContain("console.error('Failed to open URL:', error)")
    expect(source).not.toContain('. If this is a local path, use Open File instead.')
  })

  it('English locale matches the previous hardcoded hint', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('toast.localPathUseOpenFile')).toBe(
      'If this is a local path, use Open File instead.',
    )
  })
})
