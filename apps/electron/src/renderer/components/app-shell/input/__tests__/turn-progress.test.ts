import { describe, expect, it } from 'bun:test'
import {
  computeTokensPerSecond,
  formatCostUsd,
  formatTokensPerSecond,
  resolveTurnPhase,
} from '../turn-progress'

describe('formatCostUsd', () => {
  it('formats session cost for the popover and status bar', () => {
    expect(formatCostUsd(undefined)).toBeNull()
    expect(formatCostUsd(-1)).toBeNull()
    expect(formatCostUsd(0)).toBe('$0.00')
    expect(formatCostUsd(0.004)).toBe('<$0.01')
    expect(formatCostUsd(1.234)).toBe('$1.23')
  })
})

describe('computeTokensPerSecond / resolveTurnPhase', () => {
  it('returns tok/s only after a short elapsed window', () => {
    expect(computeTokensPerSecond(40, 100)).toBeNull()
    expect(computeTokensPerSecond(40, 1000)).toBe(40)
    expect(formatTokensPerSecond(4.2)).toBe('4.2')
    expect(formatTokensPerSecond(18.6)).toBe('19')
  })

  it('maps statusType to a turn phase while processing', () => {
    expect(resolveTurnPhase('compacting', true)).toBe('compacting')
    expect(resolveTurnPhase('tool', true)).toBe('tool')
    expect(resolveTurnPhase(undefined, true, 12)).toBe('streaming')
    expect(resolveTurnPhase(undefined, true, 0)).toBe('thinking')
    expect(resolveTurnPhase('thinking', false)).toBeNull()
  })
})
