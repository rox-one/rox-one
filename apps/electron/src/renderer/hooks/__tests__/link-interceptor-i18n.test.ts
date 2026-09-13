import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const source = readFileSync(join(import.meta.dir, '../useLinkInterceptor.ts'), 'utf8')

describe('useLinkInterceptor preview overlay read-file fallback is i18n', () => {
  it('uses preview.failedToReadFile and skips the English fallback', () => {
    expect(source).toContain("t('preview.failedToReadFile')")
    expect(source).toContain("err instanceof Error ? err.message : i18n.t('preview.failedToReadFile')")
    expect(source).not.toContain("'Failed to read file'")
  })

  it('English locale matches the previous hardcoded fallback', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('preview.failedToReadFile')).toBe('Failed to read file')
  })
})
