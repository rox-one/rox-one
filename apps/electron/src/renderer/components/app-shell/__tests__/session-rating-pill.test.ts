import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('session rating pill', () => {
  it('selects exact score, announces pressed, and toasts on rate failure', () => {
    const src = readFileSync(join(import.meta.dir, '../SessionRatingPill.tsx'), 'utf8')
    expect(src).toContain('aria-pressed')
    expect(src).toContain('score === value')
    expect(src).toContain('toast.error')
    expect(src).not.toContain('score >= value')
    expect(src).not.toContain('bg-foreground/10')
    expect(src).toContain('bg-background')
    expect(src).toContain('border-border/50')
    expect(src).toContain('bg-foreground')
    expect(src).toContain('text-background')
  })
})
