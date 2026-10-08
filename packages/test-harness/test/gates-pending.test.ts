/** W1-10 self-test: gates report pending only when sibling inputs are absent (fail-closed cases: gates-fail-closed.test.ts). */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRiskClassPresence } from '../src/gates/risk-class.ts'
import { checkNegativeTestPresence } from '../src/gates/negative-tests.ts'
import { runPermissionMatrixGate } from '../src/gates/permission-matrix.ts'
import { runConfigPathsGate } from '../src/gates/config-paths.ts'
import { checkChromeLintGate, checkOneRailGatePending, checkDockLayoutGate } from '../src/gates/chrome-dock.ts'
import { checkAgentPrivacyGate } from '../src/gates/agent-privacy.ts'
import { checkVisualGate, checkAxeGate } from '../src/gates/visual-axe.ts'

const emptyRoot = mkdtempSync(join(tmpdir(), 'w1-10-empty-'))

describe('gates with missing sibling inputs', () => {
  test('risk-class gate is pending without a catalogue', async () => {
    const res = await checkRiskClassPresence({ repoRoot: emptyRoot })
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('#1500')
  })
  test('negative-tests gate is pending without a catalogue', async () => {
    const res = await checkNegativeTestPresence({ repoRoot: emptyRoot })
    expect(res.status).toBe('pending')
  })
  test('permission-matrix gate is pending without permissions.ts', async () => {
    const res = await runPermissionMatrixGate({ repoRoot: emptyRoot })
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('#1501')
  })
  test('config-paths gate is pending without the W1-13 script', async () => {
    const res = await runConfigPathsGate({ repoRoot: emptyRoot })
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('#1510')
  })
  test('v2.1 gates are pending without W1-15 inputs', async () => {
    expect((await checkChromeLintGate({ repoRoot: emptyRoot })).status).toBe('pending')
    expect(checkOneRailGatePending().status).toBe('pending')
    expect((await checkDockLayoutGate({ repoRoot: emptyRoot })).status).toBe('pending')
    expect((await checkAgentPrivacyGate({ repoRoot: emptyRoot })).status).toBe('pending')
  })
  test('visual, axe and one-rail gates stay pending until the wave-2 browser driver, and say so', async () => {
    for (const res of [checkVisualGate({ repoRoot: emptyRoot, env: {} }), await checkAxeGate({ repoRoot: emptyRoot }), checkOneRailGatePending()]) {
      expect(res.status).toBe('pending')
      expect(res.summary).toContain('wave-2 browser driver')
      expect(res.summary).toContain('README')
    }
  })
})

describe('runAllGates', () => {
  test('awaits the async catalogue gates and can run a subset (--only)', async () => {
    const { runAllGates } = await import('../src/gates/run-all.ts')
    const res = await runAllGates({ repoRoot: emptyRoot, only: ['risk-class', 'negative-tests'], env: {} })
    expect(res.map((r) => [r.gate, r.status])).toEqual([
      ['risk-class', 'pending'],
      ['negative-tests', 'pending'],
    ])
    await expect(runAllGates({ repoRoot: emptyRoot, only: ['no-such-gate'] })).rejects.toThrow('unknown gate')
  })
  test('perf-microbench reads ROX_BENCH_RUNS; a bad value fails the gate instead of crashing the run', async () => {
    const { runAllGates } = await import('../src/gates/run-all.ts')
    const [bad] = await runAllGates({ only: ['perf-microbench'], env: { ROX_BENCH_RUNS: '0' } })
    expect(bad!.status).toBe('fail')
    expect(bad!.violations?.join(' ')).toContain('ROX_BENCH_RUNS')
    const [ok] = await runAllGates({ only: ['perf-microbench'], env: { ROX_BENCH_RUNS: '2' } })
    expect(ok!.summary).toContain('median of 2 run medians')
  })
})
