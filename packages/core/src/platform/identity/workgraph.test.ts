import { describe, expect, it } from 'bun:test';
import { ConnectionWorkGraph } from './workgraph.ts';

const CRED_A = 'cred_11111111-1111-4111-8111-111111111111' as const;
const CRED_B = 'cred_22222222-2222-4222-8222-222222222222' as const;

describe('CF-5 ConnectionWorkGraph', () => {
  it('creates a metadata-only connection and rejects secret fields', async () => {
    const graph = new ConnectionWorkGraph();
    const connection = await graph.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'copy',
      scopes: ['repo'],
    });
    expect(connection.credentialRefId).toBe(CRED_A);
    expect(connection.storageMode).toBe('copy');
    expect(connection.scopes).toEqual(['repo']);
    expect(JSON.stringify(connection)).not.toContain('super-secret');
    expect(connection).not.toHaveProperty('value');
    expect(connection).not.toHaveProperty('payload');

    await expect(
      graph.createConnection({
        workspaceId: 'workspace_a',
        integrationId: 'github',
        credentialRefId: CRED_A,
        storageMode: 'copy',
        value: 'super-secret',
      } as never),
    ).rejects.toThrow(/value|payload|metadata/i);

    await expect(
      graph.createConnection({
        workspaceId: 'workspace_a',
        integrationId: 'github',
        credentialRefId: 'not-a-cred',
        storageMode: 'copy',
      } as never),
    ).rejects.toThrow(/credentialRefId/i);
  });

  it('binds consumers and closes over one workspace only', async () => {
    const graph = new ConnectionWorkGraph();
    const a = await graph.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'reference',
    });
    const b = await graph.createConnection({
      workspaceId: 'workspace_b',
      integrationId: 'github',
      credentialRefId: CRED_B,
      storageMode: 'reference',
    });
    await graph.bindConsumer({
      workspaceId: 'workspace_a',
      connectionId: a.id,
      consumerId: 'agent-a',
      purpose: 'list issues',
      allowedActions: ['github.request'],
      resources: ['repo:demo'],
    });
    await graph.bindConsumer({
      workspaceId: 'workspace_b',
      connectionId: b.id,
      consumerId: 'agent-b',
      purpose: 'list issues',
      allowedActions: ['github.request'],
      resources: ['repo:other'],
    });

    await expect(graph.affectedClosure('workspace_a', a.id)).resolves.toEqual(['agent-a']);
    await expect(graph.affectedClosure('workspace_b', a.id)).resolves.toEqual([]);
    await expect(graph.getConnection('workspace_b', a.id)).resolves.toBeNull();
    await expect(
      graph.bindConsumer({
        workspaceId: 'workspace_a',
        connectionId: 'missing-connection-id',
        consumerId: 'agent-a',
        purpose: 'x',
        allowedActions: [],
        resources: [],
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('appends an immutable metadata-only audit ledger', async () => {
    const graph = new ConnectionWorkGraph();
    const connection = await graph.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'copy',
    });
    await graph.appendConnectionAudit({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      credentialRefId: CRED_A,
      consumer: 'agent-a',
      action: 'github.request',
      decision: 'allow',
      versionFingerprint: 'abc',
    });
    const listed = await graph.listConnectionAudit('workspace_a', connection.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(listed)).not.toContain('super-secret');
    expect(listed[0]).not.toHaveProperty('value');
    expect(() => graph.rewriteAudit(listed[0]!.id, { outcome: 'changed' })).toThrow(/immutable/i);
  });

  it('rolls back a failed transaction', async () => {
    const graph = new ConnectionWorkGraph();
    await expect(
      graph.transact(async (tx) => {
        await tx.createConnection({
          workspaceId: 'workspace_a',
          integrationId: 'github',
          credentialRefId: CRED_A,
          storageMode: 'reference',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await graph.listConnections('workspace_a')).toEqual([]);
  });
});
