import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const defs = readFileSync(join(__dirname, '..', 'session-tool-defs.ts'), 'utf8')
const omp = readFileSync(join(__dirname, '..', 'omp-agent.ts'), 'utf8')

describe('MCP lens host-tool wiring', () => {
  it('filters source-proxy tools only when mcpLens is on and keeps OMP default off', () => {
    expect(defs).toContain('mcpLens?: boolean')
    expect(defs).toContain('applyMcpLens(unique, true).visible')
    expect(omp).toContain('mcpLens: false')
    expect(omp).toContain("loadMode: 'essential' as const")
  })
})
