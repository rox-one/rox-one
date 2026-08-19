/**
 * Stdio MCP subprocess env blocklist — regression tests.
 *
 * The blocklist in client.ts predates the secrets runtime: ROX_SECRET_* (the
 * env-provider staging prefix, see secrets/providers/environment.ts) and
 * INFISICAL_TOKEN (infisical provider auth) rode through process.env into
 * every stdio MCP server subprocess. The pre-existing suite was FALSE-GREEN
 * here — disabling the whole blocklist kept it green — so these tests assert
 * against a REAL spawned MCP server fixture's own process env, not only the
 * transport params object.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CraftMcpClient } from '../client.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = (name: string) => join(HERE, 'fixtures', name)

const STAGING_VARS: Record<string, string> = {
  ROX_SECRET_TEST_DB: 'supersecret-db-url',
  ROX_SECRET_TEST_OTHER: 'another-staged-secret',
  INFISICAL_TOKEN: 'infisical-token-value',
  ANTHROPIC_API_KEY: 'should-be-blocked',
  MCP_PROBE_SAFE_VAR: 'visible-to-child',
}

const saved: Record<string, string | undefined> = {}

function setStagingEnv(): void {
  for (const [key, value] of Object.entries(STAGING_VARS)) {
    saved[key] = process.env[key]
    process.env[key] = value
  }
}

afterEach(() => {
  for (const key of Object.keys(STAGING_VARS)) {
    if (saved[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = saved[key]
    }
    delete saved[key]
  }
})

/** Env the StdioClientTransport will spawn with (white-box seam used by the adversary suite). */
function spawnedEnv(client: CraftMcpClient): Record<string, string> {
  const params = (client as unknown as { transport?: { _serverParams?: { env?: Record<string, string> } } })
    .transport?._serverParams
  if (!params?.env) throw new Error('test setup: transport has no _serverParams.env')
  return params.env
}

describe('stdio MCP subprocess env blocklist', () => {
  it('excludes secrets-runtime staging vars from the spawn env (transport params)', () => {
    setStagingEnv()
    const client = new CraftMcpClient({ transport: 'stdio', command: 'true' })
    const env = spawnedEnv(client)

    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.INFISICAL_TOKEN).toBeUndefined()
    expect(env.ROX_SECRET_TEST_DB).toBeUndefined()
    expect(env.ROX_SECRET_TEST_OTHER).toBeUndefined()
    expect(env.MCP_PROBE_SAFE_VAR).toBe('visible-to-child')
  })

  it('lets explicit config.env entries win over the inherited-env filter', () => {
    // Documented semantics: the blocklist filters the INHERITED process.env;
    // values the source config sets explicitly are user intent (e.g. a source
    // that legitimately needs a token declares it in its own config).
    setStagingEnv()
    const client = new CraftMcpClient({
      transport: 'stdio',
      command: 'true',
      env: { ANTHROPIC_API_KEY: 'explicit-config-value' },
    })
    const env = spawnedEnv(client)
    expect(env.ANTHROPIC_API_KEY).toBe('explicit-config-value')
    expect(env.ROX_SECRET_TEST_DB).toBeUndefined()
  })

  it('spawns a real MCP server whose own process env excludes blocked vars', async () => {
    setStagingEnv()
    const client = new CraftMcpClient({
      transport: 'stdio',
      command: 'node',
      args: [FIXTURE('mcp-server-env-probe.mjs')],
    })
    try {
      const result = (await client.callTool('probe_env', {
        names: Object.keys(STAGING_VARS),
      })) as { content: Array<{ type: string; text?: string }> }
      const presence = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, boolean>

      // Asserted inside the SPAWNED process — disabling the blocklist flips
      // these to true and fails the test (no false-green).
      expect(presence.ANTHROPIC_API_KEY).toBe(false)
      expect(presence.INFISICAL_TOKEN).toBe(false)
      expect(presence.ROX_SECRET_TEST_DB).toBe(false)
      expect(presence.ROX_SECRET_TEST_OTHER).toBe(false)
      expect(presence.MCP_PROBE_SAFE_VAR).toBe(true)
    } finally {
      await client.close().catch(() => {})
    }
  }, 15_000)
})
