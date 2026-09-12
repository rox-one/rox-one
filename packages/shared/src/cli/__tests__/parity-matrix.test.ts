import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSessionToolDefs } from '../../agent/session-tool-defs.ts'
import { OMP_GLOBAL_SKILLS_DIR, OMP_WORKSPACE_SKILLS_DIR } from '../../skills/omp-discovery.ts'
import { ROX_CLI_PARITY_MATRIX } from '../parity-matrix.ts'

const sharedSrc = join(import.meta.dir, '../..')

describe('Rox CLI / Pi parity matrix', () => {
  it('records G1–G4 as done with compatibility ids preserved', () => {
    expect(ROX_CLI_PARITY_MATRIX.map((row) => row.id)).toEqual(['G1', 'G2', 'G3', 'G4'])
    expect(ROX_CLI_PARITY_MATRIX.every((row) => row.status === 'done')).toBe(true)
  })

  it('G1: shared tool-def generator can include MCP source proxies', () => {
    const g1 = ROX_CLI_PARITY_MATRIX.find((row) => row.id === 'G1')
    expect(g1?.compatibilityId).toBe('set_host_tools')
    expect(typeof buildSessionToolDefs).toBe('function')
    const source = readFileSync(join(sharedSrc, 'agent/session-tool-defs.ts'), 'utf8')
    expect(source).toContain('includePoolProxyDefs')
    expect(source).toContain('includeHostBashAlias')
  })

  it('G2: thinking events exist on the shared agent event union', () => {
    const source = readFileSync(join(sharedSrc, 'protocol/dto.ts'), 'utf8')
    expect(source).toContain("type: 'thinking_delta'")
    expect(source).toContain("type: 'thinking_complete'")
  })

  it('G3: OmpAgent advertises branching', () => {
    const source = readFileSync(join(sharedSrc, 'agent/omp-agent.ts'), 'utf8')
    expect(source).toContain('override get supportsBranching')
    expect(ROX_CLI_PARITY_MATRIX.find((row) => row.id === 'G3')?.compatibilityId).toBe('branch')
  })

  it('G4: OMP skills discovery stays read-only with import RPC id', () => {
    expect(OMP_GLOBAL_SKILLS_DIR).toContain('.omp')
    expect(OMP_WORKSPACE_SKILLS_DIR).toBe('.omp/skills')
    expect(ROX_CLI_PARITY_MATRIX.find((row) => row.id === 'G4')?.compatibilityId).toBe('skills:importOmp')
  })
})
