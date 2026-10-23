/**
 * Cognee PR8: memory.graph defaults ON for fresh installs / missing keys.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { DEFAULT_MEMORY_CONFIG } from '../../memory/types.ts'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync(
    [process.execPath, '--eval', `import { getMemoryConfig } from '${STORAGE_MODULE_PATH}'; ${code}`],
    { env: { ...process.env, CRAFT_CONFIG_DIR: configDir, ROX_CONFIG_DIR: configDir }, stdout: 'pipe', stderr: 'pipe' },
  )
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return run.stdout.toString().trim()
}

function setup(memory?: unknown): string {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-graph-default-'))
  const workspaceRoot = join(configDir, 'workspaces', 'ws')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      workspaces: [{ id: 'ws-1', name: 'WS', rootPath: workspaceRoot, createdAt: Date.now() }],
      activeWorkspaceId: 'ws-1',
      activeSessionId: null,
      ...(memory !== undefined ? { memory } : {}),
    }),
  )
  return configDir
}

describe('memory.graph default-on (PR8)', () => {
  it('DEFAULT_MEMORY_CONFIG.graph is true', () => {
    expect(DEFAULT_MEMORY_CONFIG.graph).toBe(true)
  })

  it('getMemoryConfig() returns graph true when memory key absent', { timeout: 30_000 }, () => {
    const out = JSON.parse(runEval(setup(), 'console.log(JSON.stringify(getMemoryConfig()))'))
    expect(out.graph).toBe(true)
  })

  it('getMemoryConfig() returns graph true when memory object empty', { timeout: 30_000 }, () => {
    const out = JSON.parse(runEval(setup({}), 'console.log(JSON.stringify(getMemoryConfig()))'))
    expect(out.graph).toBe(true)
  })

  it('explicit graph:false is respected', { timeout: 30_000 }, () => {
    const out = JSON.parse(runEval(setup({ graph: false }), 'console.log(JSON.stringify(getMemoryConfig()))'))
    expect(out.graph).toBe(false)
  })
})
