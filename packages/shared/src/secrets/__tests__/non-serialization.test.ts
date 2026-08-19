/**
 * Non-serialization guarantees: resolved secret values must reach ONLY the
 * agent subprocess env — never prompts, session transcripts, persisted
 * config, settings-RPC payloads, or value-free diagnostics.
 *
 * Simulates the real injection path in a subprocess (CONFIG_DIR is captured
 * at module load; test files share one module registry):
 *   refreshRuntimeSecretEnv → fragment → getRuntimeEnvOverrides → subprocess env
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { redactSecrets } from '../redact.ts'

const RUNTIME_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'runtime.ts')).href
const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'config', 'storage.ts')).href

const SECRET_VALUE = 'sk-live-secret-9f8e7d6c5b'

function setupConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-secrets-nonserial-'))
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

/**
 * Runs the full injection path in a subprocess and returns a JSON snapshot of
 * every surface that must stay clean plus the one surface that must carry the
 * value (the spawn env composition).
 */
function runInjectionScenario(configDir: string): { stdout: string; stderr: string; exitCode: number } {
  const code = `
    import { refreshRuntimeSecretEnv } from '${RUNTIME_MODULE_PATH}';
    import { getRuntimeEnvOverrides, getPersistedRuntimeEnvOverrides, getRuntimeSecretRefs, setRuntimeSecretRefs } from '${STORAGE_MODULE_PATH}';
    const envProvider = (values) => ({
      id: 'environment',
      async isAvailable() { return true },
      async resolve(ref) { return values[ref.ref ?? ref.name] ?? null },
    });
    setRuntimeSecretRefs([{ name: 'openai', envVar: 'OPENAI_API_KEY', ref: 'ROX_SECRET_OPENAI' }]);
    const result = await refreshRuntimeSecretEnv({ providers: [envProvider({ ROX_SECRET_OPENAI: '${SECRET_VALUE}' })] });

    // mirrors SessionManager / backend env composition at spawn
    const subprocessEnv = { PATH: '/usr/bin', ...getRuntimeEnvOverrides(), CRAFT_WORKSPACE_PATH: '/some/workspace' };

    // transcript-shaped fixture: messages + system prompt + session metadata
    const transcriptFixture = {
      id: 'session-1',
      systemPrompt: 'You are a helpful coding agent.',
      config: {
        model: 'kimi-K3',
        permissionMode: 'allow-all',
        secretRefs: getRuntimeSecretRefs(),
        persistedEnvOverrides: getPersistedRuntimeEnvOverrides(),
      },
      messages: [
        { role: 'user', content: 'deploy the app' },
        { role: 'assistant', content: 'Using the configured credentials…' },
      ],
    };

    console.log(JSON.stringify({
      subprocessEnv,
      settingsRpcPayload: getPersistedRuntimeEnvOverrides(),
      secretRefs: getRuntimeSecretRefs(),
      transcript: transcriptFixture,
      diagnostics: result.diagnostics,
    }));
  `
  const run = Bun.spawnSync([process.execPath, '--eval', code], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    stdout: run.stdout.toString().trim(),
    stderr: run.stderr.toString(),
    exitCode: run.exitCode ?? 1,
  }
}

describe('injection path mutates only the subprocess env', () => {
  it('value reaches the spawn env; every serialization surface stays clean', () => {
    const configDir = setupConfigDir()
    const r = runInjectionScenario(configDir)
    expect(r.exitCode).toBe(0)
    const out = JSON.parse(r.stdout)

    // the ONE intended surface
    expect(out.subprocessEnv.OPENAI_API_KEY).toBe(SECRET_VALUE)

    // settings-RPC payload (renderer-facing)
    expect(JSON.stringify(out.settingsRpcPayload)).not.toContain(SECRET_VALUE)
    expect(out.settingsRpcPayload.OPENAI_API_KEY).toBeUndefined()

    // configured refs (persisted + returned to callers)
    expect(JSON.stringify(out.secretRefs)).not.toContain(SECRET_VALUE)

    // session transcript fixture
    expect(JSON.stringify(out.transcript)).not.toContain(SECRET_VALUE)

    // resolution diagnostics
    expect(JSON.stringify(out.diagnostics)).not.toContain(SECRET_VALUE)

    // persisted config on disk: refs yes, values no
    const onDisk = readFileSync(join(configDir, 'config.json'), 'utf8')
    expect(onDisk).not.toContain(SECRET_VALUE)
    expect(onDisk).toContain('ROX_SECRET_OPENAI')
  })
})

describe('redaction safety net', () => {
  it('redactSecrets masks a value that accidentally lands in transcript text', () => {
    const leakyTranscriptLine = `tool result: Authorization: Bearer ${SECRET_VALUE} accepted`
    const cleaned = redactSecrets(leakyTranscriptLine, [SECRET_VALUE])
    expect(cleaned).not.toContain(SECRET_VALUE)
    expect(cleaned).toBe('tool result: Authorization: Bearer ***REDACTED*** accepted')
  })
})
