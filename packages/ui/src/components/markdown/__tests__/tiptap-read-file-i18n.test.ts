import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../TiptapMarkdownEditor.tsx'), 'utf8')
const en = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../../shared/src/i18n/locales/en.json'), 'utf8'),
) as Record<string, string>

describe('TiptapMarkdownEditor file-read fallbacks are i18n', () => {
  it('uses editor.failedToReadFile keys and skips the English fallbacks', () => {
    expect(source).toContain("i18n.t('editor.failedToReadFileAsDataUrl')")
    expect(source).toContain("i18n.t('editor.failedToReadFile')")
    expect(source).toContain("reader.error ?? new Error(i18n.t('editor.failedToReadFile'))")
    expect(source).not.toContain("'Failed to read file as data URL'")
    expect(source).not.toContain("'Failed to read file'")
  })

  it('English locale matches the previous hardcoded fallbacks', () => {
    expect(en['editor.failedToReadFile']).toBe('Failed to read file')
    expect(en['editor.failedToReadFileAsDataUrl']).toBe('Failed to read file as data URL')
  })
})
