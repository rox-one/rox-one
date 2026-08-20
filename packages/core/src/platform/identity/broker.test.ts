import { describe, expect, it } from 'bun:test';
import { InProcessCredentialBroker } from './broker.ts';
import { JsonAccessGrantStore } from './grants.ts';
import { createP0ProviderStack, createSealedSecret } from './p0-adapters.ts';
import type { CredentialRef } from './credential-types.ts';
import type { ConsumerIdentity } from './broker.ts';

const CONSUMER: ConsumerIdentity = {
  kind: 'agent',
  id: 'agent_github',
  workspaceId: 'ws_1',
};

async function seeded() {
  const stack = createP0ProviderStack({
    listEnvFiles: async () => [{ path: '/repo/.env', keys: ['GH_TOKEN'] }],
    approveCopy: async () => createSealedSecret('api_key', 'dummy'),
  });
  const dotenv = stack.importers.dotenv;
  const candidates = await dotenv.discover({ sourceId: 'dotenv', workspaceId: 'ws_1' });
  const candidate = candidates[0]!;
  const commit = await dotenv.commit({
    candidateId: candidate.id,
    targetProviderId: stack.provider.id,
    mode: 'copy',
    workspaceId: 'ws_1',
    requestedBy: 'user_1',
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
  return { stack, ref, grants, broker };
}

describe('InProcessCredentialBroker', () => {
  it('denies by default when no grant exists', async () => {
    const { broker, ref } = await seeded();
    await expect(
      broker.acquireLease({
        credentialRef: ref.id,
        consumer: CONSUMER,
        purpose: 'github.api',
        action: 'git:clone',
        resources: ['github.com/rox-one/rox-one'],
        ttl: 30_000,
      }),
    ).rejects.toMatchObject({ code: 'GRANT_MISSING' });
  });

  it('denies wrong workspace, action, or resource even with a grant', async () => {
    const { broker, grants, ref } = await seeded();
    grants.put({
      id: 'grant_1',
      workspaceId: 'ws_1',
      consumerId: CONSUMER.id,
      credentialRefId: ref.id,
      actions: ['git:clone'],
      resources: ['github.com/rox-one/rox-one'],
      status: 'active',
    });

    await expect(
      broker.acquireLease({
        credentialRef: ref.id,
        consumer: { ...CONSUMER, workspaceId: 'ws_other' },
        purpose: 'github.api',
        action: 'git:clone',
        resources: ['github.com/rox-one/rox-one'],
        ttl: 30_000,
      }),
    ).rejects.toMatchObject({ code: 'LEASE_DENIED' });

    await expect(
      broker.acquireLease({
        credentialRef: ref.id,
        consumer: CONSUMER,
        purpose: 'github.api',
        action: 'git:push',
        resources: ['github.com/rox-one/rox-one'],
        ttl: 30_000,
      }),
    ).rejects.toMatchObject({ code: 'LEASE_DENIED' });

    await expect(
      broker.acquireLease({
        credentialRef: ref.id,
        consumer: CONSUMER,
        purpose: 'github.api',
        action: 'git:clone',
        resources: ['github.com/other/other'],
        ttl: 30_000,
      }),
    ).rejects.toMatchObject({ code: 'LEASE_DENIED' });
  });

  it('issues a metadata-only lease and never returns payload', async () => {
    const { broker, grants, ref } = await seeded();
    grants.put({
      id: 'grant_1',
      workspaceId: 'ws_1',
      consumerId: CONSUMER.id,
      credentialRefId: ref.id,
      actions: ['git:clone'],
      resources: ['github.com/rox-one/rox-one'],
      status: 'active',
    });

    const lease = await broker.acquireLease({
      credentialRef: ref.id,
      consumer: CONSUMER,
      purpose: 'github.api',
      action: 'git:clone',
      resources: ['github.com/rox-one/rox-one'],
      audience: 'api.github.com',
      ttl: 30_000,
    });

    expect(lease.status).toBe('active');
    expect(lease.delivery.mechanism).toBe('trusted-http-header');
    expect(lease.credentialRefId).toBe(ref.id);
    expect(JSON.stringify(lease)).not.toMatch(/sk-|ghp_|SealedSecret|"value"/);
    expect('payload' in lease).toBe(false);
  });

  it('rejects env-legacy unless the consumer declares it', async () => {
    const { broker, grants, ref } = await seeded();
    grants.put({
      id: 'grant_1',
      workspaceId: 'ws_1',
      consumerId: CONSUMER.id,
      credentialRefId: ref.id,
      actions: ['git:clone'],
      resources: ['github.com/rox-one/rox-one'],
      status: 'active',
    });

    await expect(
      broker.acquireLease({
        credentialRef: ref.id,
        consumer: CONSUMER,
        purpose: 'github.api',
        action: 'git:clone',
        resources: ['github.com/rox-one/rox-one'],
        ttl: 30_000,
        requestedMechanism: 'env-legacy',
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_UNSUPPORTED' });

    const lease = await broker.acquireLease({
      credentialRef: ref.id,
      consumer: CONSUMER,
      purpose: 'github.api',
      action: 'git:clone',
      resources: ['github.com/rox-one/rox-one'],
      ttl: 30_000,
      requestedMechanism: 'env-legacy',
      allowEnvLegacy: true,
    });
    expect(lease.delivery.mechanism).toBe('env-legacy');
  });

  it('revokes an active lease so a later acquire cannot reuse it', async () => {
    const { broker, grants, ref } = await seeded();
    grants.put({
      id: 'grant_1',
      workspaceId: 'ws_1',
      consumerId: CONSUMER.id,
      credentialRefId: ref.id,
      actions: ['git:clone'],
      resources: ['github.com/rox-one/rox-one'],
      status: 'active',
    });
    const lease = await broker.acquireLease({
      credentialRef: ref.id,
      consumer: CONSUMER,
      purpose: 'github.api',
      action: 'git:clone',
      resources: ['github.com/rox-one/rox-one'],
      ttl: 30_000,
    });
    await broker.revokeLease(lease.id, 'rotated');
    expect((await broker.getLease(lease.id))?.status).toBe('revoked');
  });
});
