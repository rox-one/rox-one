import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../MemoryScreen.tsx'), 'utf8')

describe('MemoryScreen icon tiles (P5b density)', () => {
  it('category icon well uses SE surface/muted, not colored tiles', () => {
    expect(src).toContain('bg-surface-hover text-muted-foreground')
    expect(src).not.toContain('bg-pink-500/10')
    expect(src).not.toContain('bg-amber-500/10')
    expect(src).not.toContain('bg-sky-500/10')
    expect(src).not.toContain('bg-violet-500/10')
  })
})
