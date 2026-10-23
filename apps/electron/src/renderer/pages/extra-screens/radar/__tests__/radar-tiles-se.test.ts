import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../RadarPage.tsx'), 'utf8')

describe('Radar tiles (P5b density)', () => {
  it('header and chrome icons use SE surface/muted, not violet/sky tiles', () => {
    expect(src).toContain('bg-surface-hover text-muted-foreground')
    expect(src).toContain('Radar className="h-4 w-4"')
    expect(src).not.toContain('bg-violet-500/15')
    expect(src).not.toContain('text-violet-500')
    expect(src).not.toMatch(/Globe2 className="[^"]*text-sky-500/)
    expect(src).not.toMatch(/Clock3 className="[^"]*text-amber-500/)
    expect(src).not.toMatch(/bucket === 'reaction' \? 'text-amber/)
  })
})
