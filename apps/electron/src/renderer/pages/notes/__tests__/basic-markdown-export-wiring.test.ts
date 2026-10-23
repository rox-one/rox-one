import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const notesPage = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const tiptap = readFileSync(
  join(import.meta.dir, '../../../../../../../packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx'),
  'utf8',
)
const vault = readFileSync(
  join(import.meta.dir, '../../../../../../../packages/server-core/src/knowledge/vault-markdown.ts'),
  'utf8',
)

describe('LSX-WP-031 basic Markdown export production wiring', () => {
  it('NotesPage expands containers for AI context and copy-draft clipboard', () => {
    expect(notesPage).toContain('basicMarkdownForNotes')
    expect(notesPage).toContain('basicMarkdownForNotes(content)')
    expect(notesPage).toContain('basicMarkdownForNotes(contentRef.current)')
  })

  it('TipTap clipboardTextSerializer expands containers for plain copy', () => {
    expect(tiptap).toContain('clipboardTextSerializer')
    expect(tiptap).toContain('expandContainersForBasicMarkdown')
    expect(tiptap).toContain('toBasicMarkdownExport')
    // Rich onUpdate must stay portable (no expand on the emit path).
    expect(tiptap).toMatch(/onUpdate:[\s\S]*?postprocessMarkdownFromOfficial\(getOfficialMarkdown/)
    expect(tiptap).not.toMatch(/onUpdate:[\s\S]*?toBasicMarkdownExport/)
  })

  it('vault FTS body_text still expands at parseVaultMarkdown', () => {
    expect(vault).toContain('expandContainersForBasicMarkdown(body)')
  })
})
