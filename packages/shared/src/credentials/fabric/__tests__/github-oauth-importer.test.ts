import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import type { CredentialImporter } from '../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';
import { maskSecret } from '../materialization.ts';
import {
  GithubOAuthImporter,
  pollDeviceLogin,
  startDeviceLogin,
  type GithubOAuthHttpClient,
  type GithubOAuthHttpRequest,
  type GithubOAuthHttpResponse,
} from '../github-oauth-importer.ts';

const CLIENT_ID = 'Iv1.test-client';
const ACCESS_TOKEN = 'gho_super-secret-oauth-token';
const DEVICE_CODE = 'device-code-abc';
const USER_CODE = 'ABCD-1234';

class MemoryBackend implements CredentialBackend {
  readonly name = 'memory';
  readonly priority = 1;
  readonly store = new Map<string, StoredCredential>();
  async isAvailable(): Promise<boolean> { return true; }
  async get(id: CredentialId): Promise<StoredCredential | null> {
    return this.store.get(credentialIdToAccount(id)) ?? null;
  }
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.store.set(credentialIdToAccount(id), credential);
  }
  async delete(id: CredentialId): Promise<boolean> {
    return this.store.delete(credentialIdToAccount(id));
  }
  async list(): Promise<CredentialId[]> { return []; }
}

class FakeGithubOAuth {
  readonly calls: GithubOAuthHttpRequest[] = [];
  pollError: string | undefined = 'authorization_pending';
  pollStatus = 200;
  startStatus = 200;

  readonly http: GithubOAuthHttpClient = async (request) => {
    this.calls.push(request);
    const url = new URL(request.url);
    expect(url.hostname).toBe('github.com');
    expect(url.hostname).not.toBe('api.github.com');

    if (request.method === 'POST' && url.pathname === '/login/device/code') {
      if (this.startStatus !== 200) return json(this.startStatus, { error: 'failed' });
      const body = parseBody(request.body);
      expect(body.client_id).toBe(CLIENT_ID);
      return json(200, {
        device_code: DEVICE_CODE,
        user_code: USER_CODE,
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });
    }

    if (request.method === 'POST' && url.pathname === '/login/oauth/access_token') {
      const body = parseBody(request.body);
      expect(body.client_id).toBe(CLIENT_ID);
      expect(body.device_code).toBe(DEVICE_CODE);
      expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:device_code');
      if (this.pollError) {
        return json(this.pollStatus, { error: this.pollError, interval: 8 });
      }
      return json(200, {
        access_token: ACCESS_TOKEN,
        token_type: 'bearer',
        scope: 'read:user',
      });
    }

    throw new Error(`unexpected request ${request.method} ${request.url}`);
  };
}

function json(status: number, body: unknown): GithubOAuthHttpResponse {
  return { status, body: JSON.stringify(body) };
}

function parseBody(body: string | undefined): Record<string, string> {
  if (!body) return {};
  const out: Record<string, string> = {};
  for (const part of body.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    out[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
  }
  return out;
}

function createImporter(token = ACCESS_TOKEN) {
  const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry());
  return { importer: new GithubOAuthImporter({ provider, accessToken: token }), provider };
}

describe('CF GitHub OAuth importer', () => {
  it('implements CredentialImporter', () => {
    const typed: CredentialImporter = createImporter().importer;
    expect(typed.id).toBe('github-oauth');
    expect(typed.sourceKind).toBe('github-oauth');
  });

  it('startDeviceLogin fails closed without a client id', async () => {
    const fake = new FakeGithubOAuth();
    await expect(startDeviceLogin(fake.http, { clientId: '' })).rejects.toThrow(/missing_client_id/);
    expect(fake.calls).toHaveLength(0);
  });

  it('startDeviceLogin returns codes without an access token and never hits api.github.com', async () => {
    const fake = new FakeGithubOAuth();
    const started = await startDeviceLogin(fake.http, { clientId: CLIENT_ID, scope: 'read:user' });
    expect(started).toEqual({
      deviceCode: DEVICE_CODE,
      userCode: USER_CODE,
      verificationUri: 'https://github.com/login/device',
      interval: 5,
      expiresIn: 900,
    });
    expect(JSON.stringify(started)).not.toContain(ACCESS_TOKEN);
    expect(started).not.toHaveProperty('accessToken');
    expect(started).not.toHaveProperty('access_token');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe('https://github.com/login/device/code');
    expect(fake.calls.every((call) => !call.url.includes('api.github.com'))).toBe(true);
  });

  it('pollDeviceLogin returns pending then approved token for commit path only', async () => {
    const fake = new FakeGithubOAuth();
    const pending = await pollDeviceLogin(fake.http, { clientId: CLIENT_ID, deviceCode: DEVICE_CODE });
    expect(pending).toEqual({ status: 'pending', interval: 8 });
    expect(JSON.stringify(pending)).not.toContain(ACCESS_TOKEN);

    fake.pollError = undefined;
    const approved = await pollDeviceLogin(fake.http, { clientId: CLIENT_ID, deviceCode: DEVICE_CODE });
    expect(approved.status).toBe('approved');
    if (approved.status !== 'approved') throw new Error('expected approved');
    expect(approved.accessToken).toBe(ACCESS_TOKEN);
    expect(fake.calls.every((call) => !call.url.includes('api.github.com'))).toBe(true);
  });

  it('pollDeviceLogin maps denied and expired errors', async () => {
    const fake = new FakeGithubOAuth();
    fake.pollError = 'access_denied';
    expect(await pollDeviceLogin(fake.http, { clientId: CLIENT_ID, deviceCode: DEVICE_CODE })).toEqual({
      status: 'denied',
    });
    fake.pollError = 'expired_token';
    expect(await pollDeviceLogin(fake.http, { clientId: CLIENT_ID, deviceCode: DEVICE_CODE })).toEqual({
      status: 'expired',
    });
    fake.pollError = 'slow_down';
    expect(await pollDeviceLogin(fake.http, { clientId: CLIENT_ID, deviceCode: DEVICE_CODE })).toEqual({
      status: 'slow_down',
      interval: 8,
    });
  });

  it('discover and preview never include the raw access token', async () => {
    const { importer } = createImporter();
    const discovered = await importer.discover();
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.label).toBe('GitHub OAuth');
    expect(discovered[0]?.kind).toBe('bearer_token');
    expect(JSON.stringify(discovered)).not.toContain(ACCESS_TOKEN);
    expect(discovered[0]).not.toHaveProperty('accessToken');
    expect(discovered[0]).not.toHaveProperty('token');

    const preview = await importer.preview({ candidateId: discovered[0]!.id });
    expect(preview.maskedSummary).toBe(maskSecret(ACCESS_TOKEN));
    expect(preview.maskedSummary).toBe('****oken');
    expect(JSON.stringify(preview)).not.toContain(ACCESS_TOKEN);
    expect(preview).not.toHaveProperty('accessToken');
    expect(preview).not.toHaveProperty('value');
  });

  it('preview masks short tokens as ****', async () => {
    const { importer } = createImporter('abc');
    await importer.discover();
    const preview = await importer.preview({ candidateId: 'github-oauth' });
    expect(preview.maskedSummary).toBe('****');
    expect(JSON.stringify(preview)).not.toContain('abc');
  });

  it('commits a bearer copy without leaking the token on the commit result', async () => {
    const { importer, provider } = createImporter();
    const [candidate] = await importer.discover();
    if (!candidate) throw new Error('expected candidate');
    const committed = await importer.commit({
      candidateId: candidate.id,
      targetProviderId: 'local-file',
      mode: 'copy',
      workspaceId: 'w',
      requestedBy: 'owner',
    });
    expect(committed.credentialRefId).toMatch(/^cred_/);
    expect(JSON.stringify(committed)).not.toContain(ACCESS_TOKEN);

    const material = await provider.resolveForLease({
      credentialRef: {
        id: committed.credentialRefId,
        kind: 'bearer_token',
        providerId: 'local-file',
        locator: { type: 'local', key: 'github-oauth:bearer' },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(material.payload.value).toBe(ACCESS_TOKEN);
    expect(JSON.stringify(material)).not.toContain(ACCESS_TOKEN);
  });
});
