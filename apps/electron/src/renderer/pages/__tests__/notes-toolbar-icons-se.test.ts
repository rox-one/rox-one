import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../NotesPage.tsx'), 'utf8')

describe('Notes toolbar icons (P5b density)', () => {
  it('toolbar action icons use muted SE tone, not sky/amber/violet', () => {
    // Icon glyphs in toolbar action buttons
    expect(src).toContain('FolderPlus className="h-4 w-4 text-muted-foreground"')
    expect(src).toContain('FilePlus2 className="h-4 w-4 text-muted-foreground"')
    expect(src).toContain('Tags className="h-3.5 w-3.5 shrink-0 text-muted-foreground"')
    expect(src).not.toMatch(/FolderPlus className="[^"]*text-amber-500/)
    expect(src).not.toMatch(/FilePlus2 className="[^"]*text-sky-500/)
    expect(src).not.toMatch(/Tags className="[^"]*text-violet-500/)
  })
})
