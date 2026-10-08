import { createLocalJWKSet, createRemoteJWKSet, errors as joseErrors, jwtVerify, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';

/** Configuration belongs to the server composition root, never to a handshake. */
export type VerifiedActorConfig = {
  issuer: string;
  audience: string;
  algorithms: readonly ('EdDSA' | 'RS256' | 'PS256' | 'ES256')[];
  keySource: { jwks: JSONWebKeySet } | { jwksUri: URL; allowLoopbackHttp?: boolean };
  now?: () => Date;
};

export type VerifiedSessionIdentity = Readonly<{
  issuer: string;
  subject: string;
  principalId: string;
  sessionId: string;
  deviceId: string;
  /** Milliseconds since epoch; bounded by both JWT and persisted session expiry. */
  expiresAt: number;
}>;

export type PersistedAuthSession = VerifiedSessionIdentity & { revokedAt: number | null };

export interface VerifiedIdentityRepository {
  /** Exact immutable (issuer, subject) lookup; no email or profile ID fallback. */
  resolvePrincipal(issuer: string, subject: string): Promise<string | null>;
  /** Adapter may establish a server binding only from this already verified input. */
  resolveSession(input: Readonly<{
    issuer: string; subject: string; principalId: string;
    verifiedSessionId?: string; verifiedTokenId?: string; tokenExpiresAt: number;
  }>): Promise<PersistedAuthSession | null>;
  findSession(issuer: string, sessionId: string): Promise<PersistedAuthSession | null>;
}

export interface LiveWorkspaceMembershipPort {
  listActiveWorkspaceIds(principalId: string): Promise<readonly string[]>;
}

export type VerifiedActorInput = VerifiedSessionIdentity & {
  authenticatedWorkspaceIds: readonly string[];
};

/** TActor is the WP-01 canonical Actor, supplied by its owner through createActor. */
export type VerifiedActorSession<TActor> = Readonly<{
  actor: TActor;
  identity: VerifiedSessionIdentity;
}>;

export class AuthenticationError extends Error {
  readonly code = 'UNAUTHENTICATED';
  readonly statusCode = 401;
  constructor() { super('Authentication required'); this.name = 'AuthenticationError'; }
}

/**
 * W1-03 (#1500): the identity/membership store failed (not the credential).
 * Still an AuthenticationError (401 wherever it is not mapped explicitly);
 * the command bus route answers 503 so an outbox retries instead of pausing.
 */
export class AuthenticationUnavailableError extends AuthenticationError {
  readonly reason: unknown;
  // name, code, status and message stay those of AuthenticationError (identical outside the commands route).
  constructor(reason: unknown) { super(); this.reason = reason; }
}

async function io<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationUnavailableError(error);
  }
}

/**
 * JWKS fetch failures (timeout, network error, non-200, malformed key set)
 * versus token problems (no / ambiguous matching key, unsupported or
 * disallowed algorithm, malformed JWS), which stay 401.
 */
function isJwksOutage(error: unknown): boolean {
  if (error instanceof joseErrors.JWKSNoMatchingKey || error instanceof joseErrors.JWKSMultipleMatchingKeys ||
      error instanceof joseErrors.JOSENotSupported || error instanceof joseErrors.JOSEAlgNotAllowed ||
      error instanceof joseErrors.JWSInvalid || error instanceof joseErrors.JWTInvalid) return false;
  return true;
}

const rethrow = (error: unknown): never => {
  throw error instanceof AuthenticationUnavailableError ? error : new AuthenticationError();
};

const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 2048;

export function createVerifiedActorResolver<TActor extends object>(
  config: VerifiedActorConfig,
  repository: VerifiedIdentityRepository,
  memberships: LiveWorkspaceMembershipPort,
  createActor: (input: VerifiedActorInput) => TActor,
) {
  if (!nonempty(config.issuer) || !nonempty(config.audience) || config.algorithms.length === 0 ||
      config.algorithms.some(value => !['EdDSA', 'RS256', 'PS256', 'ES256'].includes(value))) {
    throw new Error('Explicit asymmetric issuer, audience and algorithms are required');
  }
  const issuer = config.issuer;
  const audience = config.audience;
  const algorithms = [...config.algorithms];
  const now = config.now ?? (() => new Date());
  let getKey;
  if ('jwks' in config.keySource) {
    if (!config.keySource.jwks.keys.length || config.keySource.jwks.keys.some(key =>
      !['RSA', 'EC', 'OKP'].includes(key.kty ?? '') || 'd' in key || 'k' in key)) {
      throw new Error('Trusted public asymmetric JWKS required');
    }
    getKey = createLocalJWKSet(config.keySource.jwks);
  } else {
    const url = new URL(config.keySource.jwksUri);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && config.keySource.allowLoopbackHttp))) {
      throw new Error('Configured JWKS endpoint must use HTTPS or explicit loopback HTTP');
    }
    // jose never takes the URL from token jku/x5u headers.
    const remote = createRemoteJWKSet(url, { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 60000 });
    // W1-03 (#1500): an IdP / JWKS outage is not a credential problem.
    const remoteKey: JWTVerifyGetKey = async (header, token) => {
      try { return await remote(header, token); } catch (error) {
        throw isJwksOutage(error) ? new AuthenticationUnavailableError(error) : error;
      }
    };
    getKey = remoteKey;
  }
  const issued = new WeakMap<object, VerifiedSessionIdentity>();

  function assertLive(session: PersistedAuthSession | null, identity: VerifiedSessionIdentity): asserts session is PersistedAuthSession {
    if (!session || session.revokedAt !== null || !nonempty(session.sessionId) || !nonempty(session.deviceId) ||
        session.issuer !== identity.issuer || session.subject !== identity.subject ||
        session.principalId !== identity.principalId || session.sessionId !== identity.sessionId ||
        session.deviceId !== identity.deviceId || !Number.isFinite(session.expiresAt) ||
        now().getTime() >= Math.min(identity.expiresAt, session.expiresAt)) throw new AuthenticationError();
  }

  async function materialize(identity: VerifiedSessionIdentity, session: PersistedAuthSession): Promise<VerifiedActorSession<TActor>> {
    assertLive(session, identity);
    const workspaceIds = await io(() => memberships.listActiveWorkspaceIds(identity.principalId));
    if (!Array.isArray(workspaceIds) || workspaceIds.some(id => !nonempty(id))) throw new AuthenticationError();
    // Membership resolution can await I/O; reread session to observe a revoke during it.
    const latestSession = await io(() => repository.findSession(identity.issuer, identity.sessionId));
    assertLive(latestSession, identity);
    const freshIdentity = Object.freeze({ ...identity, expiresAt: Math.min(identity.expiresAt, latestSession.expiresAt) });
    const actor = createActor({ ...freshIdentity, authenticatedWorkspaceIds: Object.freeze([...new Set(workspaceIds)].sort()) });
    Object.freeze(actor);
    const result = Object.freeze({
      actor,
      identity: freshIdentity,
    });
    issued.set(result, freshIdentity);
    return result;
  }

  return {
    async authenticate(token: string): Promise<VerifiedActorSession<TActor>> {
      try {
        if (typeof token !== 'string' || !token.length || token.length > 16384) throw new AuthenticationError();
        const { payload } = await jwtVerify(token, getKey, {
          issuer, audience, algorithms,
          requiredClaims: ['sub', 'exp'], currentDate: now(), clockTolerance: 0,
        });
        if (!nonempty(payload.sub) || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) ||
            (payload.sid !== undefined && !nonempty(payload.sid)) ||
            (payload.jti !== undefined && !nonempty(payload.jti))) throw new AuthenticationError();
        const principalId = await io(() => repository.resolvePrincipal(issuer, payload.sub as string));
        if (!nonempty(principalId)) throw new AuthenticationError();
        const session = await io(() => repository.resolveSession({
          issuer, subject: payload.sub as string, principalId,
          verifiedSessionId: payload.sid as string | undefined, verifiedTokenId: payload.jti,
          tokenExpiresAt: (payload.exp as number) * 1000,
        }));
        if (!session) throw new AuthenticationError();
        const identity: VerifiedSessionIdentity = Object.freeze({
          issuer, subject: payload.sub, principalId,
          sessionId: session.sessionId, deviceId: session.deviceId, expiresAt: payload.exp * 1000,
        });
        return await materialize(identity, session);
      } catch (error) { return rethrow(error); }
    },
    /** Refresh before protected operations/replay. Commands still enforce policy in their DB transaction. */
    async revalidate(bound: VerifiedActorSession<TActor>): Promise<VerifiedActorSession<TActor>> {
      try {
        const identity = issued.get(bound);
        if (!identity || now().getTime() >= identity.expiresAt ||
            await io(() => repository.resolvePrincipal(identity.issuer, identity.subject)) !== identity.principalId) throw new AuthenticationError();
        const session = await io(() => repository.findSession(identity.issuer, identity.sessionId));
        assertLive(session, identity);
        return await materialize(identity, session);
      } catch (error) { return rethrow(error); }
    },
  };
}
