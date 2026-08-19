/**
 * Inventory 6.5 — one MCP proxy-name builder.
 *
 * packages/shared/CLAUDE.md already requires proxyToolName(slug, name) from
 * mcp/proxy-tool-name.ts. That module was never ported; mcp-pool.ts kept a
 * local sanitize + `mcp__${}` template, and three other production builders
 * invented the same prefix. Dispatch keys drifted in #864 (regression of #498).
 *
 * This suite is the contract + the anti-drift scan. A local
 * sanitizeToolNamePart / `mcp__${` in a listed builder is a regression.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LLM_TOOL_NAME_MAX_LENGTH,
  LLM_TOOL_NAME_PATTERN,
  MCP_PROXY_NAME_PREFIX,
  proxyToolName,
  proxyToolNamePrefix,
  restoreMcpProxyPrefix,
  sanitizeToolNamePart,
  stripMcpProxyPrefix,
} from '../proxy-tool-name.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..')

const PRODUCTION_BUILDERS = [
  'packages/shared/src/mcp/mcp-pool.ts',
  'packages/shared/src/mcp/pool-server.ts',
  'packages/shared/src/agent/permissions-config.ts',
  'packages/shared/src/agent/backend/base-event-adapter.ts',
] as const

describe('proxy-tool-name', () => {
  it('sanitizes characters outside [A-Za-z0-9_-] so OpenAI/Codex accept the name', () => {
    expect(proxyToolName('dingtalk-ai-table', 'pat.batch_plan')).toBe(
      'mcp__dingtalk-ai-table__pat_batch_plan',
    )
    expect(proxyToolName('my.source', 'foo/bar')).toBe('mcp__my_source__foo_bar')
    expect(sanitizeToolNamePart('')).toBe('tool')
    expect(sanitizeToolNamePart('...')).toBe('___')
    expect(proxyToolName('dingtalk-ai-table', 'pat.batch_plan')).toMatch(LLM_TOOL_NAME_PATTERN)
  })

  it('disambiguates post-sanitization collisions with _2, _3, …', () => {
    const used = new Set<string>()
    const first = proxyToolName('source', 'foo.bar', used)
    used.add(first)
    const second = proxyToolName('source', 'foo/bar', used)
    used.add(second)
    const third = proxyToolName('source', 'foo_bar', used)
    expect([first, second, third]).toEqual([
      'mcp__source__foo_bar',
      'mcp__source__foo_bar_2',
      'mcp__source__foo_bar_3',
    ])
  })

  it('keeps generated names within the 128-char provider limit', () => {
    const name = proxyToolName('source', 'x'.repeat(200))
    expect(name.length).toBeLessThanOrEqual(LLM_TOOL_NAME_MAX_LENGTH)
    expect(name).toMatch(LLM_TOOL_NAME_PATTERN)
    expect(name.startsWith(MCP_PROXY_NAME_PREFIX)).toBe(true)
  })

  it('exposes prefix / strip / restore so pool-server and local-name lookup cannot drift', () => {
    expect(proxyToolNamePrefix('linear')).toBe('mcp__linear__')
    expect(proxyToolNamePrefix('my.source')).toBe('mcp__my_source__')
    expect(stripMcpProxyPrefix('mcp__craft__search_spaces')).toBe('craft__search_spaces')
    expect(restoreMcpProxyPrefix('craft__search_spaces')).toBe('mcp__craft__search_spaces')
    expect(restoreMcpProxyPrefix('mcp__craft__search_spaces')).toBe('mcp__craft__search_spaces')
  })

  it('production builders import this module and do not keep a local mcp__${} template', () => {
    for (const rel of PRODUCTION_BUILDERS) {
      const source = readFileSync(join(REPO_ROOT, rel), 'utf8')
      expect(source, rel).toMatch(/proxy-tool-name\.ts/)
      expect(source, rel).not.toMatch(/function sanitizeToolNamePart/)
      expect(source, rel).not.toMatch(/function buildSafeProxyToolName/)
      expect(source, rel).not.toMatch(/`mcp__\$\{/)
    }
  })
})
