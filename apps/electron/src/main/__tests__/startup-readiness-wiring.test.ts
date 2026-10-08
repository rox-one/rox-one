/**
 * Source-level guard for main/index.ts readiness wiring (index.ts boots
 * Electron and cannot be imported in a unit test).
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const index = readFileSync(join(import.meta.dir, '..', 'index.ts'), 'utf8')

describe('main readiness wiring (review2)', () => {
  it('beforeAgentSpawn runs the spawn-env and bundled-skills waits concurrently', () => {
    const at = index.indexOf('beforeAgentSpawn:')
    expect(at).toBeGreaterThan(0)
    const body = index.slice(at, at + 300)
    expect(body).toContain('Promise.all([whenSpawnEnvReady(), whenBundledSkillsReadyForAgents(10_000)])')
  })

  it('wires the Windows repair through its spawn gate (expedite + start signal, settled on any outcome)', () => {
    expect(index).toContain('const repairGate = createWindowsRepairSpawnGate()')
    expect(index).toContain("registerSpawnEnvGate('windows-repair', repairGate.gate)")
    expect(index).toContain('signals: repairGate.signals,')
    expect(index).toContain('.finally(() => repairGate.settle())')
    expect(index).not.toContain('createLatchedGate(')
  })
})
