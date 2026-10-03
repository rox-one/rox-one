import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('new workspace MCP installation', () => {
  it('seeds the requested MCP catalog and automatically selects usable servers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-mcp-install-'))
    roots.push(root)
    const script = `
      const { ensureConfigDir } = await import(${JSON.stringify(join(import.meta.dir, '..', '..', 'config', 'storage.ts'))});
      ensureConfigDir();
      const { createWorkspaceAtPath } = await import(${JSON.stringify(join(import.meta.dir, '..', 'storage.ts'))});
      const { loadSourceConfig } = await import(${JSON.stringify(join(import.meta.dir, '..', '..', 'sources', 'storage.ts'))});
      const workspace = createWorkspaceAtPath(process.env.TEST_MCP_WORKSPACE, 'First installation');
      console.log(JSON.stringify({
        selected: workspace.defaults.enabledSourceSlugs,
        deepwiki: loadSourceConfig(process.env.TEST_MCP_WORKSPACE, 'deepwiki'),
        firecrawl: loadSourceConfig(process.env.TEST_MCP_WORKSPACE, 'firecrawl-mcp'),
        legacyApi: loadSourceConfig(process.env.TEST_MCP_WORKSPACE, 'firecrawl'),
        windows: loadSourceConfig(process.env.TEST_MCP_WORKSPACE, 'windows-mcp'),
        qdrant: loadSourceConfig(process.env.TEST_MCP_WORKSPACE, 'qdrant'),
        mem0: loadSourceConfig(process.env.TEST_MCP_WORKSPACE, 'mem0'),
      }));
    `
    const proc = Bun.spawn([process.execPath, '-e', script], {
      env: {
        ...process.env,
        CRAFT_CONFIG_DIR: join(root, 'config'), ROX_CONFIG_DIR: join(root, 'config'),
        ROX_LAYOUT_HOME: root, TEST_MCP_WORKSPACE: join(root, 'workspace'),
      }, stdout: 'pipe', stderr: 'pipe',
    })
    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    const result = JSON.parse(output)
    expect(result.selected).toEqual(expect.arrayContaining(['notes', 'deepwiki', 'context7', 'playwright', 'codegraph', 'qmd', 'weaviate', 'qdrant', 'mem0']))
    expect(result.deepwiki.enabled).toBe(true)
    expect(result.deepwiki.connectionStatus).toBe('untested')
    expect(result.firecrawl.type).toBe('mcp')
    expect(result.legacyApi.type).toBe('api')
    expect(result.windows.type).toBe('mcp')
    expect(result.qdrant.mcp.env.QDRANT_LOCAL_PATH).toBe('${SOURCE_DIR}/storage')
    expect(result.mem0.mcp.url).toBe('https://mcp.mem0.ai/mcp')
  })
})
