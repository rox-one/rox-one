/**
 * Dev Space GitHub token resolver.
 *
 * Maps a workspace to its `github` connection (workgraph kernel) and hands the
 * credential to the Dev Space clone/pull path through the in-process credential
 * broker: acquire a short lease, materialize the secret, then revoke the lease.
 * The token never leaves the server process — callers only receive it to place
 * it in a git child's `GIT_ASKPASS` env.
 */
import type { CredentialRefId } from '@rox/core/platform'
import type { CredentialLease, InProcessCredentialBroker } from '@rox/shared/credentials'
import type { WorkGraphKernel } from '@rox/server-core/workgraph'

export interface GithubTokenResolverDeps {
  readonly kernel: Pick<WorkGraphKernel, 'listConnections'>
  readonly broker: Pick<InProcessCredentialBroker, 'acquireLease' | 'perform' | 'revokeLease'>
}

export type GithubTokenResolver = (workspaceId: string, repositoryId: string) => Promise<string | null>

const LEASE_TTL_MS = 30_000

export function createGithubTokenResolver(deps: GithubTokenResolverDeps): GithubTokenResolver {
  return async workspaceId => {
    const connections = await deps.kernel.listConnections(workspaceId)
    const github = connections.find(connection => connection.integrationId === 'github')
    if (!github) return null
    let lease: CredentialLease | null = null
    try {
      lease = await deps.broker.acquireLease({
        credentialRef: github.credentialRefId as CredentialRefId,
        consumer: { kind: 'workflow', id: 'owner', workspaceId },
        purpose: 'devspace.repository.clone',
        action: 'github.api',
        resources: ['github:user'],
        ttl: LEASE_TTL_MS,
        requestedMechanism: 'broker-perform',
      })
      return await deps.broker.perform(lease.id, materialization =>
        typeof materialization.payload.value === 'string' && materialization.payload.value.length > 0
          ? materialization.payload.value
          : null)
    } catch {
      // No github connection, no matching grant or an unavailable credential:
      // public clones still work, private ones surface a typed auth failure.
      return null
    } finally {
      if (lease) await deps.broker.revokeLease(lease.id, 'devspace.repository.clone-complete').catch(() => undefined)
    }
  }
}