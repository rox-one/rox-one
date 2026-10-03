import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const editor = readFileSync(join(import.meta.dir, '../SessionWorkflowEditor.tsx'), 'utf8')
const entityRow = readFileSync(join(import.meta.dir, '../../ui/entity-row.tsx'), 'utf8')

describe('map + list chrome without light lines', () => {
  it('branch nodes have no white border; frames use a faint dashed outline', () => {
    expect(editor).not.toContain('border-white/10')
    expect(editor).toContain('border border-dashed border-foreground/20')
    expect(editor).not.toContain('outline-foreground/25')
  })

  it('keeps the selected-node accent ring and connection colours', () => {
    expect(editor).toContain("selected && 'ring-2 ring-accent'")
    expect(editor).toContain("'rgb(52 211 153)'")
    expect(editor).toContain("'rgb(251 113 133)'")
  })

  it('entity list rows are separated by spacing, not a drawn line', () => {
    expect(entityRow).not.toContain('<Separator')
  })
})
