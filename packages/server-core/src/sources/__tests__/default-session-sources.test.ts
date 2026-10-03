import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureBuiltinMcpSources } from '@rox/shared/sources/builtin-mcp'
import { resolveDefaultSessionSources } from '../default-session-sources'

describe('default session MCP selection', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'session-mcp-defaults-'))
    ensureBuiltinMcpSources(root)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('attaches public and local servers when no explicit defaults exist', () => {
    const selected = resolveDefaultSessionSources(root)
    expect(selected).toContain('deepwiki')
    expect(selected).toContain('context7')
    expect(selected).toContain('playwright')
    expect(selected).toContain('codegraph')
    expect(selected).toContain('qmd')
    expect(selected).toContain('qdrant')
    expect(selected.filter(slug => slug === 'deepwiki')).toHaveLength(1)
  })

  it('honors workspace default toggles and removes duplicate selections', () => {
    expect(resolveDefaultSessionSources(root, undefined, ['notes', 'deepwiki', 'deepwiki'])).toEqual(['notes', 'deepwiki'])
    expect(resolveDefaultSessionSources(root, undefined, [])).toEqual([])
  })

  it('respects an explicitly empty or restricted per-chat source selection', () => {
    expect(resolveDefaultSessionSources(root, [], ['notes'])).toEqual([])
    expect(resolveDefaultSessionSources(root, ['notes'], ['context7'])).toEqual(['notes'])
  })

  it('keeps a source disabled by the user out of automatic chat selection', () => {
    const path = join(root, 'sources', 'context7', 'config.json')
    const config = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify({ ...config, enabled: false }))
    expect(resolveDefaultSessionSources(root)).not.toContain('context7')
  })

  it('keeps account-dependent defaults selected while credentials are being set up', () => {
    expect(resolveDefaultSessionSources(root)).toContain('firecrawl-mcp')
    expect(resolveDefaultSessionSources(root)).toContain('telegram-mcp')
    expect(resolveDefaultSessionSources(root)).toContain('weaviate')
    expect(resolveDefaultSessionSources(root)).toContain('mem0')
  })
})
