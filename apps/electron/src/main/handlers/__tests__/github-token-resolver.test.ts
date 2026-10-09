import { describe, expect, it } from 'bun:test'
import { createGithubTokenResolver } from '../github-token-resolver'

interface Overrides {
  readonly deny?: boolean
  readonly value?: string
}

function fixture(overrides: Overrides = {}) {
  const leases: Array<Record<string, unknown>> = []
  const revoked: Array<[string, string]> = []
  const kernel = {
    listConnections: async (workspaceId: string) => (workspaceId === 'ws'
      ? [{ integrationId: 'github', credentialRefId: 'cred_1' }]
      : []),
  }
  const broker = {
    acquireLease: async (input: Record<string, unknown>) => {
      leases.push(input)
      if (overrides.deny) throw new Error('grant_missing')
      return { id: 'lease_1' }
    },
    perform: async (_id: string, operation: (materialization: unknown) => unknown) =>
      operation({ credentialRefId: 'cred_1', kind: 'bearer_token', payload: { value: overrides.value ?? 'ghp_secret' } }),
    revokeLease: async (id: string, reason: string) => { revoked.push([id, reason]) },
  }
  const resolver = createGithubTokenResolver(
    { kernel, broker } as unknown as Parameters<typeof createGithubTokenResolver>[0],
  )
  return { resolver, leases, revoked }
}

describe('createGithubTokenResolver', () => {
  it('leases, materializes and revokes the workspace github token', async () => {
    const f = fixture()
    expect(await f.resolver('ws', 'devrepo_x')).toBe('ghp_secret')
    expect(f.leases).toHaveLength(1)
    expect(f.leases[0]).toMatchObject({
      credentialRef: 'cred_1',
      consumer: { kind: 'workflow', id: 'owner', workspaceId: 'ws' },
      action: 'github.api',
      resources: ['github:user'],
      requestedMechanism: 'broker-perform',
    })
    expect(f.revoked).toEqual([['lease_1', 'devspace.repository.clone-complete']])
  })

  it('returns null when the workspace has no github connection', async () => {
    const f = fixture()
    expect(await f.resolver('other', 'devrepo_x')).toBeNull()
    expect(f.leases).toEqual([])
  })

  it('returns null (public-only) when the broker denies the lease', async () => {
    const f = fixture({ deny: true })
    expect(await f.resolver('ws', 'devrepo_x')).toBeNull()
    expect(f.revoked).toEqual([])
  })

  it('returns null but still revokes the lease when the secret is empty', async () => {
    const f = fixture({ value: '' })
    expect(await f.resolver('ws', 'devrepo_x')).toBeNull()
    expect(f.revoked).toHaveLength(1)
  })
})