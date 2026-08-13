/**
 * settings:getSecretRefs / settings:setSecretRefs
 *
 * Runs in a spawned subprocess with an isolated CRAFT_CONFIG_DIR because
 * packages/shared/config/paths.ts captures CONFIG_DIR at module load.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..', '..')
const PLANTED = 'sk-planted-must-not-reach-renderer'

function setupConfigDir(): string {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-secret-refs-rpc-'))
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
    JSON.stringify({ version: 'test', description: 'test', defaults: {}, workspaceDefaults: {} }),
  )
  return configDir
}

function runSub(configDir: string, script: string, extraEnv: Record<string, string | undefined> = {}): {
  exitCode: number
  stdout: string
  stderr: string
} {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.INFISICAL_TOKEN
  delete env.INFISICAL_PROJECT_ID
  delete env.INFISICAL_ENVIRONMENT
  env.CRAFT_CONFIG_DIR = configDir
  env.CRAFT_TEST_ROOT = REPO_ROOT
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  // bun -e resolves @craft-agent/* from the primary checkout's node_modules
  // (not this worktree). A file inside the worktree uses worktree sources.
  const scriptPath = join(
    import.meta.dir,
    `_rpc_spawn_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}.ts`,
  )
  writeFileSync(scriptPath, script)
  try {
    const result = Bun.spawnSync([process.execPath, scriptPath], {
      cwd: REPO_ROOT,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return {
      exitCode: result.exitCode ?? -1,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    }
  } finally {
    try { unlinkSync(scriptPath) } catch { /* best-effort */ }
  }
}

const SETUP = [
  'const handlers = new Map();',
  'const fakeServer = {',
  '  handle: (ch, fn) => handlers.set(ch, fn),',
  '  push: () => {},',
  '  invokeClient: async () => undefined,',
  '  hasClientCapability: () => false,',
  '  findClientsWithCapability: () => [],',
  '};',
  "const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol');",
  'const { registerSettingsHandlers, HANDLED_CHANNELS } = await import(',
  "  process.env.CRAFT_TEST_ROOT + '/packages/server-core/src/handlers/rpc/settings.ts'",
  ');',
  'registerSettingsHandlers(fakeServer, {',
  '  sessionManager: {},',
  '  oauthFlowStore: {},',
  '  platform: {',
  "    appRootPath: '/', resourcesPath: '/', isPackaged: false, appVersion: '0.0.0-test', isDebugMode: true,",
  '    logger: { info() {}, warn() {}, error() {}, debug() {} },',
  "    imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },",
  '  },',
  '});',
  'const invoke = async (channel, ...args) => {',
  '  const handler = handlers.get(channel);',
  "  if (!handler) throw new Error('no handler for ' + channel);",
  '  return handler({ clientId: "c1", workspaceId: null }, ...args);',
  '};',
].join('\n')

describe('settings secretRef RPC (subprocess)', () => {
  test('registers getSecretRefs / setSecretRefs', () => {
    const configDir = setupConfigDir()
    const r = runSub(configDir, [
      SETUP,
      'if (!HANDLED_CHANNELS.includes(RPC_CHANNELS.settings.GET_SECRET_REFS)) throw new Error("GET_SECRET_REFS missing from HANDLED_CHANNELS");',
      'if (!HANDLED_CHANNELS.includes(RPC_CHANNELS.settings.SET_SECRET_REFS)) throw new Error("SET_SECRET_REFS missing from HANDLED_CHANNELS");',
      'if (!handlers.has(RPC_CHANNELS.settings.GET_SECRET_REFS)) throw new Error("no GET handler");',
      'if (!handlers.has(RPC_CHANNELS.settings.SET_SECRET_REFS)) throw new Error("no SET handler");',
      'console.log(JSON.stringify({ ok: true }));',
      'process.exit(0);',
    ].join('\n'))
    try {
      if (r.exitCode !== 0) {
        throw new Error('register failed\nSTDERR:\n' + r.stderr.slice(0, 4000) + '\nSTDOUT:\n' + r.stdout.slice(0, 2000))
      }
      expect(r.stdout).toContain('"ok":true')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('GET returns refs only — never a value field, even if planted', () => {
    const configDir = setupConfigDir()
    const cfgPath = join(configDir, 'config.json')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    cfg.runtime = {
      secretRefs: [{ name: 'openai', envVar: 'OPENAI_API_KEY', ref: 'ROX_SECRET_OPENAI', value: PLANTED }],
    }
    writeFileSync(cfgPath, JSON.stringify(cfg))

    const r = runSub(configDir, [
      SETUP,
      'const payload = await invoke(RPC_CHANNELS.settings.GET_SECRET_REFS);',
      `if (JSON.stringify(payload).includes(${JSON.stringify(PLANTED)})) throw new Error('GET leaked planted value');`,
      'if (!Array.isArray(payload.refs)) throw new Error("refs not array");',
      'if (payload.refs[0]?.value !== undefined) throw new Error("value field present");',
      'if (Object.keys(payload.refs[0]).includes("value")) throw new Error("value key present");',
      'if (payload.infisical.errorCode !== "INFISICAL_UNAVAILABLE") throw new Error("expected INFISICAL_UNAVAILABLE, got " + JSON.stringify(payload.infisical));',
      'console.log(JSON.stringify({ ok: true, keys: Object.keys(payload.refs[0]).sort(), infisical: payload.infisical }));',
      'process.exit(0);',
    ].join('\n'))
    try {
      if (r.exitCode !== 0) {
        throw new Error('GET failed\nSTDERR:\n' + r.stderr.slice(0, 4000) + '\nSTDOUT:\n' + r.stdout.slice(0, 2000))
      }
      const out = JSON.parse(r.stdout.trim().split('\n').at(-1)!)
      expect(out.ok).toBe(true)
      expect(out.keys).not.toContain('value')
      expect(out.infisical).toEqual({ available: false, errorCode: 'INFISICAL_UNAVAILABLE' })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('SET PATH / NODE_OPTIONS rejects with typed SECRET_ENVVAR_DENIED', () => {
    const configDir = setupConfigDir()
    const r = runSub(configDir, [
      SETUP,
      'const denied = [];',
      'for (const envVar of ["PATH", "NODE_OPTIONS"]) {',
      '  try {',
      '    await invoke(RPC_CHANNELS.settings.SET_SECRET_REFS, [{ name: "x", envVar }]);',
      '    denied.push({ envVar, ok: true });',
      '  } catch (e) {',
      '    denied.push({ envVar, code: e.code, name: e.name, message: e.message });',
      '  }',
      '}',
      'console.log(JSON.stringify({ denied }));',
      'process.exit(0);',
    ].join('\n'))
    try {
      if (r.exitCode !== 0) {
        throw new Error('SET deny failed\nSTDERR:\n' + r.stderr.slice(0, 4000) + '\nSTDOUT:\n' + r.stdout.slice(0, 2000))
      }
      const out = JSON.parse(r.stdout.trim().split('\n').at(-1)!)
      for (const row of out.denied) {
        expect(row.code).toBe('SECRET_ENVVAR_DENIED')
        expect(row.ok).toBeUndefined()
      }
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('SET persists refs; GET has no values; spawn env has the resolved var', () => {
    const configDir = setupConfigDir()
    const secretValue = 'sk-runtime-resolved-only'
    const r = runSub(configDir, [
      SETUP,
      "const { refreshRuntimeSecretEnv } = await import('@craft-agent/shared/secrets');",
      "const { getRuntimeEnvOverrides, getPersistedRuntimeEnvOverrides } = await import('@craft-agent/shared/config');",
      'const setResult = await invoke(RPC_CHANNELS.settings.SET_SECRET_REFS, [{ name: "openai", envVar: "OPENAI_API_KEY", ref: "ROX_SECRET_OPENAI" }]);',
      'if (!setResult?.success) throw new Error("SET failed: " + JSON.stringify(setResult));',
      'const getAfter = await invoke(RPC_CHANNELS.settings.GET_SECRET_REFS);',
      `const secretValue = ${JSON.stringify(secretValue)};`,
      'if (JSON.stringify(getAfter).includes(secretValue)) throw new Error("GET leaked resolved value");',
      'if (getAfter.refs[0]?.value !== undefined) throw new Error("GET ref has value");',
      'const envProvider = {',
      '  id: "environment",',
      '  async isAvailable() { return true },',
      '  async resolve(ref) { return (ref.ref ?? ref.name) === "ROX_SECRET_OPENAI" ? secretValue : null },',
      '};',
      'await refreshRuntimeSecretEnv({ providers: [envProvider] });',
      'const spawn = getRuntimeEnvOverrides();',
      'const persisted = getPersistedRuntimeEnvOverrides();',
      'const getAfterRefresh = await invoke(RPC_CHANNELS.settings.GET_SECRET_REFS);',
      'if (spawn.OPENAI_API_KEY !== secretValue) throw new Error("spawn missing resolved var: " + JSON.stringify(spawn));',
      'if (persisted.OPENAI_API_KEY !== undefined) throw new Error("persisted env leaked secret");',
      'if (JSON.stringify(getAfterRefresh).includes(secretValue)) throw new Error("GET after refresh leaked value");',
      'console.log(JSON.stringify({ ok: true, getRefs: getAfter.refs, spawnHas: Object.keys(spawn), persisted }));',
      'process.exit(0);',
    ].join('\n'))
    try {
      if (r.exitCode !== 0) {
        throw new Error('round-trip failed\nSTDERR:\n' + r.stderr.slice(0, 4000) + '\nSTDOUT:\n' + r.stdout.slice(0, 2000))
      }
      const out = JSON.parse(r.stdout.trim().split('\n').at(-1)!)
      expect(out.ok).toBe(true)
      expect(out.getRefs).toEqual([{ name: 'openai', envVar: 'OPENAI_API_KEY', ref: 'ROX_SECRET_OPENAI' }])
      expect(JSON.stringify(out)).not.toContain(secretValue)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
