import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const source = readFileSync(join(import.meta.dir, '../TiptapMarkdownEditor.tsx'), 'utf8')

describe('TiptapMarkdownEditor file-read fallbacks are i18n', () => {
  it('uses editor.failedToReadFile keys and skips the English fallbacks', () => {
    expect(source).toContain("i18n.t('editor.failedToReadFileAsDataUrl')")
    expect(source).toContain("i18n.t('editor.failedToReadFile')")
    expect(source).toContain('reader.error ?? new Error(i18n.t(\'editor.failedToReadFile\'))')
    expect(source).not.toContain("'Failed to read file as data URL'")
    expect(source).not.toContain("'Failed to read file'")
  })

  it('English locale matches the previous hardcoded fallbacks', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('editor.failedToReadFile')).toBe('Failed to read file')
    expect(i18n.t('editor.failedToReadFileAsDataUrl')).toBe('Failed to read file as data URL')
  })
})
