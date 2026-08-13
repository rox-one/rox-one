/**
 * runtime.secretRefs config + resolved-secret env fragment seam.
 * CONFIG_DIR captured at module load → each scenario runs in a subprocess.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function setupConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-secret-refs-'))
  const workspaceRoot = join(configDir, 'workspaces', 'ws')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify({
      id: 'ws-1',
      name: 'WS',
      slug: 'ws',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  )
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      workspaces: [{ id: 'ws-1', name: 'WS', rootPath: workspaceRoot, createdAt: Date.now() }],
      activeWorkspaceId: 'ws-1',
      activeSessionId: null,
      llmConnections: [],
    }),
  )
  writeFileSync(
    join(configDir, 'config-defaults.json'),
    JSON.stringify({
      version: 'test',
      description: 'test',
      defaults: {},
      workspaceDefaults: {},
    }),
  )
  return configDir
}

function runEval(configDir: string, code: string): { stdout: string; stderr: string; exitCode: number } {
  const run = Bun.spawnSync(
    [
      process.execPath,
      '--eval',
      `import { getRuntimeSecretRefs, setRuntimeSecretRefs, getRuntimeEnvOverrides, getPersistedRuntimeEnvOverrides, setRuntimeEnvOverrides, setRuntimeSecretEnvFragment, getRuntimeSecretEnvFragment } from '${STORAGE_MODULE_PATH}'; ${code}`,
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

describe('setRuntimeSecretRefs / getRuntimeSecretRefs', () => {
  it('persists valid entries and reads them back', () => {
    const configDir = setupConfigDir()
    const r = runEval(
      configDir,
      `setRuntimeSecretRefs([{ name: 'openai', envVar: 'OPENAI_API_KEY' }, { name: 'db', envVar: 'DB_URL', provider: 'infisical', ref: 'DB_URL' }]); console.log(JSON.stringify(getRuntimeSecretRefs()))`,
    )
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual([
      { name: 'openai', envVar: 'OPENAI_API_KEY' },
      { name: 'db', envVar: 'DB_URL', provider: 'infisical', ref: 'DB_URL' },
    ])
    // persisted to disk
    const cfg = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
    expect(cfg.runtime.secretRefs).toHaveLength(2)
  })

  it('rejects denylisted / invalid envVar targets', () => {
    const configDir = setupConfigDir()
    for (const envVar of ['PATH', 'NODE_OPTIONS', 'CRAFT_CONFIG_DIR', 'bad-name', '1ABC']) {
      const r = runEval(
        configDir,
        `try { setRuntimeSecretRefs([{ name: 'x', envVar: ${JSON.stringify(envVar)} }]); console.log('OK') } catch (e) { console.log('ERR:' + e.message) }`,
      )
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toMatch(/^ERR:/)
    }
    const cfg = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
    expect(cfg.runtime?.secretRefs ?? []).toEqual([])
  })

  it('rejects PATH and NODE_OPTIONS with typed SECRET_ENVVAR_DENIED', () => {
    const configDir = setupConfigDir()
    for (const envVar of ['PATH', 'NODE_OPTIONS']) {
      const r = runEval(
        configDir,
        `try { setRuntimeSecretRefs([{ name: 'x', envVar: ${JSON.stringify(envVar)} }]); console.log(JSON.stringify({ ok: true })) } catch (e) { console.log(JSON.stringify({ code: e.code, name: e.name, message: e.message })) }`,
      )
      expect(r.exitCode).toBe(0)
      const out = JSON.parse(r.stdout)
      expect(out.code).toBe('SECRET_ENVVAR_DENIED')
      expect(out.name).toBe('SecretConfigError')
      expect(out.message).toContain(envVar)
    }
  })

  it('getRuntimeSecretRefs never includes a value field even if planted in config.json', () => {
    const configDir = setupConfigDir()
    const planted = 'sk-planted-must-not-surface'
    const cfgPath = join(configDir, 'config.json')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    cfg.runtime = {
      secretRefs: [{ name: 'openai', envVar: 'OPENAI_API_KEY', value: planted, extra: 'nope' }],
    }
    writeFileSync(cfgPath, JSON.stringify(cfg))
    const r = runEval(configDir, `console.log(JSON.stringify(getRuntimeSecretRefs()))`)
    expect(r.exitCode).toBe(0)
    const refs = JSON.parse(r.stdout)
    expect(JSON.stringify(refs)).not.toContain(planted)
    expect(refs).toHaveLength(1)
    expect(refs[0].value).toBeUndefined()
    expect(refs[0].extra).toBeUndefined()
    expect(Object.keys(refs[0]).sort()).toEqual(['envVar', 'name'])
  })

  it('rejects empty names, unknown providers and empty refs', () => {
    const configDir = setupConfigDir()
    const cases = [
      `{ name: '', envVar: 'X' }`,
      `{ name: 'x', envVar: 'X', provider: 'vault' }`,
      `{ name: 'x', envVar: 'X', ref: '' }`,
    ]
    for (const entry of cases) {
      const r = runEval(
        configDir,
        `try { setRuntimeSecretRefs([${entry}]); console.log('OK') } catch (e) { console.log('ERR:' + e.message) }`,
      )
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toMatch(/^ERR:/)
    }
  })
})

describe('resolved secret env fragment', () => {
  it('getRuntimeEnvOverrides merges the fragment over plain overrides; persisted getter does not', () => {
    const configDir = setupConfigDir()
    const r = runEval(
      configDir,
      `setRuntimeEnvOverrides({ PLAIN: 'plain', SHARED: 'plain-wins-no' });
       setRuntimeSecretEnvFragment({ SECRET_INJECTED: 's3cr3t-value', SHARED: 'secret-wins' });
       console.log(JSON.stringify({ spawn: getRuntimeEnvOverrides(), persisted: getPersistedRuntimeEnvOverrides() }))`,
    )
    expect(r.exitCode).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.spawn).toEqual({ PLAIN: 'plain', SHARED: 'secret-wins', SECRET_INJECTED: 's3cr3t-value' })
    expect(out.persisted).toEqual({ PLAIN: 'plain', SHARED: 'plain-wins-no' })
  })

  it('fragment is in-memory only — never written to config.json', () => {
    const configDir = setupConfigDir()
    const r = runEval(
      configDir,
      `setRuntimeSecretEnvFragment({ SECRET_INJECTED: 's3cr3t-value' }); console.log(JSON.stringify(getRuntimeSecretEnvFragment()))`,
    )
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ SECRET_INJECTED: 's3cr3t-value' })
    const cfg = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
    expect(JSON.stringify(cfg)).not.toContain('s3cr3t-value')
  })

  it('a fresh process has an empty fragment (no persistence, no stale secrets)', () => {
    const configDir = setupConfigDir()
    const r = runEval(configDir, `console.log(JSON.stringify(getRuntimeEnvOverrides()))`)
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({})
  })
})
