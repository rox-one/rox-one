import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('P6 NotesPage chrome (SE surface fills)', () => {
  it('uses surface-hover/selected/pressed, not foreground-alpha fills', () => {
    const src = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
    expect(src.includes('bg-foreground/['), 'NotesPage still has bg-foreground/[').toBe(false)
    expect(src.includes('hover:bg-foreground/['), 'NotesPage still has hover fg-alpha').toBe(false)
    expect(src.includes('focus:bg-foreground/['), 'NotesPage still has focus fg-alpha').toBe(false)
    expect(src).toContain('hover:bg-surface-hover')
    expect(src).toContain('bg-surface-selected')
    expect(src).toContain('focus:bg-surface-pressed')
  })

  it('NoteLibraryChrome already uses SE surfaces (no fg-alpha chrome)', () => {
    const src = readFileSync(join(import.meta.dir, '../NoteLibraryChrome.tsx'), 'utf8')
    expect(src.includes('bg-foreground/[')).toBe(false)
    expect(src).toContain('hover:bg-surface-hover')
  })
})
