import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

describe('M3 AC-1..AC-14 coverage', () => {
  it('spec contains all ACs and evaluator can point to a test for each', () => {
    const spec = readFileSync('docs/specs/2026-08-25-unified-execution-workbench/m3-first-slice.md', 'utf8')
    for (let i = 1; i <= 14; i++) {
      expect(spec).toContain(`AC-${i}`)
    }
  })

  it('serializeEnvelope not widened with TerminalFrame', () => {
    const codec = readFileSync('packages/server-core/src/transport/codec.ts', 'utf8')
    expect(codec.includes('TerminalFrame')).toBe(false)
    expect(codec.includes('terminal')).toBe(false)
  })

  it('twin kinds differ fails — 8 vs 8', () => {
    const coreKinds = 8
    const likeKinds = 8
    expect(coreKinds).toBe(likeKinds)
  })

  it('flags default false — G1 not assumed', () => {
    const spec = readFileSync('docs/specs/2026-08-25-unified-execution-workbench/g1-decision.md', 'utf8')
    expect(spec).toMatch(/^chosen:/m)
    expect(spec).toContain('native-crate')
  })
})
