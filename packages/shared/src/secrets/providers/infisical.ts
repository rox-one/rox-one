/**
 * Infisical Secret Provider
 *
 * Fetches secrets over the Infisical REST API — no CLI dependency.
 * Verified against the Infisical docs (2026-08):
 *
 *   GET {baseUrl}/api/v3/secrets/raw/{secretName}
 *       ?workspaceId=<projectId>&environment=<envSlug>&secretPath=<path>
 *   Authorization: Bearer <service token or machine-identity access token>
 *
 *   200 → { secret: { secretKey, secretValue, ... } }
 *   4xx/5xx → { reqId, statusCode, message, error }
 *
 * Auth: a service token / access token from the `INFISICAL_TOKEN` env var
 * (or explicit option). Scope: projectId + environment + secretPath from
 * options or INFISICAL_PROJECT_ID / INFISICAL_ENVIRONMENT /
 * INFISICAL_SECRET_PATH env vars.
 *
 * Failures are typed: INFISICAL_UNAVAILABLE (not configured / network /
 * unexpected response), INFISICAL_AUTH_FAILED (401/403). A 404 is not an
 * error — resolve() returns null. Successful lookups are cached for a short
 * TTL (default 60s) so a spawn storm doesn't hammer the API; misses are not
 * cached.
 */

import { SecretResolveError, type SecretProvider, type SecretRef } from '../types.ts';

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface InfisicalProviderOptions {
  /** API base URL. Default: INFISICAL_BASE_URL env, else https://app.infisical.com */
  baseUrl?: string;
  /** Service token / access token. Default: INFISICAL_TOKEN env. */
  token?: string;
  /** Project (workspace) ID. Default: INFISICAL_PROJECT_ID env. */
  projectId?: string;
  /** Environment slug (e.g. "dev", "prod"). Default: INFISICAL_ENVIRONMENT env. */
  environment?: string;
  /** Secret folder path. Default: INFISICAL_SECRET_PATH env, else "/". */
  secretPath?: string;
  /** Cache TTL for successful lookups in ms. Default: 60_000. */
  ttlMs?: number;
  /** Injectable fetch (tests). Default: global fetch. */
  fetch?: FetchLike;
  /** Injectable clock (tests). Default: Date.now. */
  now?: () => number;
}

const DEFAULT_BASE_URL = 'https://app.infisical.com';
const DEFAULT_TTL_MS = 60_000;

export class InfisicalProvider implements SecretProvider {
  readonly id = 'infisical' as const;

  private readonly baseUrl?: string;
  private readonly token?: string;
  private readonly projectId?: string;
  private readonly environment?: string;
  private readonly secretPath?: string;
  private readonly ttlMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(options: InfisicalProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.INFISICAL_BASE_URL;
    this.token = options.token ?? process.env.INFISICAL_TOKEN;
    this.projectId = options.projectId ?? process.env.INFISICAL_PROJECT_ID;
    this.environment = options.environment ?? process.env.INFISICAL_ENVIRONMENT;
    this.secretPath = options.secretPath ?? process.env.INFISICAL_SECRET_PATH;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike);
    this.now = options.now ?? Date.now;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.token && this.projectId && this.environment);
  }

  private configured(): { baseUrl: string; token: string; projectId: string; environment: string; secretPath: string } {
    if (!this.token || !this.projectId || !this.environment) {
      throw new SecretResolveError(
        'INFISICAL_UNAVAILABLE',
        this.id,
        'Infisical provider is not configured (need token, projectId, environment)',
      );
    }
    return {
      baseUrl: (this.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
      token: this.token,
      projectId: this.projectId,
      environment: this.environment,
      secretPath: this.secretPath ?? '/',
    };
  }

  async resolve(ref: SecretRef): Promise<string | null> {
    const secretName = ref.ref ?? ref.name;
    const cached = this.cache.get(secretName);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }

    const cfg = this.configured();
    const params = new URLSearchParams({
      workspaceId: cfg.projectId,
      environment: cfg.environment,
      secretPath: cfg.secretPath,
    });
    const url = `${cfg.baseUrl}/api/v3/secrets/raw/${encodeURIComponent(secretName)}?${params.toString()}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
    } catch (error) {
      throw new SecretResolveError(
        'INFISICAL_UNAVAILABLE',
        this.id,
        `Infisical request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.status === 404) {
      return null;
    }
    if (response.status === 401 || response.status === 403) {
      throw new SecretResolveError('INFISICAL_AUTH_FAILED', this.id, `Infisical auth failed (HTTP ${response.status})`);
    }
    if (response.status !== 200) {
      throw new SecretResolveError('INFISICAL_UNAVAILABLE', this.id, `Infisical returned HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SecretResolveError('INFISICAL_UNAVAILABLE', this.id, 'Infisical returned non-JSON success response');
    }

    const secretValue = (body as { secret?: { secretValue?: unknown } })?.secret?.secretValue;
    if (typeof secretValue !== 'string') {
      throw new SecretResolveError('INFISICAL_UNAVAILABLE', this.id, 'Infisical response missing secret.secretValue');
    }

    this.cache.set(secretName, { value: secretValue, expiresAt: this.now() + this.ttlMs });
    return secretValue;
  }
}
