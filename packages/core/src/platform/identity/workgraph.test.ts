import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('appends an immutable metadata-only audit ledger with readable fields', async () => {
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
      target: 'repo:demo',
      versionFingerprint: 'abc',
      repairState: 'ok',
    });
    const listed = await graph.listConnectionAudit('workspace_a', connection.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.action).toBe('github.request');
    expect(listed[0]?.decision).toBe('allow');
    expect(listed[0]?.consumer).toBe('agent-a');
    expect(listed[0]?.target).toBe('repo:demo');
    expect(listed[0]?.versionFingerprint).toBe('abc');
    expect(listed[0]?.repairState).toBe('ok');
    expect(listed[0]?.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(listed)).not.toContain('super-secret');
    expect(JSON.stringify(listed)).not.toMatch(/ghp_[A-Za-z0-9]+|sk-[A-Za-z0-9]+|Bearer\s+\S+/);
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

describe('CF-5 ConnectionWorkGraph persistence', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'craft-workgraph-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists connections, bindings, and audit then reloads', async () => {
    const graph = new ConnectionWorkGraph({ directory: dir });
    const connection = await graph.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'reference',
      scopes: ['repo'],
    });
    await graph.bindConsumer({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      consumerId: 'agent-a',
      purpose: 'list issues',
      allowedActions: ['github.request'],
      resources: ['repo:demo'],
    });
    await graph.appendConnectionAudit({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      credentialRefId: CRED_A,
      consumer: 'agent-a',
      action: 'github.request',
      decision: 'allow',
      target: 'repo:demo',
      versionFingerprint: 'fp-1',
    });

    expect(existsSync(join(dir, 'connections.json'))).toBe(true);
    expect(existsSync(join(dir, 'bindings.json'))).toBe(true);
    expect(existsSync(join(dir, 'audit.json'))).toBe(true);

    const reloaded = new ConnectionWorkGraph({ directory: dir });
    await expect(reloaded.getConnection('workspace_a', connection.id)).resolves.toMatchObject({
      id: connection.id,
      credentialRefId: CRED_A,
      scopes: ['repo'],
    });
    await expect(reloaded.affectedClosure('workspace_a', connection.id)).resolves.toEqual(['agent-a']);
    const audit = await reloaded.listConnectionAudit('workspace_a', connection.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('github.request');
    expect(audit[0]?.decision).toBe('allow');
    expect(audit[0]?.consumer).toBe('agent-a');
    expect(audit[0]?.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(audit)).not.toContain('super-secret');
    expect(JSON.stringify(audit)).not.toMatch(/ghp_[A-Za-z0-9]+|sk-[A-Za-z0-9]+/);
  });

  it('rolls back persisted files when a transaction fails', async () => {
    const graph = new ConnectionWorkGraph({ directory: dir });
    const kept = await graph.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'copy',
    });

    await expect(
      graph.transact(async (tx) => {
        await tx.createConnection({
          workspaceId: 'workspace_a',
          integrationId: 'slack',
          credentialRefId: CRED_B,
          storageMode: 'copy',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await graph.listConnections('workspace_a')).toEqual([
      expect.objectContaining({ id: kept.id }),
    ]);

    const reloaded = new ConnectionWorkGraph({ directory: dir });
    const listed = await reloaded.listConnections('workspace_a');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(kept.id);
    expect(JSON.parse(readFileSync(join(dir, 'connections.json'), 'utf8'))).toHaveLength(1);
  });

  it('keeps workspace isolation across reload', async () => {
    const graph = new ConnectionWorkGraph({ directory: dir });
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

    const reloaded = new ConnectionWorkGraph({ directory: dir });
    await expect(reloaded.affectedClosure('workspace_a', a.id)).resolves.toEqual(['agent-a']);
    await expect(reloaded.affectedClosure('workspace_b', a.id)).resolves.toEqual([]);
    await expect(reloaded.getConnection('workspace_b', a.id)).resolves.toBeNull();
    await expect(reloaded.listConnections('workspace_a')).resolves.toHaveLength(1);
    await expect(reloaded.listConnections('workspace_b')).resolves.toHaveLength(1);
  });
});
