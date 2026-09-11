/**
 * Disk round-trip for AgentIdentity via preferences.json.
 * CONFIG_DIR is captured at module load, so each case runs in a subprocess.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const PREFS_MODULE = pathToFileURL(join(import.meta.dir, '..', 'preferences.ts')).href

function runScript(configDir: string, script: string) {
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('agent identity persistence', () => {
  it('defaults to Agent Rox#001 when preferences.json is missing', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'agent-identity-'))
    try {
      const r = runScript(configDir, `
        import { loadAgentIdentity } from '${PREFS_MODULE}'
        console.log(JSON.stringify(loadAgentIdentity()))
      `)
      expect(r.exitCode).toBe(0)
      expect(JSON.parse(r.stdout)).toEqual({
        name: 'Agent Rox#001',
        persona: '',
        source: 'generated',
      })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('persists a renamed identity and reloads it for new sessions', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'agent-identity-'))
    try {
      const r = runScript(configDir, `
        import { saveAgentIdentity, loadAgentIdentity } from '${PREFS_MODULE}'
        saveAgentIdentity({ name: 'Ada', persona: 'terse reviewer' })
        console.log(JSON.stringify(loadAgentIdentity()))
      `)
      expect(r.exitCode).toBe(0)
      expect(JSON.parse(r.stdout)).toEqual({
        name: 'Ada',
        persona: 'terse reviewer',
        source: 'user',
      })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('reads a user-owned record already on disk', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'agent-identity-'))
    try {
      writeFileSync(
        join(configDir, 'preferences.json'),
        JSON.stringify({
          name: 'User',
          agentIdentity: { name: 'Ada', persona: 'calm', source: 'user' },
        }),
        'utf-8',
      )
      const r = runScript(configDir, `
        import { loadAgentIdentity } from '${PREFS_MODULE}'
        console.log(JSON.stringify(loadAgentIdentity()))
      `)
      expect(r.exitCode).toBe(0)
      expect(JSON.parse(r.stdout)).toEqual({
        name: 'Ada',
        persona: 'calm',
        source: 'user',
      })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
