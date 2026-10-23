import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../TaskEditor.tsx'), 'utf8')

describe('TaskEditor indigo wells (P5b density)', () => {
  it('subtask index and empty-plan wells use SE surface/muted', () => {
    expect(src).not.toContain('bg-indigo-500/10')
    expect(src).toMatch(/rounded-full bg-surface-hover text-sm font-bold numeric text-muted-foreground/)
    expect(src).toContain('grid size-8 place-items-center rounded-full bg-surface-hover text-muted-foreground')
    expect(src).toContain('Sparkles className="h-4 w-4"')
  })
})
