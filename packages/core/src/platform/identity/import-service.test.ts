import { describe, expect, it } from 'bun:test';
import { ImportService } from './import-service.ts';
import { createP0ProviderStack, createSealedSecret, type DiscoveryHost } from './p0-adapters.ts';
import { ConnectionFabricError } from './provider-contract.ts';

const HOST: DiscoveryHost = {
  listEnvFiles: async () => [{ path: '/repo/.env', keys: ['GH_TOKEN'] }],
  approveCopy: async () => createSealedSecret('api_key', 'dummy'),
};

function createMainService(host: DiscoveryHost = HOST) {
  const stack = createP0ProviderStack(host);
  const service = new ImportService({
    context: 'main',
    workspaceId: 'ws_1',
    requestedBy: 'user_1',
    providers: { [stack.provider.id]: stack.provider },
    importers: stack.importers,
    existing: [],
  });
  return { ...stack, service };
}

async function copyDotenv(service: ImportService) {
  const candidates = await service.discover('dotenv');
  const candidate = candidates[0]!;
  service.requestAccess(candidate.id);
  service.grantAccess();
  await service.preview('legacy-local');
  service.selectMode('copy');
  service.checkConflicts();
  await service.validate('legacy-local');
  return service.commit('legacy-local');
}

describe('ImportService', () => {
  it('denies renderer, remote, and headless before importer dispatch', async () => {
    const stack = createP0ProviderStack({
      listEnvFiles: async () => {
        throw new Error('host should not run');
      },
    });
    for (const context of ['renderer', 'remote', 'headless'] as const) {
      const service = new ImportService({
        context,
        workspaceId: 'ws_1',
        requestedBy: 'user_1',
        providers: { [stack.provider.id]: stack.provider },
        importers: stack.importers,
      });
      await expect(service.discover('dotenv')).rejects.toMatchObject({
        code: 'IMPORT_CONTEXT_DENIED',
      });
    }
  });

  it('commits a copy import on main and stores metadata only', async () => {
    const { service } = createMainService();
    const commit = await copyDotenv(service);
    expect(commit.credentialRefId.startsWith('cred_')).toBe(true);
    expect(commit.reusedExisting).toBe(false);
    expect(service.session.getPhase()).toBe('committed');
    expect(JSON.stringify(service.listCommitted())).not.toContain('ghp_');
    expect(JSON.stringify(service.getRegistry().list())).not.toMatch(/"value"/);
  });

  it('reuses an existing same-fingerprint reference', async () => {
    const first = createMainService();
    const commit = await copyDotenv(first.service);
    const second = new ImportService({
      context: 'main',
      workspaceId: 'ws_1',
      requestedBy: 'user_1',
      providers: { [first.provider.id]: first.provider },
      importers: first.importers,
      existing: first.service.listCommitted(),
    });
    const candidates = await second.discover('dotenv');
    second.requestAccess(candidates[0]!.id);
    second.grantAccess();
    await second.preview('legacy-local');
    second.selectMode('reference');
    second.checkConflicts();
    await second.validate('legacy-local');
    const reused = await second.commit('legacy-local');
    expect(reused.reusedExisting).toBe(true);
    expect(reused.credentialRefId).toBe(commit.credentialRefId);
  });

  it('fails closed on a different fingerprint', async () => {
    const { service, provider, importers } = createMainService();
    const candidates = await service.discover('dotenv');
    const colliding = new ImportService({
      context: 'main',
      workspaceId: 'ws_1',
      requestedBy: 'user_1',
      providers: { [provider.id]: provider },
      importers,
      existing: [
        {
          conflictKey: candidates[0]!.conflictKey,
          fingerprint: 'b'.repeat(64),
          credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
          versionId: 'ver_x',
        },
      ],
    });
    await colliding.discover('dotenv');
    colliding.requestAccess(candidates[0]!.id);
    colliding.grantAccess();
    await colliding.preview('legacy-local');
    colliding.selectMode('copy');
    expect(() => colliding.checkConflicts()).toThrow(/IMPORT_CONFLICT/);
    expect(colliding.session.getPhase()).toBe('failed');
    await colliding.rollback();
    expect(colliding.session.getPhase()).toBe('rolled_back');
  });

  it('rolls back when the provider write fails', async () => {
    const stack = createP0ProviderStack(HOST);
    stack.provider.write = async () => {
      throw new ConnectionFabricError('IMPORT_PROVIDER_WRITE_FAILED', 'disk');
    };
    const service = new ImportService({
      context: 'main',
      workspaceId: 'ws_1',
      requestedBy: 'user_1',
      providers: { [stack.provider.id]: stack.provider },
      importers: stack.importers,
    });
    await expect(copyDotenv(service)).rejects.toMatchObject({
      code: 'IMPORT_PROVIDER_WRITE_FAILED',
    });
    expect(service.session.getPhase()).toBe('failed');
    await service.rollback();
    expect(service.session.getPhase()).toBe('rolled_back');
    expect(service.listCommitted()).toEqual([]);
    expect(service.getRegistry().list()).toEqual([]);
  });
});
