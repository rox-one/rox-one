import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyMcpLens,
  hostToolLoadMode,
  isEssentialHostTool,
  SESSION_MCP_ESSENTIAL_SUFFIXES,
} from './tool-defs-filtering.ts'

describe('MCP lens', () => {
  it('keeps session tools essential and hides source-proxy tools when enabled', () => {
    expect(isEssentialHostTool('mcp__session__bash')).toBe(true)
    expect(isEssentialHostTool('bash')).toBe(true)
    expect(isEssentialHostTool('mcp__exa__search')).toBe(false)
    expect(isEssentialHostTool('mcp__session__not_a_catalog_tool')).toBe(false)
    expect(hostToolLoadMode('mcp__exa__search')).toBe('discoverable')

    const tools = [
      { name: 'mcp__session__call_llm' },
      { name: 'mcp__github__list_issues' },
      { name: 'bash' },
    ]
    expect(applyMcpLens(tools, false).hidden).toEqual([])
    const lens = applyMcpLens(tools, true)
    expect(lens.visible.map((tool) => tool.name)).toEqual(['mcp__session__call_llm', 'bash'])
    expect(lens.hidden.map((tool) => tool.name)).toEqual(['mcp__github__list_issues'])
  })

  it('keeps the essential suffix set aligned with SESSION_TOOL_DEFS names', () => {
    const src = readFileSync(join(import.meta.dir, 'tool-defs.ts'), 'utf8')
    const names = [...src.matchAll(/\{ name: '([^']+)'/g)].map((match) => match[1]!)
    expect(names.length).toBeGreaterThan(10)
    expect(new Set(names)).toEqual(SESSION_MCP_ESSENTIAL_SUFFIXES)
  })
})
