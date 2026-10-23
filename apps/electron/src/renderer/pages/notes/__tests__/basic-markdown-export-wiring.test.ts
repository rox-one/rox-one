import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const notesPage = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const documentIa = readFileSync(join(import.meta.dir, '../document-ia.ts'), 'utf8')
const tiptap = readFileSync(
  join(import.meta.dir, '../../../../../../../packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx'),
  'utf8',
)
const vault = readFileSync(
  join(import.meta.dir, '../../../../../../../packages/server-core/src/knowledge/vault-markdown.ts'),
  'utf8',
)
const coreCodec = readFileSync(
  join(import.meta.dir, '../../../../../../../packages/core/src/docs/container-codec.ts'),
  'utf8',
)

describe('LSX-WP-031 basic Markdown export production wiring', () => {
  it('canonical choke toBasicMarkdownExport lives in @rox/core/docs', () => {
    expect(coreCodec).toContain('export function toBasicMarkdownExport')
    expect(coreCodec).toMatch(/toBasicMarkdownExport\([\s\S]*?expandContainersForBasicMarkdown/)
  })

  it('NotesPage AI/copy-draft funnel through basicMarkdownForNotes → toBasicMarkdownExport', () => {
    expect(notesPage).toContain('basicMarkdownForNotes')
    expect(notesPage).toContain('basicMarkdownForNotes(content)')
    expect(notesPage).toContain('basicMarkdownForNotes(contentRef.current)')
    expect(documentIa).toContain('toBasicMarkdownExport')
    expect(documentIa).toMatch(/basicMarkdownForNotes[\s\S]*?return toBasicMarkdownExport\(markdown\)/)
  })

  it('TipTap clipboardTextSerializer uses toBasicMarkdownExport (not raw expand)', () => {
    expect(tiptap).toContain('clipboardTextSerializer')
    expect(tiptap).toContain('toBasicMarkdownExport')
    expect(tiptap).toMatch(/clipboardTextSerializer:[\s\S]*?toBasicMarkdownExport\(serializer\.serialize/)
    // Rich onUpdate must stay portable (no expand on the emit path).
    expect(tiptap).toMatch(/onUpdate:[\s\S]*?postprocessMarkdownFromOfficial\(getOfficialMarkdown/)
    expect(tiptap).not.toMatch(/onUpdate:[\s\S]*?toBasicMarkdownExport/)
  })

  it('vault FTS body_text uses toBasicMarkdownExport choke', () => {
    expect(vault).toContain('toBasicMarkdownExport(body)')
    expect(vault).not.toContain('expandContainersForBasicMarkdown(body)')
  })
})
