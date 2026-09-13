import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
const freeFormInput = readFileSync(join(import.meta.dir, '../input/FreeFormInput.tsx'), 'utf8')

describe('composer Edit File action is i18n', () => {
  it('AppShell secondaryAction uses common.editFile and skips the English label', () => {
    expect(appShell).toContain("t('common.editFile')")
    expect(appShell).not.toContain("label: 'Edit File'")
  })

  it('FreeFormInput secondaryAction uses common.editFile and skips the English label', () => {
    expect(freeFormInput).toContain("t('common.editFile')")
    expect(freeFormInput).not.toContain("label: 'Edit File'")
  })

  it('English locale matches the previous hardcoded label', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('common.editFile')).toBe('Edit File')
  })
})
