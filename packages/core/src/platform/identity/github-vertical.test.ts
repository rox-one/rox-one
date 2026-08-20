import { describe, expect, it } from 'bun:test';
import type { ConsumerIdentity } from './broker.ts';
import { importGithubFromEnv, runGithubVertical, type FetchLike } from './github-vertical.ts';
import { createP0ProviderStack, createSealedSecret } from './p0-adapters.ts';
import { ConnectionFabricError } from './provider-contract.ts';

const TOKEN = 'ghp_testVerticalToken_doNotLeak';
const CONSUMER: ConsumerIdentity = {
  kind: 'agent',
  id: 'agent_github',
  workspaceId: 'ws_github',
};

function mockGithubFetch(login = 'octocat'): {
  fetch: FetchLike;
  authorizationHeaders: string[];
} {
  const authorizationHeaders: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    expect(String(url)).toBe('https://api.github.com/user');
    const headers = new Headers(init?.headers);
    const auth = headers.get('Authorization') ?? '';
    authorizationHeaders.push(auth);
    return new Response(JSON.stringify({ login, id: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch: fetchImpl, authorizationHeaders };
}

describe('CF-7 GitHub vertical', () => {
  it('importGithubFromEnv commits dotenv candidate without storing the token', async () => {
    const stack = createP0ProviderStack({
      listEnvFiles: async () => [{ path: '/repo/.env', keys: ['GH_TOKEN', 'OTHER'] }],
      approveCopy: async () => createSealedSecret('api_key', TOKEN),
    });

    const imported = await importGithubFromEnv(stack, {
      workspaceId: 'ws_github',
      requestedBy: 'user_1',
      injectedToken: TOKEN,
    });

    expect(imported.mode).toBe('copy');
    expect(imported.locator).toEqual({ type: 'dotenv', path: '/repo/.env', key: 'GH_TOKEN' });
    expect(JSON.stringify(imported)).not.toContain(TOKEN);
    expect(JSON.stringify(imported)).not.toMatch(/ghp_/);

    const inspect = await stack.provider.inspect({
      id: imported.credentialRefId,
      kind: imported.kind,
      providerId: imported.providerId,
      locator: imported.locator,
      createdAt: 0,
      updatedAt: 0,
    });
    expect(inspect.hasMaterial).toBe(true);
    expect(JSON.stringify(inspect)).not.toContain(TOKEN);
  });

  it('importGithubFromEnv accepts injectedToken when no env candidate exists', async () => {
    const stack = createP0ProviderStack();
    const imported = await importGithubFromEnv(stack, {
      workspaceId: 'ws_github',
      requestedBy: 'user_1',
      injectedToken: TOKEN,
      mode: 'reference',
      envPath: '/tmp/.env',
    });
    expect(imported.mode).toBe('reference');
    expect(imported.locator).toEqual({ type: 'dotenv', path: '/tmp/.env', key: 'GH_TOKEN' });
    expect(JSON.stringify(imported)).not.toContain(TOKEN);
  });

  it('runGithubVertical sends Authorization Bearer and returns metadata only', async () => {
    const stack = createP0ProviderStack({
      listEnvFiles: async () => [{ path: '/repo/.env', keys: ['GITHUB_TOKEN'] }],
    });
    const { fetch, authorizationHeaders } = mockGithubFetch('rox-bot');

    const result = await runGithubVertical({
      workspaceId: CONSUMER.workspaceId,
      requestedBy: 'user_1',
      consumer: CONSUMER,
      stack,
      tokenEnvKeys: ['GITHUB_TOKEN', 'GH_TOKEN'],
      injectedToken: TOKEN,
      fetch,
    });

    expect(authorizationHeaders).toEqual([`Bearer ${TOKEN}`]);
    expect(result.login).toBe('rox-bot');
    expect(result.leaseId).toMatch(/^lease_/);
    expect(result.connectionId).toMatch(/^conn_/);
    expect(result.credentialRefId).toMatch(/^cred_/);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toMatch(/ghp_|Bearer /);
    expect('token' in result).toBe(false);
    expect('injectedToken' in result).toBe(false);
  });

  it('denies when AccessGrant is missing', async () => {
    const stack = createP0ProviderStack({
      listEnvFiles: async () => [{ path: '/repo/.env', keys: ['GH_TOKEN'] }],
    });
    const { fetch, authorizationHeaders } = mockGithubFetch();

    await expect(
      runGithubVertical({
        workspaceId: CONSUMER.workspaceId,
        requestedBy: 'user_1',
        consumer: CONSUMER,
        stack,
        injectedToken: TOKEN,
        fetch,
        createGrant: false,
      }),
    ).rejects.toMatchObject({ code: 'GRANT_MISSING' });

    expect(authorizationHeaders).toEqual([]);
  });

  it('fails closed when GitHub returns 401', async () => {
    const stack = createP0ProviderStack({
      listEnvFiles: async () => [{ path: '/repo/.env', keys: ['GH_TOKEN'] }],
    });
    const fetchImpl: FetchLike = async () => new Response('unauthorized', { status: 401 });

    await expect(
      runGithubVertical({
        workspaceId: CONSUMER.workspaceId,
        requestedBy: 'user_1',
        consumer: CONSUMER,
        stack,
        injectedToken: TOKEN,
        fetch: fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ConnectionFabricError);
  });
});
