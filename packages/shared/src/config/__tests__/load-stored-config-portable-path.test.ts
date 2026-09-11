import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { pathToFileURL } from 'url'

/**
 * ROX-BOOT: portable `~/...` workspace roots must not force saveConfig on every
 * loadStoredConfig call (that re-fired ConfigWatcher and flaked ws-rpc).
 */
describe('loadStoredConfig portable rootPath', () => {
  it('does not rewrite config.json when only difference is ~/ vs absolute', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'craft-portable-config-'))
    const relWorkspace = join('.craft-agent-test-ws', `ws-${Date.now()}`)
    const absoluteWorkspace = join(homedir(), relWorkspace)
    mkdirSync(absoluteWorkspace, { recursive: true })
    writeFileSync(
      join(absoluteWorkspace, 'config.json'),
      JSON.stringify(
        {
          id: 'ws-portable-1',
          name: 'Portable WS',
          slug: 'portable-ws',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        null,
        2,
      ),
      'utf-8',
    )

    const portableRoot = `~/${relWorkspace.replace(/\\/g, '/')}`
    const configPath = join(configDir, 'config.json')
    const initial = {
      workspaces: [
        {
          id: 'ws-portable-1',
          name: 'Portable WS',
          slug: 'portable-ws',
          rootPath: portableRoot,
          kind: 'personal',
          createdAt: Date.now(),
        },
      ],
      activeWorkspaceId: 'ws-portable-1',
      activeSessionId: null,
      llmConnections: [],
      cloudRuns: {
        enabled: false,
        provider: 'cloudflare',
        gatewayUrl: 'https://example.invalid',
        defaultMaxWallClockSec: 1,
        defaultMaxLlmTokens: 1,
        defaultMaxArtifactsBytes: 1,
      },
    }
    writeFileSync(configPath, JSON.stringify(initial, null, 2) + '\n', 'utf-8')
    const before = readFileSync(configPath, 'utf-8')
    const beforeMtime = statSync(configPath).mtimeMs

    const storageUrl = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href
    const run = Bun.spawnSync(
      [
        process.execPath,
        '--eval',
        `import { loadStoredConfig } from '${storageUrl}'; const c = loadStoredConfig(); if (!c) throw new Error('null config');`,
      ],
      {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    if (run.exitCode !== 0) {
      throw new Error(run.stderr.toString() || `exit ${run.exitCode}`)
    }

    const after = readFileSync(configPath, 'utf-8')
    const afterMtime = statSync(configPath).mtimeMs
    expect(after).toBe(before)
    expect(afterMtime).toBe(beforeMtime)
  })
})
