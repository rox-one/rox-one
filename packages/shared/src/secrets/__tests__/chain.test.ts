/**
 * secrets/chain.ts — provider chain resolution + spawn env fragment.
 */
import { describe, expect, it } from 'bun:test'
import type { SecretErrorCode, SecretProvider, SecretProviderId, SecretRef } from '../types.ts'
import { SecretResolveError } from '../types.ts'
import { resolveSecretsForSpawn } from '../chain.ts'

function stubProvider(
  id: SecretProviderId,
  values: Record<string, string>,
  opts: { available?: boolean; throwCode?: SecretErrorCode } = {},
): SecretProvider & { calls: SecretRef[] } {
  const calls: SecretRef[] = []
  return {
    id,
    calls,
    async isAvailable() {
      return opts.available ?? true
    },
    async resolve(ref: SecretRef) {
      calls.push(ref)
      if (opts.throwCode) throw new SecretResolveError(opts.throwCode, id, `${id} broke`)
      const key = ref.ref ?? ref.name
      return values[key] ?? null
    },
  }
}

describe('resolveSecretsForSpawn', () => {
  it('resolves entries through the chain in order — first hit wins', async () => {
    const env = stubProvider('environment', { ROX_SECRET_A: 'from-env' })
    const local = stubProvider('local-encrypted', { ROX_SECRET_A: 'from-local' })
    const infisical = stubProvider('infisical', { ROX_SECRET_A: 'from-infisical' })

    const result = await resolveSecretsForSpawn(
      [{ name: 'a', envVar: 'A', ref: 'ROX_SECRET_A' }],
      {},
      { providers: [env, local, infisical] },
    )

    expect(result.env).toEqual({ A: 'from-env' })
    expect(result.values).toEqual(['from-env'])
    expect(result.diagnostics).toEqual([
      { name: 'a', envVar: 'A', status: 'resolved', provider: 'environment' },
    ])
    // later providers never consulted
    expect(local.calls).toHaveLength(0)
    expect(infisical.calls).toHaveLength(0)
  })

  it('falls through to the next provider when earlier ones return null', async () => {
    const env = stubProvider('environment', {})
    const local = stubProvider('local-encrypted', {})
    const infisical = stubProvider('infisical', { DB: 'from-infisical' })

    const result = await resolveSecretsForSpawn(
      [{ name: 'db', envVar: 'DB_URL', ref: 'DB' }],
      {},
      { providers: [env, local, infisical] },
    )

    expect(result.env).toEqual({ DB_URL: 'from-infisical' })
    expect(result.diagnostics[0]).toMatchObject({ status: 'resolved', provider: 'infisical' })
  })

  it('skips unavailable providers in chain mode', async () => {
    const env = stubProvider('environment', {}, { available: false })
    const local = stubProvider('local-encrypted', { K: 'from-local' })

    const result = await resolveSecretsForSpawn(
      [{ name: 'k', envVar: 'K', ref: 'K' }],
      {},
      { providers: [env, local] },
    )

    expect(result.env).toEqual({ K: 'from-local' })
    expect(env.calls).toHaveLength(0)
  })

  it('restricts pinned entries to their provider', async () => {
    const env = stubProvider('environment', { K: 'from-env' })
    const infisical = stubProvider('infisical', { K: 'from-infisical' })

    const result = await resolveSecretsForSpawn(
      [{ name: 'k', envVar: 'K', ref: 'K', provider: 'infisical' }],
      {},
      { providers: [env, infisical] },
    )

    expect(result.env).toEqual({ K: 'from-infisical' })
    expect(env.calls).toHaveLength(0)
  })

  it('reports INFISICAL_UNAVAILABLE when pinned to an unconfigured infisical provider', async () => {
    const infisical = stubProvider('infisical', {}, { available: false, throwCode: 'INFISICAL_UNAVAILABLE' })

    const result = await resolveSecretsForSpawn(
      [{ name: 'k', envVar: 'K', ref: 'K', provider: 'infisical' }],
      {},
      { providers: [infisical] },
    )

    expect(result.env).toEqual({})
    expect(result.diagnostics).toEqual([
      { name: 'k', envVar: 'K', status: 'error', provider: 'infisical', errorCode: 'INFISICAL_UNAVAILABLE', message: 'infisical broke' },
    ])
  })

  it('records operational errors and continues the chain for unpinned entries', async () => {
    const env = stubProvider('environment', {}, { throwCode: 'INFISICAL_UNAVAILABLE' })
    const local = stubProvider('local-encrypted', { K: 'from-local' })

    const result = await resolveSecretsForSpawn(
      [{ name: 'k', envVar: 'K', ref: 'K' }],
      {},
      { providers: [env, local] },
    )

    expect(result.env).toEqual({ K: 'from-local' })
    expect(result.diagnostics[0]).toMatchObject({ status: 'resolved', provider: 'local-encrypted' })
  })

  it('reports SECRET_NOT_FOUND when no provider resolves an entry', async () => {
    const env = stubProvider('environment', {})
    const local = stubProvider('local-encrypted', {})

    const result = await resolveSecretsForSpawn(
      [{ name: 'missing', envVar: 'MISSING_VAR', ref: 'NOPE' }],
      {},
      { providers: [env, local] },
    )

    expect(result.env).toEqual({})
    expect(result.values).toEqual([])
    expect(result.diagnostics).toEqual([
      { name: 'missing', envVar: 'MISSING_VAR', status: 'not-found', errorCode: 'SECRET_NOT_FOUND' },
    ])
  })

  it('survives providers throwing non-typed errors', async () => {
    const broken: SecretProvider = {
      id: 'environment',
      async isAvailable() { return true },
      async resolve() { throw new TypeError('totally unexpected') },
    }
    const local = stubProvider('local-encrypted', { K: 'from-local' })

    const result = await resolveSecretsForSpawn(
      [{ name: 'k', envVar: 'K', ref: 'K' }],
      {},
      { providers: [broken, local] },
    )
    expect(result.env).toEqual({ K: 'from-local' })
  })

  it('surfaces the operational error when an unpinned entry errors everywhere and nothing resolves', async () => {
    const env = stubProvider('environment', {}, { throwCode: 'INFISICAL_UNAVAILABLE' })
    const infisical = stubProvider('infisical', {}, { throwCode: 'INFISICAL_AUTH_FAILED' })

    const result = await resolveSecretsForSpawn(
      [{ name: 'k', envVar: 'K', ref: 'K' }],
      {},
      { providers: [env, infisical] },
    )

    expect(result.env).toEqual({})
    expect(result.diagnostics).toEqual([
      { name: 'k', envVar: 'K', status: 'error', provider: 'infisical', errorCode: 'INFISICAL_AUTH_FAILED', message: 'infisical broke' },
    ])
  })

  it('honors a custom chain order', async () => {
    const env = stubProvider('environment', { K: 'from-env' })
    const local = stubProvider('local-encrypted', { K: 'from-local' })

    const result = await resolveSecretsForSpawn(
      [{ name: 'k', envVar: 'K', ref: 'K' }],
      {},
      { providers: [env, local], order: ['local-encrypted', 'environment'] },
    )

    expect(result.env).toEqual({ K: 'from-local' })
    expect(env.calls).toHaveLength(0)
  })

  it('never leaks resolved values into diagnostics', async () => {
    const env = stubProvider('environment', { K: 'super-secret-value-123' })

    const result = await resolveSecretsForSpawn(
      [{ name: 'k', envVar: 'K', ref: 'K' }],
      {},
      { providers: [env] },
    )

    expect(JSON.stringify(result.diagnostics)).not.toContain('super-secret-value-123')
    expect(result.env.K).toBe('super-secret-value-123')
  })

  it('refuses denied envVar targets at resolution time (config.json can bypass the setter)', async () => {
    const env = stubProvider('environment', { K: 'x'.repeat(40) })

    for (const denied of ['PATH', 'Path', 'NODE_OPTIONS', 'LD_PRELOAD', 'CRAFT_CONFIG_DIR', 'ROX_CONFIG_DIR']) {
      const result = await resolveSecretsForSpawn(
        [{ name: 'planted', envVar: denied, ref: 'K' }],
        {},
        { providers: [env] },
      )
      expect(result.env).toEqual({})
      expect(result.values).toEqual([])
      expect(result.diagnostics).toEqual([
        {
          name: 'planted',
          envVar: denied,
          status: 'error',
          errorCode: 'SECRET_ENVVAR_DENIED',
          message: `envVar "${denied}" is denied for secret injection`,
        },
      ])
    }
    // Provider never consulted for denied entries.
    expect(env.calls).toHaveLength(0)
  })

  it('still resolves allowed envVars alongside denied ones', async () => {
    const env = stubProvider('environment', { K: 'resolved-value-ok' })

    const result = await resolveSecretsForSpawn(
      [
        { name: 'bad', envVar: 'PATH', ref: 'K' },
        { name: 'good', envVar: 'MY_SECRET', ref: 'K' },
      ],
      {},
      { providers: [env] },
    )

    expect(result.env).toEqual({ MY_SECRET: 'resolved-value-ok' })
    expect(result.diagnostics.map((d) => d.status)).toEqual(['error', 'resolved'])
  })

  it('redacts registered secret values echoed inside provider error messages', async () => {
    // A failing provider may embed secret material in its error text —
    // diagnostics are contractually value-free, so the chain redacts.
    const ok = stubProvider('environment', { K: 'supersecretvalue1' })
    const broken: SecretProvider = {
      id: 'local-encrypted',
      async isAvailable() { return true },
      async resolve() { throw new SecretResolveError('INFISICAL_UNAVAILABLE', 'local-encrypted', 'decryption failed near "supersecretvalue1" — bad padding') },
    }

    const result = await resolveSecretsForSpawn(
      [
        { name: 'a', envVar: 'A', ref: 'K' },
        { name: 'b', envVar: 'B', ref: 'K2', provider: 'local-encrypted' },
      ],
      {},
      { providers: [ok, broken] },
    )

    expect(result.env).toEqual({ A: 'supersecretvalue1' })
    const diag = result.diagnostics.find((d) => d.name === 'b')
    expect(diag?.status).toBe('error')
    expect(JSON.stringify(result.diagnostics)).not.toContain('supersecretvalue1')
  })
})
