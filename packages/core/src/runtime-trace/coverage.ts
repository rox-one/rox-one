import type { TraceCoverage } from './types'
export const initialTraceCoverage = (): TraceCoverage => ({ state: 'complete', source: 'runtime', missing: [] })
/** Missing evidence cannot be promoted to complete by an unrelated later event. */
export function mergeTraceCoverage(left: TraceCoverage, right: TraceCoverage): TraceCoverage {
  const missing = [...new Set([...left.missing, ...right.missing])]
  const state = left.state === 'unavailable' && right.state === 'unavailable' ? 'unavailable'
    : missing.length || left.state !== 'complete' || right.state !== 'complete' ? 'partial' : 'complete'
  return { state, source: left.source === 'reconstructed-from-transcript' || right.source === 'reconstructed-from-transcript' ? 'reconstructed-from-transcript' : 'runtime', missing, reason: right.reason ?? left.reason }
}
