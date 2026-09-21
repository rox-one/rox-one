import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('background finished chip clarity', () => {
  it('uses solid fill and hover without backdrop blur', () => {
    const src = readFileSync(join(import.meta.dir, '../BackgroundFinishedChip.tsx'), 'utf8')
    expect(src).not.toContain('backdrop-blur')
    // Solid hover only — reject translucent hover:bg-purple-200/NN
    expect(src).toMatch(/bg-purple-100 hover:bg-purple-200(?!\/)/)
    expect(src).not.toMatch(/hover:bg-purple-200\//)
    expect(src).not.toContain('hover:bg-purple-200/90')
    expect(src).toContain('dark:bg-purple-950')
  })
})
