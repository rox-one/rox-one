import type { CredentialKind, CredentialRefId, StorageMode } from '@craft-agent/core/platform';
import { maskSecret } from './materialization.ts';
import type { LocalFileSecretProvider } from './local-file-provider.ts';
import type {
  CredentialImporter,
  ImportCandidate,
  ImportCommitInput,
  ImportDiscoveryInput,
  ImportPreview,
} from './types.ts';

const SUPPORTED_MODES: readonly StorageMode[] = ['reference', 'copy'];
const KIND: CredentialKind = 'bearer_token';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const CANDIDATE_ID = 'github-oauth';

export interface GithubOAuthHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface GithubOAuthHttpResponse {
  readonly status: number;
  readonly body: string;
}

export type GithubOAuthHttpClient = (
  request: GithubOAuthHttpRequest,
) => Promise<GithubOAuthHttpResponse>;

export interface GithubDeviceLoginStart {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly interval: number;
  readonly expiresIn?: number;
}

export type GithubDeviceLoginPollResult =
  | { readonly status: 'pending'; readonly interval?: number }
  | { readonly status: 'slow_down'; readonly interval?: number }
  | { readonly status: 'approved'; readonly accessToken: string }
  | { readonly status: 'denied' }
  | { readonly status: 'expired' };

export interface GithubOAuthImporterOptions {
  readonly provider: LocalFileSecretProvider;
  /** Access token from pollDeviceLogin — kept private; never placed on discover/preview JSON. */
  readonly accessToken: string;
}

/**
 * Start GitHub OAuth device login. Returns user-facing codes only — no access token.
 * Device code is needed for polling and is not a bearer secret.
 */
export async function startDeviceLogin(
  http: GithubOAuthHttpClient,
  input: { readonly clientId: string; readonly scope?: string },
): Promise<GithubDeviceLoginStart> {
  if (!input.clientId) throw new Error('missing_client_id');
  const body = new URLSearchParams({ client_id: input.clientId });
  if (input.scope) body.set('scope', input.scope);
  const response = await http({
    method: 'POST',
    url: DEVICE_CODE_URL,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error('device_login_failed');
  }
  const parsed = parseFormOrJson(response.body);
  const deviceCode = stringField(parsed.device_code);
  const userCode = stringField(parsed.user_code);
  const verificationUri =
    stringField(parsed.verification_uri) ?? stringField(parsed.verification_uri_complete);
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error('device_login_invalid_response');
  }
  const interval = numberField(parsed.interval) ?? 5;
  const expiresIn = numberField(parsed.expires_in);
  const started: GithubDeviceLoginStart = {
    deviceCode,
    userCode,
    verificationUri,
    interval,
    ...(expiresIn !== undefined ? { expiresIn } : {}),
  };
  assertNoAccessToken(started);
  return started;
}

/**
 * Poll GitHub for the device-flow token. On success, `accessToken` is returned for the
 * commit path only — callers MUST NOT put it on discover/preview JSON.
 */
export async function pollDeviceLogin(
  http: GithubOAuthHttpClient,
  input: { readonly clientId: string; readonly deviceCode: string },
): Promise<GithubDeviceLoginPollResult> {
  if (!input.clientId) throw new Error('missing_client_id');
  if (!input.deviceCode) throw new Error('missing_device_code');
  const body = new URLSearchParams({
    client_id: input.clientId,
    device_code: input.deviceCode,
    grant_type: DEVICE_GRANT_TYPE,
  });
  const response = await http({
    method: 'POST',
    url: ACCESS_TOKEN_URL,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const parsed = parseFormOrJson(response.body);
  const error = stringField(parsed.error);
  if (error === 'authorization_pending') {
    return { status: 'pending', ...(numberField(parsed.interval) !== undefined ? { interval: numberField(parsed.interval) } : {}) };
  }
  if (error === 'slow_down') {
    return { status: 'slow_down', interval: numberField(parsed.interval) ?? 10 };
  }
  if (error === 'access_denied' || error === 'unauthorized_client') {
    return { status: 'denied' };
  }
  if (error === 'expired_token' || error === 'incorrect_device_code') {
    return { status: 'expired' };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error('device_poll_failed');
  }
  const accessToken = stringField(parsed.access_token);
  if (!accessToken) {
    if (error) throw new Error(`device_poll_error:${error}`);
    throw new Error('device_poll_invalid_response');
  }
  return { status: 'approved', accessToken };
}

export class GithubOAuthImporter implements CredentialImporter {
  readonly id = 'github-oauth';
  readonly sourceKind = 'github-oauth';
  private readonly accessToken: string;
  private lastCommit: CredentialRefId | undefined;

  constructor(private readonly options: GithubOAuthImporterOptions) {
    if (!options.accessToken) throw new Error('missing_access_token');
    this.accessToken = options.accessToken;
  }

  async discover(_input?: ImportDiscoveryInput): Promise<ImportCandidate[]> {
    const candidate: ImportCandidate = {
      id: CANDIDATE_ID,
      sourceId: this.id,
      kind: KIND,
      label: 'GitHub OAuth',
      conflictKey: 'github-oauth:bearer',
      locator: 'github.com',
    };
    assertNoSecret(candidate, this.accessToken);
    return [candidate];
  }

  async preview(input: { candidateId: string }): Promise<ImportPreview> {
    if (input.candidateId !== CANDIDATE_ID) throw new Error('Unknown import candidate');
    const preview: ImportPreview = {
      candidateId: CANDIDATE_ID,
      inferredKind: KIND,
      targetProviderId: this.options.provider.id,
      proposedMode: 'copy',
      maskedSummary: maskSecret(this.accessToken),
      warnings: [],
    };
    assertNoSecret(preview, this.accessToken);
    return preview;
  }

  async validate(input: ImportCommitInput): Promise<{ ok: true } | { ok: false; code: string }> {
    if (input.candidateId !== CANDIDATE_ID) return { ok: false, code: 'unknown_candidate' };
    if (!SUPPORTED_MODES.includes(input.mode)) return { ok: false, code: 'unsupported_mode' };
    if (!this.accessToken) return { ok: false, code: 'secret_unavailable' };
    return { ok: true };
  }

  async commit(input: ImportCommitInput): Promise<{ credentialRefId: CredentialRefId }> {
    const valid = await this.validate(input);
    if (!valid.ok) throw new Error(valid.code);
    const written = await this.options.provider.write({
      kind: KIND,
      locator: { type: 'local', key: 'github-oauth:bearer' },
      payload: { value: this.accessToken },
      copyPayload: input.mode !== 'reference',
    });
    this.lastCommit = written.ref.id;
    return { credentialRefId: written.ref.id };
  }

  async rollback(input?: { credentialRefId?: CredentialRefId }): Promise<void> {
    const id = input?.credentialRefId ?? this.lastCommit;
    if (!id) return;
    await this.options.provider.revoke({
      credentialRef: {
        id,
        kind: KIND,
        providerId: this.options.provider.id,
        locator: { type: 'local', key: id },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    if (this.lastCommit === id) this.lastCommit = undefined;
  }
}

function parseFormOrJson(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  const out: Record<string, unknown> = {};
  for (const part of trimmed.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = decodeURIComponent(part.slice(0, eq).replace(/\+/g, ' '));
    const value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    out[key] = value;
  }
  return out;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoAccessToken(value: unknown): void {
  const json = JSON.stringify(value);
  if (/"access_token"\s*:/i.test(json) || /"accessToken"\s*:/i.test(json)) {
    throw new Error('Import candidate leaked a secret');
  }
}

function assertNoSecret(value: unknown, secret: string): void {
  if (!secret) return;
  if (JSON.stringify(value).includes(secret)) {
    throw new Error('Import candidate leaked a secret');
  }
}
