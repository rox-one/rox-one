import { describe, expect, it } from 'bun:test'
import { composeSpawnEnv } from './spawn-env.ts'

describe('composeSpawnEnv', () => {
  it('refreshes the secret fragment before reading persisted+secret overrides', async () => {
    const order: string[] = []
    const env = await composeSpawnEnv(
      { workspaceRootPath: '/ws' },
      {
        refreshRuntimeSecretEnv: async () => {
          order.push('refresh')
        },
        getRuntimeEnvOverrides: () => {
          order.push('overrides')
          return { PLAIN: 'from-config', OPENAI_API_KEY: 'sk-secret' }
        },
      },
    )

    expect(order).toEqual(['refresh', 'overrides'])
    expect(env.PLAIN).toBe('from-config')
    expect(env.OPENAI_API_KEY).toBe('sk-secret')
    expect(env.CRAFT_WORKSPACE_PATH).toBe('/ws')
  })

  it('merges persisted env + secret fragment, with structural keys always winning', async () => {
    const env = await composeSpawnEnv(
      { workspaceRootPath: '/real/workspace', miniModel: 'haiku-session' },
      {
        refreshRuntimeSecretEnv: async () => {},
        getRuntimeEnvOverrides: () => ({
          PLAIN: 'plain',
          SHARED: 'secret-value',
          CRAFT_WORKSPACE_PATH: '/from-config',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku-from-config',
        }),
      },
    )

    expect(env.PLAIN).toBe('plain')
    expect(env.SHARED).toBe('secret-value')
    expect(env.CRAFT_WORKSPACE_PATH).toBe('/real/workspace')
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('haiku-session')
  })

  it('omits the mini-model overlay when none is provided', async () => {
    const env = await composeSpawnEnv(
      { workspaceRootPath: '/ws' },
      {
        refreshRuntimeSecretEnv: async () => {},
        getRuntimeEnvOverrides: () => ({ PLAIN: 'plain' }),
      },
    )

    expect(env).toEqual({
      PLAIN: 'plain',
      CRAFT_WORKSPACE_PATH: '/ws',
    })
  })
})
