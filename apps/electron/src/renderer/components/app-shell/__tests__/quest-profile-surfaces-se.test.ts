import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const quest = readFileSync(join(import.meta.dir, '../QuestProgressCard.tsx'), 'utf8')
const strip = readFileSync(join(import.meta.dir, '../ProfileStrip.tsx'), 'utf8')

describe('Quest/Profile SE surfaces (P5b)', () => {
  it('QuestProgressCard drops gradients and colored fills', () => {
    expect(quest).not.toContain('bg-gradient')
    expect(quest).not.toContain('from-violet')
    expect(quest).not.toContain('from-amber')
    expect(quest).not.toMatch(/bg-violet-500(?!\/)/)
    expect(quest).not.toContain('bg-violet-500/')
    expect(quest).not.toContain('bg-amber-500')
    expect(quest).not.toContain('text-amber-500')
    expect(quest).toContain('border border-border bg-surface-hover')
    expect(quest).toContain('bg-accent')
    expect(quest).toContain('grid size-8 place-items-center')
    expect(quest).not.toContain('size-10 place-items-center')
  })

  it('ProfileStrip plan pills are solid SE surfaces', () => {
    expect(strip).not.toContain('bg-gradient-to-b')
    expect(strip).not.toContain('from-zinc-100')
    expect(strip).not.toContain('from-sky-100')
    expect(strip).toContain('bg-surface-hover text-muted-foreground ring-border')
    expect(strip).toContain('data-plan={plan}')
  })
})
