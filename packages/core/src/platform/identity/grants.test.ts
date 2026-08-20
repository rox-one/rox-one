import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonAccessGrantStore } from './grants.ts';

const CRED_A = 'cred_11111111-1111-4111-8111-111111111111' as const;
const CRED_B = 'cred_22222222-2222-4222-8222-222222222222' as const;

describe('JsonAccessGrantStore', () => {
  it('lists grants for a consumer within one workspace', () => {
    const store = new JsonAccessGrantStore();
    store.put({
      id: 'grant_a',
      workspaceId: 'workspace_a',
      consumerId: 'agent-a',
      credentialRefId: CRED_A,
      actions: ['github.request'],
      resources: ['repo:demo'],
      status: 'active',
    });
    store.put({
      id: 'grant_b',
      workspaceId: 'workspace_b',
      consumerId: 'agent-a',
      credentialRefId: CRED_B,
      actions: ['github.request'],
      resources: ['repo:other'],
      status: 'active',
    });

    expect(store.listForConsumer({ id: 'agent-a', workspaceId: 'workspace_a' })).toEqual([
      expect.objectContaining({ id: 'grant_a', workspaceId: 'workspace_a' }),
    ]);
    expect(store.listForConsumer({ id: 'agent-a', workspaceId: 'workspace_b' })).toEqual([
      expect.objectContaining({ id: 'grant_b', workspaceId: 'workspace_b' }),
    ]);
  });

  it('lists all grants without a workspace filter', () => {
    const store = new JsonAccessGrantStore();
    store.put({
      id: 'grant_a',
      workspaceId: 'workspace_a',
      consumerId: 'agent-a',
      credentialRefId: CRED_A,
      actions: ['github.request'],
      resources: ['repo:demo'],
      status: 'active',
    });
    store.put({
      id: 'grant_b',
      workspaceId: 'workspace_b',
      consumerId: 'agent-b',
      credentialRefId: CRED_B,
      actions: ['github.request'],
      resources: ['repo:other'],
      status: 'revoked',
    });

    const all = store.listAll();
    expect(all).toHaveLength(2);
    expect(all.map((grant) => grant.id).sort()).toEqual(['grant_a', 'grant_b']);
  });

  it('lists all grants filtered by workspace', () => {
    const store = new JsonAccessGrantStore();
    store.put({
      id: 'grant_a',
      workspaceId: 'workspace_a',
      consumerId: 'agent-a',
      credentialRefId: CRED_A,
      actions: ['github.request'],
      resources: ['repo:demo'],
      status: 'active',
    });
    store.put({
      id: 'grant_b',
      workspaceId: 'workspace_b',
      consumerId: 'agent-a',
      credentialRefId: CRED_B,
      actions: ['github.request'],
      resources: ['repo:other'],
      status: 'active',
    });

    expect(store.listAll('workspace_a')).toEqual([
      expect.objectContaining({ id: 'grant_a', workspaceId: 'workspace_a' }),
    ]);
    expect(store.listAll('workspace_b')).toEqual([
      expect.objectContaining({ id: 'grant_b', workspaceId: 'workspace_b' }),
    ]);
    expect(store.listAll('workspace_missing')).toEqual([]);
  });
});

describe('JsonAccessGrantStore persistence', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'craft-grants-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists grants as JSON and reloads them', () => {
    const store = new JsonAccessGrantStore({ directory: dir });
    store.put({
      id: 'grant_a',
      workspaceId: 'workspace_a',
      consumerId: 'agent-a',
      credentialRefId: CRED_A,
      actions: ['github.request'],
      resources: ['repo:demo'],
      status: 'active',
    });
    expect(existsSync(join(dir, 'grants.json'))).toBe(true);

    const reloaded = new JsonAccessGrantStore({ directory: dir });
    expect(reloaded.get('grant_a')).toMatchObject({
      id: 'grant_a',
      consumerId: 'agent-a',
      credentialRefId: CRED_A,
      status: 'active',
    });
    expect(reloaded.listForConsumer({ id: 'agent-a', workspaceId: 'workspace_a' })).toHaveLength(1);
    expect(reloaded.listActive({ consumerId: 'agent-a', credentialRefId: CRED_A })).toHaveLength(1);
  });

  it('keeps workspace isolation after reload', () => {
    const store = new JsonAccessGrantStore({ directory: dir });
    store.put({
      id: 'grant_a',
      workspaceId: 'workspace_a',
      consumerId: 'agent-a',
      credentialRefId: CRED_A,
      actions: ['github.request'],
      resources: ['repo:demo'],
      status: 'active',
    });
    store.put({
      id: 'grant_b',
      workspaceId: 'workspace_b',
      consumerId: 'agent-a',
      credentialRefId: CRED_B,
      actions: ['github.request'],
      resources: ['repo:other'],
      status: 'active',
    });

    const reloaded = new JsonAccessGrantStore({ directory: dir });
    expect(reloaded.listForConsumer({ id: 'agent-a', workspaceId: 'workspace_a' })).toEqual([
      expect.objectContaining({ id: 'grant_a' }),
    ]);
    expect(reloaded.listForConsumer({ id: 'agent-a', workspaceId: 'workspace_b' })).toEqual([
      expect.objectContaining({ id: 'grant_b' }),
    ]);
  });
});
