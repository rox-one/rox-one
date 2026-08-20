import { describe, expect, it } from 'bun:test';
import { createCredentialRefId, type CredentialRef } from './credential-types.ts';
import { InfisicalFabricProvider, createInfisicalImporter, type FetchLike } from './infisical-fabric-provider.ts';
import { ConnectionFabricError } from './provider-contract.ts';

const PROVIDER_TOKEN = 'infisical_service_token_do_not_leak';
const LOCATOR = {
  type: 'infisical' as const,
  projectId: 'proj_1',
  environment: 'prod',
  secretPath: '/',
  secretKey: 'GH_TOKEN',
};

function refFor(providerId: string, credentialRefId = createCredentialRefId()): CredentialRef {
  return {
    id: credentialRefId,
    kind: 'api_key',
    providerId,
    locator: LOCATOR,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('CF-8 InfisicalFabricProvider', () => {
  it('write + inspect exposes hasMaterial without token material', async () => {
    const provider = new InfisicalFabricProvider({
      token: PROVIDER_TOKEN,
      projectId: 'proj_1',
      environment: 'prod',
    });

    const version = await provider.write({
      kind: 'api_key',
      mode: 'reference',
      locator: LOCATOR,
      workspaceId: 'ws_1',
      requestedBy: 'user_1',
    });

    const ref = refFor(provider.id, version.credentialRefId);
    const inspect = await provider.inspect(ref);

    expect(inspect.hasMaterial).toBe(true);
    expect(inspect.locator).toEqual(LOCATOR);
    expect(JSON.stringify(inspect)).not.toContain(PROVIDER_TOKEN);
    expect(JSON.stringify(inspect)).not.toMatch(/secretValue|Bearer |infisical_service/i);

    const materialization = await provider.resolveForLease({
      credentialRef: ref,
      purpose: 'github.api',
    });
    expect(materialization).toEqual({
      _brand: 'ProviderMaterialization',
      credentialRefId: ref.id,
      providerId: 'infisical',
      versionId: version.id,
    });
    expect(JSON.stringify(materialization)).not.toContain(PROVIDER_TOKEN);
  });

  it('health fails closed on 401', async () => {
    const fetchImpl: FetchLike = async () => new Response('nope', { status: 401 });
    const provider = new InfisicalFabricProvider({
      token: PROVIDER_TOKEN,
      projectId: 'proj_1',
      environment: 'prod',
      fetch: fetchImpl,
    });

    const version = await provider.write({
      kind: 'api_key',
      mode: 'copy',
      locator: LOCATOR,
      workspaceId: 'ws_1',
      requestedBy: 'user_1',
    });
    const ref = refFor(provider.id, version.credentialRefId);

    await expect(provider.health({ credentialRef: ref })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    await expect(provider.health({ credentialRef: ref })).rejects.toBeInstanceOf(ConnectionFabricError);
  });

  it('discoverAccount reports connected without leaking the token', async () => {
    const provider = new InfisicalFabricProvider({
      token: PROVIDER_TOKEN,
      projectId: 'proj_1',
      environment: 'prod',
    });
    const account = await provider.discoverAccount({ workspaceId: 'ws_1' });
    expect(account.status).toBe('connected');
    expect(account.providerId).toBe('infisical');
    expect(JSON.stringify(account)).not.toContain(PROVIDER_TOKEN);
  });

  it('rotate without fetch fails closed; revoke without fetch clears local metadata', async () => {
    const provider = new InfisicalFabricProvider({
      token: PROVIDER_TOKEN,
      projectId: 'proj_1',
      environment: 'prod',
    });
    const version = await provider.write({
      kind: 'api_key',
      mode: 'managed',
      locator: LOCATOR,
      workspaceId: 'ws_1',
      requestedBy: 'user_1',
    });
    const ref = refFor(provider.id, version.credentialRefId);

    await expect(provider.rotate({ credentialRef: ref })).rejects.toMatchObject({
      code: 'PROVIDER_OPERATION_UNSUPPORTED',
    });

    await provider.revoke({ credentialRef: ref });
    await expect(provider.inspect(ref)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('rotate with stub fetch succeeds and still returns no raw secret', async () => {
    const calls: Array<{ method?: string; url: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify({ secret: { secretKey: 'GH_TOKEN' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const provider = new InfisicalFabricProvider({
      token: PROVIDER_TOKEN,
      projectId: 'proj_1',
      environment: 'prod',
      fetch: fetchImpl,
    });
    const version = await provider.write({
      kind: 'api_key',
      mode: 'managed',
      locator: LOCATOR,
      workspaceId: 'ws_1',
      requestedBy: 'user_1',
    });
    const ref = refFor(provider.id, version.credentialRefId);
    const rotated = await provider.rotate({ credentialRef: ref });

    expect(rotated.credentialRefId).toBe(ref.id);
    expect(rotated.id).not.toBe(version.id);
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.stringify(rotated)).not.toContain(PROVIDER_TOKEN);
    expect(JSON.stringify(rotated)).not.toMatch(/secretValue/i);
  });
});

describe('createInfisicalImporter', () => {
  it('discovers locator metadata from env and never returns the token', async () => {
    const provider = new InfisicalFabricProvider({
      token: PROVIDER_TOKEN,
      projectId: 'proj_1',
      environment: 'prod',
    });
    const importer = createInfisicalImporter(provider, {
      INFISICAL_PROJECT_ID: 'proj_1',
      INFISICAL_ENVIRONMENT: 'prod',
      INFISICAL_SECRET_PATH: '/agents',
      INFISICAL_SECRET_KEY: 'GH_TOKEN',
    });
    const candidates = await importer.discover({ sourceId: 'infisical', workspaceId: 'ws_1' });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.locator).toEqual({
      type: 'infisical',
      projectId: 'proj_1',
      environment: 'prod',
      secretPath: '/agents',
      secretKey: 'GH_TOKEN',
    });
    const preview = await importer.preview({
      candidateId: candidates[0]!.id,
      targetProviderId: provider.id,
    });
    const commit = await importer.commit({
      candidateId: candidates[0]!.id,
      targetProviderId: provider.id,
      mode: 'copy',
      workspaceId: 'ws_1',
      requestedBy: 'user_1',
    });
    expect(commit.mode).toBe('reference');
    expect(JSON.stringify({ candidates, preview, commit })).not.toContain(PROVIDER_TOKEN);
  });
});
