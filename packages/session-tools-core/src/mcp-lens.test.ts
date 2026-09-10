import { describe, expect, it } from 'bun:test'
import { applyMcpLens, hostToolLoadMode, isEssentialHostTool } from './tool-defs-filtering.ts'

describe('MCP lens', () => {
  it('keeps session tools essential and hides source-proxy tools when enabled', () => {
    expect(isEssentialHostTool('mcp__session__bash')).toBe(true)
    expect(isEssentialHostTool('bash')).toBe(true)
    expect(isEssentialHostTool('mcp__exa__search')).toBe(false)
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
})
