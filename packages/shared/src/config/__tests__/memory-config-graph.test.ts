/**
 * memory.graph / graphSources / updateMemoryConfig (cognee PR6).
 * Uses subprocesses so CRAFT_CONFIG_DIR is captured fresh (see memory-config.test.ts).
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync(
    [process.execPath, '--eval', `import { getMemoryConfig, updateMemoryConfig, isGraphSourceEnabled } from '${STORAGE_MODULE_PATH}'; ${code}`],
    { env: { ...process.env, CRAFT_CONFIG_DIR: configDir, ROX_CONFIG_DIR: configDir }, stdout: 'pipe', stderr: 'pipe' },
  )
  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }
  return run.stdout.toString().trim()
}

function setupConfigDir(memory?: unknown): string {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-memory-graph-'))
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      workspaces: [{ id: 'ws-1', name: 'My Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
      activeWorkspaceId: 'ws-1',
      activeSessionId: null,
      memory: memory ?? {},
    }),
  )
  return configDir
}

describe('memory graph config (PR6)', () => {
  it('defaults graph true with no graphSources', { timeout: 30_000 }, () => {
    const out = JSON.parse(runEval(setupConfigDir({}), 'console.log(JSON.stringify(getMemoryConfig()))'))
    expect(out.graph).toBe(true)
    expect(out.graphSources).toBeUndefined()
  })

  it('updateMemoryConfig persists graphSources; missing keys stay on', { timeout: 30_000 }, () => {
    const dir = setupConfigDir({ graph: true })
    const out = JSON.parse(
      runEval(
        dir,
        `const next = updateMemoryConfig({ graph: true, graphSources: { mail: false, chats: false } });
         console.log(JSON.stringify({
           next,
           mail: isGraphSourceEnabled(next.graphSources, 'mail'),
           notes: isGraphSourceEnabled(next.graphSources, 'notes'),
           re: getMemoryConfig().graphSources,
         }))`,
      ),
    )
    expect(out.next.graphSources.mail).toBe(false)
    expect(out.mail).toBe(false)
    expect(out.notes).toBe(true)
    expect(out.re.mail).toBe(false)
  })

  it('graph:false round-trips', { timeout: 30_000 }, () => {
    const out = JSON.parse(
      runEval(
        setupConfigDir({}),
        `updateMemoryConfig({ graph: false }); console.log(JSON.stringify(getMemoryConfig()))`,
      ),
    )
    expect(out.graph).toBe(false)
  })
})
