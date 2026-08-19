/**
 * secrets/runtime.ts — bridge between config runtime.secretRefs and the
 * spawn-time env fragment consumed by getRuntimeEnvOverrides().
 *
 * CONFIG_DIR is captured at module load and test files share one module
 * registry → each scenario runs in a subprocess (same pattern as
 * config/__tests__/env-overrides.test.ts).
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const RUNTIME_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'runtime.ts')).href
const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'config', 'storage.ts')).href
const REDACT_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'redact.ts')).href

function setupConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-secrets-runtime-'))
  const workspaceRoot = join(configDir, 'workspaces', 'ws')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify({ id: 'ws-1', name: 'WS', slug: 'ws', createdAt: Date.now(), updatedAt: Date.now() }),
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
  return configDir
}

function runScenario(configDir: string, code: string): { stdout: string; stderr: string; exitCode: number } {
  const prelude = `
    import { refreshRuntimeSecretEnv } from '${RUNTIME_MODULE_PATH}';
    import { getRuntimeEnvOverrides, getPersistedRuntimeEnvOverrides, getRuntimeSecretEnvFragment, setRuntimeSecretRefs, setRuntimeEnvOverrides } from '${STORAGE_MODULE_PATH}';
    import { redactRegisteredSecrets } from '${REDACT_MODULE_PATH}';
    const envProvider = (values) => ({
      id: 'environment',
      async isAvailable() { return true },
      async resolve(ref) { return values[ref.ref ?? ref.name] ?? null },
    });
  `
  const run = Bun.spawnSync(
    [process.execPath, '--eval', `${prelude}\n${code}`],
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

describe('refreshRuntimeSecretEnv', () => {
  it('resolves injected refs and populates the spawn env fragment', () => {
    const configDir = setupConfigDir()
    const r = runScenario(
      configDir,
      `const result = await refreshRuntimeSecretEnv({
        refs: [{ name: 'openai', envVar: 'OPENAI_API_KEY', ref: 'ROX_SECRET_OPENAI' }],
        providers: [envProvider({ ROX_SECRET_OPENAI: 'sk-runtime-value' })],
      });
      console.log(JSON.stringify({ result: result.env, fragment: getRuntimeSecretEnvFragment(), spawn: getRuntimeEnvOverrides() }))`,
    )
    expect(r.exitCode).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.result).toEqual({ OPENAI_API_KEY: 'sk-runtime-value' })
    expect(out.fragment).toEqual({ OPENAI_API_KEY: 'sk-runtime-value' })
    expect(out.spawn).toEqual({ OPENAI_API_KEY: 'sk-runtime-value' })
  })

  it('clears the fragment when no refs are configured', () => {
    const configDir = setupConfigDir()
    const r = runScenario(
      configDir,
      `await refreshRuntimeSecretEnv({
        refs: [{ name: 'openai', envVar: 'OPENAI_API_KEY', ref: 'ROX_SECRET_OPENAI' }],
        providers: [envProvider({ ROX_SECRET_OPENAI: 'sk-runtime-value' })],
      });
      await refreshRuntimeSecretEnv({ refs: [], providers: [envProvider({})] });
      console.log(JSON.stringify({ fragment: getRuntimeSecretEnvFragment(), spawn: getRuntimeEnvOverrides() }))`,
    )
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ fragment: {}, spawn: {} })
  })

  it('registers resolved values for redaction', () => {
    const configDir = setupConfigDir()
    const r = runScenario(
      configDir,
      `await refreshRuntimeSecretEnv({
        refs: [{ name: 'openai', envVar: 'OPENAI_API_KEY', ref: 'ROX_SECRET_OPENAI' }],
        providers: [envProvider({ ROX_SECRET_OPENAI: 'sk-redact-me-please' })],
      });
      console.log(redactRegisteredSecrets('leaking sk-redact-me-please here'))`,
    )
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe('leaking ***REDACTED*** here')
  })

  it('reads refs from config when none are injected', () => {
    const configDir = setupConfigDir()
    const r = runScenario(
      configDir,
      `setRuntimeSecretRefs([{ name: 'fromConfig', envVar: 'FROM_CONFIG', ref: 'ROX_SECRET_FROM_CONFIG' }]);
       const result = await refreshRuntimeSecretEnv({ providers: [envProvider({ ROX_SECRET_FROM_CONFIG: 'config-sourced-value' })] });
       console.log(JSON.stringify({ result: result.env, spawn: getRuntimeEnvOverrides() }))`,
    )
    expect(r.exitCode).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.result).toEqual({ FROM_CONFIG: 'config-sourced-value' })
    expect(out.spawn.FROM_CONFIG).toBe('config-sourced-value')
  })

  it('never throws, even when a provider blows up unexpectedly', () => {
    const configDir = setupConfigDir()
    const r = runScenario(
      configDir,
      `const broken = {
        id: 'environment',
        async isAvailable() { throw new Error('catastrophic') },
        async resolve() { throw new Error('catastrophic') },
      };
      const result = await refreshRuntimeSecretEnv({
        refs: [{ name: 'x', envVar: 'X', ref: 'X' }],
        providers: [broken],
      });
      console.log(JSON.stringify(result.env))`,
    )
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({})
  })

  it('merges secrets over plain envOverrides; persisted getter stays clean', () => {
    const configDir = setupConfigDir()
    const r = runScenario(
      configDir,
      `setRuntimeEnvOverrides({ PLAIN: 'plain', SHARED: 'plain-value' });
       await refreshRuntimeSecretEnv({
         refs: [{ name: 's', envVar: 'SHARED', ref: 'ROX_SECRET_S' }],
         providers: [envProvider({ ROX_SECRET_S: 'secret-value' })],
       });
       console.log(JSON.stringify({ spawn: getRuntimeEnvOverrides(), persisted: getPersistedRuntimeEnvOverrides() }))`,
    )
    expect(r.exitCode).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.spawn).toEqual({ PLAIN: 'plain', SHARED: 'secret-value' })
    expect(out.persisted).toEqual({ PLAIN: 'plain', SHARED: 'plain-value' })
  })

  it('a slow stale refresh must not overwrite a newer completed refresh', () => {
    const configDir = setupConfigDir()
    const r = runScenario(
      configDir,
      `const slow = {
         id: 'environment',
         async isAvailable() { return true },
         async resolve(ref) {
           await new Promise((res) => setTimeout(res, 150));
           return 'OLD-VALUE';
         },
       };
       const fast = envProvider({ K: 'NEW-VALUE' });
       const stale = refreshRuntimeSecretEnv({ refs: [{ name: 'k', envVar: 'K', ref: 'K' }], providers: [slow] });
       await refreshRuntimeSecretEnv({ refs: [{ name: 'k', envVar: 'K', ref: 'K' }], providers: [fast] });
       await stale;
       console.log(JSON.stringify(getRuntimeSecretEnvFragment()))`,
    )
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ K: 'NEW-VALUE' })
  })
})
