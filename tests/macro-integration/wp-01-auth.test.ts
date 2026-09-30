import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm, stat, chmod, readFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, SignJWT, decodeJwt } from 'jose';
import { createLocalIssuer, hashLocalAccountPassword, type LocalIssuerPersistence } from '../../apps/workspace-service/src/auth/local-issuer';
import { AuthenticationError, createVerifiedActorResolver, type PersistedAuthSession, type VerifiedIdentityRepository } from '../../apps/workspace-service/src/auth/verified-actor';

const roots: string[] = [];
const databases: Database[] = [];
const required = <T>(value: T | undefined): T => { if (value === undefined) throw new Error('Test fixture value missing'); return value; };
const firstKey = (jwks: { keys: { kid?: string }[] }) => required(jwks.keys[0]);
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

type Actor = import('../../packages/shared/src/workspace-domain/identity/contracts').AuthenticatedActor;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rox-auth-'));
  roots.push(root);
  let db = new Database(join(root, 'identity.sqlite'));
  databases.push(db);
  db.exec(`
    CREATE TABLE account(login TEXT PRIMARY KEY, subject TEXT UNIQUE, principal TEXT UNIQUE, hash TEXT, disabled INTEGER);
    CREATE TABLE session(issuer TEXT, subject TEXT, principal TEXT, session_id TEXT PRIMARY KEY, token_id TEXT, device_id TEXT, expires_at INTEGER, revoked_at INTEGER);
    CREATE TABLE membership(principal TEXT, workspace TEXT, active INTEGER, PRIMARY KEY(principal, workspace));
  `);
  const issuer = `urn:rox:local:${crypto.randomUUID()}`;
  const audience = `rox-workspace:${crypto.randomUUID()}`;
  let currentTime = new Date();
  const config = {
    mode: 'local-bootstrap' as const, issuer, audience,
    stateDirectory: join(root, 'private'), checkoutDirectory: process.cwd(),
    tokenLifetimeSeconds: 60, now: () => currentTime,
  };
  const users = await Promise.all([1, 2].map(async () => {
    const login = `account-${crypto.randomUUID()}`;
    const subject = crypto.randomUUID();
    const principal = crypto.randomUUID();
    const password = `secret-${crypto.randomUUID()}`;
    const hash = await hashLocalAccountPassword(password);
    db.query('INSERT INTO account VALUES (?, ?, ?, ?, 0)').run(login, subject, principal, hash);
    return { login, subject, principal, password };
  }));
  const workspace = crypto.randomUUID();
  db.query('INSERT INTO membership VALUES (?, ?, 1)').run(required(users[0]).principal, workspace);
  const persistence: LocalIssuerPersistence = {
    async findAccount(login) {
      const row = db.query('SELECT subject, hash, disabled FROM account WHERE login = ?').get(login) as { subject: string; hash: string; disabled: number } | null;
      return row ? { subject: row.subject, passwordHash: row.hash, disabled: !!row.disabled } : null;
    },
    async createSession(input) {
      return db.transaction(() => {
        const account = db.query('SELECT principal FROM account WHERE subject = ? AND disabled = 0').get(input.subject) as { principal: string } | null;
        if (!account) return false;
        db.query('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run(
          input.issuer, input.subject, account.principal, input.sessionId, input.tokenId, input.deviceId, input.expiresAt,
        );
        return true;
      })();
    },
  };
  function sessionFrom(row: Record<string, unknown> | null): PersistedAuthSession | null {
    return row ? {
      issuer: row.issuer as string, subject: row.subject as string, principalId: row.principal as string,
      sessionId: row.session_id as string, deviceId: row.device_id as string,
      expiresAt: row.expires_at as number, revokedAt: row.revoked_at as number | null,
    } : null;
  }
  const repository: VerifiedIdentityRepository = {
    async resolvePrincipal(expectedIssuer, subject) {
      if (expectedIssuer !== issuer) return null;
      const row = db.query('SELECT principal FROM account WHERE subject = ? AND disabled = 0').get(subject) as { principal: string } | null;
      return row?.principal ?? null;
    },
    async resolveSession(input) {
      const row = db.query('SELECT * FROM session WHERE issuer = ? AND subject = ? AND principal = ? AND session_id = ? AND token_id = ?')
        .get(input.issuer, input.subject, input.principalId, input.verifiedSessionId ?? '', input.verifiedTokenId ?? '') as Record<string, unknown> | null;
      return sessionFrom(row);
    },
    async findSession(expectedIssuer, sessionId) {
      return sessionFrom(db.query('SELECT * FROM session WHERE issuer = ? AND session_id = ?').get(expectedIssuer, sessionId) as Record<string, unknown> | null);
    },
  };
  const memberships = {
    async listActiveWorkspaceIds(principalId: string) {
      return (db.query('SELECT workspace FROM membership WHERE principal = ? AND active = 1').all(principalId) as { workspace: string }[]).map(row => row.workspace);
    },
  };
  const localIssuer = await createLocalIssuer(config, persistence);
  function resolver(jwks = localIssuer.jwks(), membershipPort = memberships) {
    return createVerifiedActorResolver<Actor>({ issuer, audience, algorithms: ['EdDSA'], keySource: { jwks }, now: config.now }, repository, membershipPort,
      input => ({ principalId: input.principalId, sessionId: input.sessionId, deviceId: input.deviceId, authenticatedWorkspaceIds: input.authenticatedWorkspaceIds, expiresAt: input.expiresAt }));
  }
  const signingKey = JSON.parse(await readFile(join(config.stateDirectory, 'issuer-ed25519.private.jwk'), 'utf8'));
  const { importJWK } = await import('jose');
  const key = await importJWK(signingKey, 'EdDSA');
  async function signed(payload: Record<string, unknown>, options: { key?: CryptoKey | Uint8Array; alg?: string; kid?: string; jku?: string } = {}) {
    return new SignJWT(payload).setProtectedHeader({ alg: options.alg ?? 'EdDSA', kid: options.kid ?? firstKey(localIssuer.jwks()).kid, ...(options.jku ? { jku: options.jku } : {}) })
      .sign(options.key ?? key);
  }
  return { root, db, users, workspace, config, persistence, localIssuer, resolver, signed, repository, memberships,
    restartDatabase: () => {
      databases.splice(databases.indexOf(db), 1);
      db.close();
      db = new Database(join(root, 'identity.sqlite'));
      databases.push(db);
    },
    setTime: (time: Date) => { currentTime = time; }, now: () => currentTime };
}

describe('WP-01 real authenticated actor boundary', () => {
  test('real Argon2id accounts resolve separate canonical principals; restart preserves signing authority', async () => {
    const f = await fixture();
    const first = await f.localIssuer.authenticate(required(f.users[0]).login, required(f.users[0]).password);
    const second = await f.localIssuer.authenticate(required(f.users[1]).login, required(f.users[1]).password);
    const resolver = f.resolver();
    const a = await resolver.authenticate(first.token);
    const b = await resolver.authenticate(second.token);
    expect(a.actor.principalId).toBe(required(f.users[0]).principal);
    expect(b.actor.principalId).toBe(required(f.users[1]).principal);
    expect(a.actor.principalId).not.toBe(b.actor.principalId);
    expect(a.actor.authenticatedWorkspaceIds).toEqual([f.workspace]);
    expect(b.actor.authenticatedWorkspaceIds).toEqual([]);
    expect(a.identity.subject).toBe(required(f.users[0]).subject);
    expect(a.actor.expiresAt).toBe(first.expiresAt);
    expect(Object.isFrozen(a.actor)).toBe(true);
    expect(a.actor.deviceId).not.toBe(a.actor.principalId);
    f.restartDatabase();
    const restarted = await createLocalIssuer(f.config, f.persistence);
    expect(restarted.jwks()).toEqual(f.localIssuer.jwks());
    expect('d' in firstKey(restarted.jwks())).toBe(false);
    expect((await stat(join(f.config.stateDirectory, 'issuer-ed25519.private.jwk'))).mode & 0o777).toBe(0o600);
    expect((await stat(f.config.stateDirectory)).mode & 0o777).toBe(0o700);
    const afterRestart = await restarted.authenticate(required(f.users[1]).login, required(f.users[1]).password);
    expect((await f.resolver(restarted.jwks()).authenticate(first.token)).actor.principalId).toBe(a.actor.principalId);
    expect((await resolver.authenticate(afterRestart.token)).actor.principalId).toBe(b.actor.principalId);
  });

  test('wrong credentials, unknown and disabled accounts never issue sessions', async () => {
    const f = await fixture();
    await expect(f.localIssuer.authenticate(required(f.users[0]).login, 'wrong-password')).rejects.toBeInstanceOf(AuthenticationError);
    await expect(f.localIssuer.authenticate(`missing-${crypto.randomUUID()}`, required(f.users[0]).password)).rejects.toBeInstanceOf(AuthenticationError);
    f.db.query('UPDATE account SET disabled = 1 WHERE login = ?').run(required(f.users[0]).login);
    await expect(f.localIssuer.authenticate(required(f.users[0]).login, required(f.users[0]).password)).rejects.toBeInstanceOf(AuthenticationError);
    expect((f.db.query('SELECT count(*) AS n FROM session').get() as { n: number }).n).toBe(0);
  });

  test('pinned signature, issuer, audience, exp, nbf and nonempty subject reject forged tokens', async () => {
    const f = await fixture();
    const { token } = await f.localIssuer.authenticate(required(f.users[0]).login, required(f.users[0]).password);
    const valid = decodeJwt(token);
    const resolver = f.resolver();
    const other = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const now = Math.floor(f.now().getTime() / 1000);
    const invalids = await Promise.all([
      f.signed({ ...valid, iss: 'urn:untrusted' }), f.signed({ ...valid, aud: 'wrong-audience' }),
      f.signed({ ...valid, sub: ' ' }), f.signed({ ...valid, exp: now - 1 }),
      f.signed({ ...valid, nbf: now + 60 }), f.signed({ ...valid, exp: undefined }),
      f.signed({ ...valid, sid: 'forged-session' }), f.signed({ ...valid, sub: crypto.randomUUID() }),
      f.signed(valid, { key: other.privateKey }), f.signed(valid, { kid: 'untrusted-kid' }),
      f.signed(valid, { key: crypto.getRandomValues(new Uint8Array(32)), alg: 'HS256' }),
    ]);
    const parts = token.split('.');
    invalids.push(`${parts[0]}.${btoa(JSON.stringify({ ...valid, sub: required(f.users[1]).subject }))}.${parts[2]}`);
    invalids.push(`${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(JSON.stringify(valid))}.`);
    for (const invalid of invalids) await expect(resolver.authenticate(invalid)).rejects.toBeInstanceOf(AuthenticationError);
    expect((await resolver.authenticate(token)).actor.principalId).toBe(required(f.users[0]).principal);
  });

  test('signed custom identity claims cannot select principal/device/membership', async () => {
    const f = await fixture();
    const { token } = await f.localIssuer.authenticate(required(f.users[0]).login, required(f.users[0]).password);
    const hostile = await f.signed({ ...decodeJwt(token), principalId: required(f.users[1]).principal,
      deviceId: 'forged-device', authenticatedWorkspaceIds: ['forged-workspace'], roles: ['admin'] });
    const bound = await f.resolver().authenticate(hostile);
    expect(bound.actor.principalId).toBe(required(f.users[0]).principal);
    expect(bound.actor.deviceId).not.toBe('forged-device');
    expect(bound.actor.authenticatedWorkspaceIds).toEqual([f.workspace]);
  });

  test('membership refresh, session revocation, account disabled and expiry are live checks', async () => {
    const f = await fixture();
    const { token } = await f.localIssuer.authenticate(required(f.users[0]).login, required(f.users[0]).password);
    const resolver = f.resolver();
    const bound = await resolver.authenticate(token);
    f.db.query('UPDATE membership SET active = 0 WHERE principal = ?').run(bound.actor.principalId);
    expect((await resolver.revalidate(bound)).actor.authenticatedWorkspaceIds).toEqual([]);
    await expect(resolver.revalidate({ ...bound })).rejects.toBeInstanceOf(AuthenticationError);
    f.db.query('UPDATE session SET revoked_at = ? WHERE session_id = ?').run(Date.now(), bound.actor.sessionId);
    await expect(resolver.revalidate(bound)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(resolver.authenticate(token)).rejects.toBeInstanceOf(AuthenticationError);
    f.db.query('UPDATE session SET revoked_at = NULL WHERE session_id = ?').run(bound.actor.sessionId);
    f.db.query('UPDATE account SET disabled = 1 WHERE principal = ?').run(bound.actor.principalId);
    await expect(resolver.revalidate(bound)).rejects.toBeInstanceOf(AuthenticationError);
    f.db.query('UPDATE account SET disabled = 0 WHERE principal = ?').run(bound.actor.principalId);
    f.setTime(new Date(bound.identity.expiresAt));
    await expect(resolver.revalidate(bound)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(resolver.authenticate(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  test('persisted session expiry and identity binding reject valid signed tokens', async () => {
    const f = await fixture();
    const { token } = await f.localIssuer.authenticate(required(f.users[0]).login, required(f.users[0]).password);
    const resolver = f.resolver();
    const bound = await resolver.authenticate(token);
    f.db.query('UPDATE session SET principal = ? WHERE session_id = ?').run(required(f.users[1]).principal, bound.actor.sessionId);
    await expect(resolver.revalidate(bound)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(resolver.authenticate(token)).rejects.toBeInstanceOf(AuthenticationError);
    f.db.query('UPDATE session SET principal = ?, expires_at = ? WHERE session_id = ?').run(required(f.users[0]).principal, f.now().getTime() - 1, bound.actor.sessionId);
    await expect(resolver.revalidate(bound)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(resolver.authenticate(token)).rejects.toBeInstanceOf(AuthenticationError);
  });



  test('revoke during membership I/O is observed before Actor materialization', async () => {
    const f = await fixture();
    const { token } = await f.localIssuer.authenticate(required(f.users[0]).login, required(f.users[0]).password);
    const sessionId = decodeJwt(token).sid;
    const resolver = f.resolver(f.localIssuer.jwks(), {
      async listActiveWorkspaceIds(principalId) {
        const ids = await f.memberships.listActiveWorkspaceIds(principalId);
        f.db.query('UPDATE session SET revoked_at = ? WHERE session_id = ?').run(Date.now(), sessionId as string);
        return ids;
      },
    });
    await expect(resolver.authenticate(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  test('configured loopback JWKS verifies real HTTP keys and ignores token-selected key URLs', async () => {
    const f = await fixture();
    const { token } = await f.localIssuer.authenticate(required(f.users[0]).login, required(f.users[0]).password);
    let requests = 0;
    let failed = false;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
      requests++;
      return failed ? new Response('unavailable', { status: 503 }) : Response.json(f.localIssuer.jwks());
    } });
    try {
      const keySource = { jwksUri: new URL(`http://127.0.0.1:${server.port}/jwks`), allowLoopbackHttp: true };
      const remote = createVerifiedActorResolver({ issuer: f.config.issuer, audience: f.config.audience, algorithms: ['EdDSA'], keySource },
        f.repository, f.memberships, x => x);
      expect((await remote.authenticate(token)).actor.principalId).toBe(required(f.users[0]).principal);
      expect(requests).toBe(1);
      const hostile = await f.signed(decodeJwt(token), { jku: `http://127.0.0.1:${server.port}/attacker-key` });
      expect((await remote.authenticate(hostile)).actor.principalId).toBe(required(f.users[0]).principal);
      expect(requests).toBe(1);
      failed = true;
      const fresh = createVerifiedActorResolver({ issuer: f.config.issuer, audience: f.config.audience, algorithms: ['EdDSA'], keySource },
        f.repository, f.memberships, x => x);
      await expect(fresh.authenticate(token)).rejects.toBeInstanceOf(AuthenticationError);
      expect(() => createVerifiedActorResolver({ issuer: f.config.issuer, audience: f.config.audience, algorithms: ['EdDSA'],
        keySource: { jwksUri: keySource.jwksUri } }, f.repository, f.memberships, x => x)).toThrow('HTTPS');
    } finally { await server.stop(true); }
  });

  test('concurrent issuer startup publishes one durable signing key', async () => {
    const f = await fixture();
    const config = { ...f.config, stateDirectory: join(f.root, 'concurrent') };
    const [a, b] = await Promise.all([createLocalIssuer(config, f.persistence), createLocalIssuer(config, f.persistence)]);
    expect(a.jwks()).toEqual(b.jwks());
    const issued = await a.authenticate(required(f.users[1]).login, required(f.users[1]).password);
    expect((await f.resolver(b.jwks()).authenticate(issued.token)).actor.principalId).toBe(required(f.users[1]).principal);
  });

  test('private key permissions and implicit or checkout-local issuer configuration fail closed', async () => {
    const f = await fixture();
    await expect(createLocalIssuer({ ...f.config, mode: 'automatic' as 'local-bootstrap' }, f.persistence)).rejects.toThrow();
    await expect(createLocalIssuer({ ...f.config, stateDirectory: join(process.cwd(), '.auth-private') }, f.persistence)).rejects.toThrow();
    const checkout = join(f.root, 'temporary-checkout');
    const inside = join(checkout, 'hidden-state');
    await mkdir(inside, { recursive: true, mode: 0o700 });
    const alias = join(f.root, 'state-alias');
    await symlink(inside, alias);
    await expect(createLocalIssuer({ ...f.config, checkoutDirectory: checkout, stateDirectory: alias }, f.persistence)).rejects.toThrow();
    await chmod(join(f.config.stateDirectory, 'issuer-ed25519.private.jwk'), 0o644);
    await expect(createLocalIssuer(f.config, f.persistence)).rejects.toThrow('0600');
    expect(() => createVerifiedActorResolver({ issuer: f.config.issuer, audience: f.config.audience, algorithms: ['HS256' as 'EdDSA'], keySource: { jwks: f.localIssuer.jwks() } }, {} as VerifiedIdentityRepository, { listActiveWorkspaceIds: async () => [] }, x => x)).toThrow('asymmetric');
  });
});
