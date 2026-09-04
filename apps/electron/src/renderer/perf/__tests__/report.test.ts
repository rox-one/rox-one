import { describe, expect, it } from 'bun:test'
import { formatBenchmarkReport } from '../report'
import type { BenchmarkReport } from '../types'

describe('perf report', () => {
  it('renders a human-readable pass report', () => {
    const report: BenchmarkReport = {
      generatedAt: '2026-09-02T00:00:00.000Z',
      passed: true,
      violations: [],
      runs: [{
        fixture: 'sessions-2000',
        sessionCount: 2000,
        noteCount: 0,
        samples: [{
          kind: 'cached-session-switch',
          durationMs: 4,
          marks: [],
          collectionReload: false,
          ipc: {},
          nPlusOne: [],
          longTaskCount: 0,
          reactCommitMs: 1,
          payloadBytes: 0,
        }],
        bundle: { durationMs: 12, hung: false },
      }],
    }
    const text = formatBenchmarkReport(report)
    expect(text).toContain('PASS')
    expect(text).toContain('sessions-2000')
    expect(text).toContain('cached-session-switch')
    expect(text).toContain('No budget violations')
  })
})
