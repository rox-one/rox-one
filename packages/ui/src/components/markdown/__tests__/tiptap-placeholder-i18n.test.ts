import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../TiptapMarkdownEditor.tsx'), 'utf8')
const en = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../../shared/src/i18n/locales/en.json'), 'utf8'),
) as Record<string, string>

describe('TiptapMarkdownEditor placeholder default is i18n', () => {
  it('uses editor.placeholder and skips the English fallback', () => {
    expect(source).toContain("i18n.t('editor.placeholder')")
    expect(source).toContain("placeholder ?? i18n.t('editor.placeholder')")
    expect(source).not.toContain("'Write something...'")
  })

  it('English locale matches the previous hardcoded fallback', () => {
    expect(en['editor.placeholder']).toBe('Write something...')
  })

  it('does not reuse the notes-specific placeholder key', () => {
    expect(source).not.toContain("notes.editor.placeholder")
    expect(en['notes.editor.placeholder']).toBe('Write note…')
  })
})
