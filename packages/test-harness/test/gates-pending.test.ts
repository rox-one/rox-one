/** W1-10 self-test: gates report pending when sibling inputs are absent. */
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
  test('risk-class gate is pending without a catalogue', () => {
    const res = checkRiskClassPresence({ repoRoot: emptyRoot })
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('#1500')
  })
  test('negative-tests gate is pending without a catalogue', () => {
    const res = checkNegativeTestPresence({ repoRoot: emptyRoot })
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
    expect(checkChromeLintGate({ repoRoot: emptyRoot }).status).toBe('pending')
    expect(checkOneRailGatePending().status).toBe('pending')
    expect((await checkDockLayoutGate({ repoRoot: emptyRoot })).status).toBe('pending')
    expect((await checkAgentPrivacyGate({ repoRoot: emptyRoot })).status).toBe('pending')
  })
  test('visual and axe gates are pending without wave-2 screens', async () => {
    expect(checkVisualGate({ repoRoot: emptyRoot }).status).toBe('pending')
    expect((await checkAxeGate({ repoRoot: emptyRoot })).status).toBe('pending')
  })
})
