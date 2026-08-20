import { describe, expect, it } from 'bun:test';
import { InProcessCredentialBroker } from './broker.ts';
import { JsonAccessGrantStore } from './grants.ts';
import { createP0ProviderStack, createSealedSecret } from './p0-adapters.ts';
import { revokeConnectionAndRevalidate } from './revalidation.ts';
import { ConnectionWorkGraph } from './workgraph.ts';
import type { CredentialRef } from './credential-types.ts';

describe('CF-5 revoke, closure, revalidate', () => {
  it('invalidates leases, audits, and revalidates only the same workspace', async () => {
    const stack = createP0ProviderStack({
      listEnvFiles: async () => [{ path: '/repo/.env', keys: ['GH_TOKEN'] }],
      approveCopy: async () => createSealedSecret('api_key', 'dummy'),
    });
    const candidates = await stack.importers.dotenv.discover({ sourceId: 'dotenv', workspaceId: 'ws_a' });
    const candidate = candidates[0]!;
    const commit = await stack.importers.dotenv.commit({
      candidateId: candidate.id,
      targetProviderId: stack.provider.id,
      mode: 'copy',
      workspaceId: 'ws_a',
      requestedBy: 'user',
    });
    const ref: CredentialRef = {
      id: commit.credentialRefId,
      kind: 'api_key',
      providerId: stack.provider.id,
      locator: candidate.locator!,
      createdAt: 1,
      updatedAt: 1,
    };
    const grants = new JsonAccessGrantStore();
    const broker = new InProcessCredentialBroker({
      grants,
      providers: { [stack.provider.id]: stack.provider },
      resolveRef: async () => ref,
    });
    const graph = new ConnectionWorkGraph();
    const connection = await graph.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: ref.id,
      storageMode: 'copy',
    });
    const other = await graph.createConnection({
      workspaceId: 'workspace_b',
      integrationId: 'github',
      credentialRefId: ref.id,
      storageMode: 'copy',
    });
    await graph.bindConsumer({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      consumerId: 'agent-a',
      purpose: 'list issues',
      allowedActions: ['github.request'],
      resources: ['repo:demo'],
    });
    await graph.bindConsumer({
      workspaceId: 'workspace_b',
      connectionId: other.id,
      consumerId: 'agent-b',
      purpose: 'list issues',
      allowedActions: ['github.request'],
      resources: ['repo:other'],
    });

    grants.put({
      id: 'grant_a',
      workspaceId: 'workspace_a',
      consumerId: 'agent-a',
      credentialRefId: ref.id,
      actions: ['github.request'],
      resources: ['repo:demo'],
      status: 'active',
    });
    const lease = await broker.acquireLease({
      credentialRef: ref.id,
      consumer: { kind: 'agent', id: 'agent-a', workspaceId: 'workspace_a' },
      purpose: 'list issues',
      action: 'github.request',
      resources: ['repo:demo'],
      ttl: 30_000,
    });

    const result = await revokeConnectionAndRevalidate({
      kernel: graph,
      broker,
      provider: stack.provider,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      reason: 'operator',
    });

    expect(result.consumers).toEqual([{ consumerId: 'agent-a', status: 'repair_required' }]);
    expect(JSON.stringify(result)).not.toContain('ghp_');
    expect((await broker.getLease(lease.id))?.status).toBe('revoked');
    expect(await graph.affectedClosure('workspace_b', other.id)).toEqual(['agent-b']);

    const audit = await graph.listConnectionAudit('workspace_a', connection.id);
    expect(audit[0]?.eventType).toBe('connection-revoked');
    expect(audit[0]?.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an unknown connection without touching the broker', async () => {
    const stack = createP0ProviderStack();
    const broker = new InProcessCredentialBroker({
      grants: new JsonAccessGrantStore(),
      providers: { [stack.provider.id]: stack.provider },
      resolveRef: async () => undefined,
    });
    await expect(
      revokeConnectionAndRevalidate({
        kernel: new ConnectionWorkGraph(),
        broker,
        provider: stack.provider,
        workspaceId: 'workspace_a',
        connectionId: 'missing-connection-id',
        reason: 'operator',
      }),
    ).rejects.toThrow(/not found/i);
  });
});
