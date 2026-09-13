import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const source = readFileSync(join(import.meta.dir, '../PageFrame.tsx'), 'utf8')

describe('PageFrame action-failed fallback is i18n', () => {
  it('uses pages.actionFailed and skips the English fallback', () => {
    expect(source).toContain("t('pages.actionFailed')")
    expect(source).toContain("err instanceof Error ? err.message : t('pages.actionFailed')")
    expect(source).not.toContain("'Action failed'")
    expect(source).toContain("reject('nonce-mismatch: request nonce does not match the render lease')")
  })

  it('English locale matches the previous hardcoded fallback', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('pages.actionFailed')).toBe('Action failed')
  })
})
