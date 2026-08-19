/**
 * validators.ts — additive runtime.secretRefs validation in StoredConfigSchema.
 * CONFIG_DIR captured at module load → subprocess per scenario.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const VALIDATORS_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'validators.ts')).href

function setupConfigDir(configJson: unknown) {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-validate-secret-refs-'))
  const workspaceRoot = join(configDir, 'workspaces', 'ws')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(configJson))
  return configDir
}

function runValidate(configDir: string): { stdout: string; stderr: string; exitCode: number } {
  const run = Bun.spawnSync(
    [
      process.execPath,
      '--eval',
      `import { validateConfig } from '${VALIDATORS_MODULE_PATH}'; console.log(JSON.stringify(validateConfig()))`,
    ],
    {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  return {
    stdout: run.stdout.toString().trim(),
    stderr: run.stderr.toString(),
    exitCode: run.exitCode ?? 1,
  }
}

const BASE_CONFIG = {
  workspaces: [],
  activeWorkspaceId: null,
  activeSessionId: null,
}

describe('validateConfig — runtime.secretRefs', () => {
  it('accepts a config without runtime (unchanged behavior)', () => {
    const configDir = setupConfigDir(BASE_CONFIG)
    const r = runValidate(configDir)
    expect(r.exitCode).toBe(0)
    const result = JSON.parse(r.stdout)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('accepts valid secretRefs entries', () => {
    const configDir = setupConfigDir({
      ...BASE_CONFIG,
      runtime: {
        envOverrides: { FOO: 'bar' },
        secretRefs: [
          { name: 'openai', envVar: 'OPENAI_API_KEY' },
          { name: 'db', envVar: 'DB_URL', provider: 'infisical', ref: 'DB_URL' },
        ],
      },
    })
    const r = runValidate(configDir)
    expect(r.exitCode).toBe(0)
    const result = JSON.parse(r.stdout)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('flags entries with invalid envVar / empty name / unknown provider', () => {
    const configDir = setupConfigDir({
      ...BASE_CONFIG,
      runtime: {
        secretRefs: [
          { name: '', envVar: 'OK_VAR' },
          { name: 'bad', envVar: 'not a var' },
          { name: 'bad2', envVar: 'OK_VAR', provider: 'vault' },
        ],
      },
    })
    const r = runValidate(configDir)
    expect(r.exitCode).toBe(0)
    const result = JSON.parse(r.stdout)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
    const paths = result.errors.map((e: { path: string }) => e.path).join('\n')
    expect(paths).toContain('runtime.secretRefs')
  })

  it('flags secretRefs that are not an array', () => {
    const configDir = setupConfigDir({
      ...BASE_CONFIG,
      runtime: { secretRefs: { name: 'x' } },
    })
    const r = runValidate(configDir)
    const result = JSON.parse(r.stdout)
    expect(result.valid).toBe(false)
  })
})
