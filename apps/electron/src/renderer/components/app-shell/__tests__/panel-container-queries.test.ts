import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const css = readFileSync(join(import.meta.dir, '../../../index.css'), 'utf8')
const slot = readFileSync(join(import.meta.dir, '../PanelSlot.tsx'), 'utf8')
const cqStart = css.indexOf('/* Panel container queries (fluid panels).')
const cqEnd = css.indexOf('/* Rox Engineering shell micro-interactions')
const block = css.slice(cqStart, cqEnd < 0 ? undefined : cqEnd)

describe('panel container queries', () => {
  it('PanelSlot stays the `panel` size container the tiers query', () => {
    expect(slot).toContain('@container/panel')
  })
  it('defines a base tier and two wider panel tiers, ascending', () => {
    const tiers = [...block.matchAll(/@container panel \(min-width: (\d+)px\)/g)].map((m) => Number(m[1]))
    expect(tiers).toEqual([720, 1200])
    expect(block).toContain('--panel-gutter: calc(var(--spacing) * 3);')
  })
  it('gutters derive from the spacing token', () => {
    for (const m of block.matchAll(/--panel-gutter:\s*([^;]+);/g)) expect(m[1]).toMatch(/^calc\(var\(--spacing\) \* \d+\)$/)
  })
  it('is static layout: no transitions/animations, no container-type added', () => {
    expect(block.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/transition|animation|container-type/)
  })
  it('primitives fall back when used outside a panel', () => {
    expect(block).toContain('var(--panel-gutter, calc(var(--spacing) * 3))')
    expect(block).toContain('var(--panel-measure, 100%)')
  })
})
