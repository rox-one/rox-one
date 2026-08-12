/**
 * OMP source-proxy chain — regression tests.
 *
 * Proves the full MCP-source → OMP host-tool chain end to end:
 *
 *   MCP source (real stdio MCP server fixture)
 *     → McpClientPool proxy defs (mcp__{slug}__{tool})
 *     → buildSessionToolDefs({ includePoolProxyDefs: true })
 *     → OmpAgent set_host_tools
 *     → (fake) OMP subprocess issues host_tool_call
 *     → OmpAgent.executeHostSessionTool → mcpPool.callTool
 *     → result flows back to OMP as host_tool_result
 *
 * The OMP side is a fake NDJSON subprocess (fixtures/fake-omp-rpc.mjs)
 * injected via OMP_CLI_PATH; it journals every frame so the test can assert
 * what crossed the process boundary. The MCP side is a REAL stdio MCP server
 * (mcp/__tests__/fixtures/mcp-server-echo.mjs), so pool registration,
 * proxy-name mapping, and call dispatch run against the actual protocol.
 *
 * NOTE: omp-agent.ts is owned by another workstream — this file imports
 * OmpAgent but must never modify it. A failure here is a REPORT, not a fix.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OmpAgent } from '../omp-agent.ts'
import { buildSessionToolDefs } from '../session-tool-defs.ts'
import { McpClientPool } from '../../mcp/mcp-pool.ts'
import {
  createMockBackendConfig,
  createMockSession,
  createMockWorkspace,
} from './test-utils.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE_OMP = join(HERE, 'fixtures', 'fake-omp-rpc.mjs')
const MCP_ECHO_SERVER = join(HERE, '..', '..', 'mcp', '__tests__', 'fixtures', 'mcp-server-echo.mjs')

const SOURCE_SLUG = 'ompsrc'
const PROXY_TOOL = `mcp__${SOURCE_SLUG}__echo`

interface JournalEntry {
  kind?: string
  dir?: string
  type?: string
  names?: string[]
  id?: string
  result?: { content?: Array<{ type: string; text?: string }> }
  isError?: boolean
}

function readJournal(path: string): JournalEntry[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as JournalEntry)
}

describe('OMP source-proxy chain', () => {
  let workDir: string
  let journalPath: string
  let pool: McpClientPool

  beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'omp-proxy-test-'))
    journalPath = join(workDir, 'fake-omp-journal.jsonl')
    chmodSync(FAKE_OMP, 0o755)

    // Real pool + real stdio MCP source (the echo fixture server).
    pool = new McpClientPool()
    await pool.connect(SOURCE_SLUG, {
      type: 'stdio',
      command: 'node',
      args: [MCP_ECHO_SERVER],
    })
  })

  afterEach(async () => {
    delete process.env.OMP_CLI_PATH
    delete process.env.FAKE_OMP_JOURNAL
    delete process.env.FAKE_OMP_HOST_TOOL
    delete process.env.FAKE_OMP_HOST_TOOL_ARGS
    await pool.disconnectAll()
    rmSync(workDir, { recursive: true, force: true })
  })

  it('buildSessionToolDefs includes pool proxy defs only when includePoolProxyDefs is set', () => {
    const withPool = buildSessionToolDefs({ mcpPool: pool, includePoolProxyDefs: true })
    expect(withPool.some((d) => d.name === PROXY_TOOL)).toBe(true)

    const def = withPool.find((d) => d.name === PROXY_TOOL)!
    expect(def.description).toBe('Echo input back')
    expect(def.inputSchema).toMatchObject({ type: 'object' })

    // Pi registers pool defs in a separate register_tools frame and passes
    // false — the merged list must NOT contain them then.
    const withoutPool = buildSessionToolDefs({ mcpPool: pool, includePoolProxyDefs: false })
    expect(withoutPool.some((d) => d.name === PROXY_TOOL)).toBe(false)
  })

  it('routes a host_tool_call from OMP through mcpPool.callTool and back as host_tool_result', async () => {
    process.env.OMP_CLI_PATH = FAKE_OMP
    process.env.FAKE_OMP_JOURNAL = journalPath
    process.env.FAKE_OMP_HOST_TOOL = PROXY_TOOL
    process.env.FAKE_OMP_HOST_TOOL_ARGS = JSON.stringify({ text: 'hello-from-omp' })

    const agent = new OmpAgent(
      createMockBackendConfig({
        workspace: createMockWorkspace({ rootPath: workDir }),
        session: createMockSession({ id: 'omp-proxy-session', workspaceRootPath: workDir }),
        mcpPool: pool,
        isHeadless: true,
      }),
    )

    const events: Array<{ type: string }> = []
    try {
      for await (const event of agent.chat('please call the echo tool')) {
        events.push(event)
      }
    } finally {
      agent.destroy()
    }

    // Turn completed without an error event.
    expect(events.some((e) => e.type === 'complete')).toBe(true)
    expect(events.some((e) => e.type === 'error')).toBe(false)

    const journal = readJournal(journalPath)

    // 1. The pool proxy def was registered into OMP via set_host_tools.
    const registrations = journal.filter((e) => e.kind === 'set_host_tools')
    expect(registrations.length).toBeGreaterThan(0)
    expect(registrations.some((e) => e.names?.includes(PROXY_TOOL))).toBe(true)

    // 2. The fake OMP issued host_tool_call and got a real MCP result back.
    const hostResult = journal.find((e) => e.kind === 'host_tool_result')
    expect(hostResult).toBeDefined()
    expect(hostResult!.id).toBe('htc-1')
    expect(hostResult!.isError).toBe(false)
    expect(hostResult!.result?.content?.[0]?.text).toBe('echo:hello-from-omp')
  }, 30000)
})
