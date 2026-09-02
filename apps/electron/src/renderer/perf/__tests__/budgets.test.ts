import { describe, expect, it } from 'bun:test'
import { evaluateBundle, evaluateSamples, percentile } from '../budgets'
import type { InteractionSample } from '../types'

function sample(overrides: Partial<InteractionSample> = {}): InteractionSample {
  return {
    kind: 'cached-session-switch',
    durationMs: 10,
    marks: [],
    collectionReload: false,
    ipc: {},
    nPlusOne: [],
    longTaskCount: 0,
    reactCommitMs: 0,
    payloadBytes: 0,
    ...overrides,
  }
}

describe('perf budgets', () => {
  it('computes p95', () => {
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100)
  })

  it('fails cached switch when a collection reload occurs', () => {
    const violations = evaluateSamples([
      sample({ collectionReload: true, ipc: { 'sessions:get': { channel: 'sessions:get', count: 1, totalResultBytes: 8 } } }),
    ])
    expect(violations.some((v) => v.rule.includes('collectionReload') || v.rule.includes('sessions:get'))).toBe(true)
  })

  it('keeps bundle hangs off the interaction sample list', () => {
    const interaction = evaluateSamples([sample({ durationMs: 5 })])
    const bundle = evaluateBundle(31_000, true)
    expect(interaction).toEqual([])
    expect(bundle[0]?.rule).toBe('bundle-minify.durationMs')
  })
})
