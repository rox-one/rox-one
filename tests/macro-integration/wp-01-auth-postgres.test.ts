import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { decodeJwt, importJWK, SignJWT, generateKeyPair } from 'jose'
import { applyWorkspaceMigrations, migrationFromSource } from '../../apps/workspace-service/src/database/migrations'
import { PostgresIdentityAuth, loadProtectedWorkspaceDatabaseUrl, lockPostgresActorSession } from '../../apps/workspace-service/src/auth/postgres-identity'
import { createLocalIssuer } from '../../apps/workspace-service/src/auth/local-issuer'
import { AuthenticationError, createVerifiedActorResolver } from '../../apps/workspace-service/src/auth/verified-actor'
import type { AuthenticatedActor } from '../../packages/shared/src/workspace-domain/identity/contracts'

const schema = `wp01_auth_${randomBytes(6).toString('hex')}`
const prefix = `"${schema}".`
let database: SQL
let directory: string
let createdSchema = false
let url: string
const issuer = `urn:rox:postgres-local:${crypto.randomUUID()}`
const audience = `rox-workspace:${crypto.randomUUID()}`
const password = () => `credential-${crypto.randomUUID()}`
const required = <T>(value: T | undefined): T => { if (value === undefined) throw new Error('Missing test fixture'); return value }

beforeAll(async () => {
  url = await loadProtectedWorkspaceDatabaseUrl(process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json'))
  database = new SQL(url)
  directory = await mkdtemp(join(tmpdir(), 'rox-auth-pg-'))
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  createdSchema = true
  const names = ['01-domain-contract.sql', '01-local-auth-bootstrap.sql']
  const migrations = await Promise.all(names.map(async name => migrationFromSource(name, await readFile(join(process.cwd(), 'apps/workspace-service/migrations', name), 'utf8'))))
  expect(await applyWorkspaceMigrations(database, migrations, schema)).toEqual({ applied: names, retained: [] })
  expect(await applyWorkspaceMigrations(database, migrations, schema)).toEqual({ applied: [], retained: names })
})

afterAll(async () => {
  if (database) {
    if (createdSchema) await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
    await database.close()
  }
  if (directory) await rm(directory, { recursive: true, force: true })
})

const adapter = () => new PostgresIdentityAuth(database, issuer, schema)
const localConfig = () => ({ mode: 'local-bootstrap' as const, issuer, audience, stateDirectory: join(directory, 'private'), checkoutDirectory: process.cwd(), tokenLifetimeSeconds: 60 })
const actorFactory = (input: { principalId: string; sessionId: string; deviceId: string; authenticatedWorkspaceIds: readonly string[]; expiresAt: number }): AuthenticatedActor => ({ ...input })

async function account() {
  const login = `account-${crypto.randomUUID()}`
  const credential = password()
  const ports = adapter()
  const identity = await ports.provisionAccount(login, credential)
  const local = await createLocalIssuer(localConfig(), ports)
  const resolver = createVerifiedActorResolver({ issuer, audience, algorithms: ['EdDSA'], keySource: { jwks: local.jwks() } }, ports, ports, actorFactory)
  return { ports, identity, login, credential, local, resolver }
}

async function waitForBlockedQuery(): Promise<void> {
  const until = Date.now() + 3000
  while (Date.now() < until) {
    const rows = await database<{ blocked: number }[]>`SELECT count(*)::integer AS blocked FROM pg_stat_activity
      WHERE cardinality(pg_blocking_pids(pid)) > 0 AND query LIKE ${'%' + prefix + 'bootstrap_auth_%'}`
    if (required(rows[0]).blocked > 0) return
    await Bun.sleep(10)
  }
  throw new Error('Expected scoped authentication lock wait not observed')
}

function barrier() {
  let signal: () => void = () => { throw new Error('Uninitialized barrier') }
  const promise = new Promise<void>(resolve => { signal = resolve })
  return { promise, signal }
}

describe('WP-01 canonical identity backed by actual PostgreSQL', () => {
  test('two real accounts share the domain principal map and enforce membership isolation', async () => {
    const a = await account()
    const b = await account()
    const workspace = crypto.randomUUID()
    await database.begin(async tx => {
      await tx.unsafe(`INSERT INTO ${prefix}workspace (workspace_id,owner_principal_id,name) VALUES ($1,$2,$3)`, [workspace, a.identity.principalId, 'Test-owned workspace'])
      await tx.unsafe(`INSERT INTO ${prefix}workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'owner')`, [workspace, a.identity.principalId])
    })
    const aToken = await a.local.authenticate(a.login, a.credential)
    const bToken = await b.local.authenticate(b.login, b.credential)
    const aBound = await a.resolver.authenticate(aToken.token)
    const bBound = await b.resolver.authenticate(bToken.token)
    expect(aBound.actor.principalId).toBe(a.identity.principalId)
    expect(bBound.actor.principalId).toBe(b.identity.principalId)
    expect(aBound.actor.principalId).not.toBe(bBound.actor.principalId)
    expect(aBound.actor.authenticatedWorkspaceIds).toEqual([workspace])
    expect(bBound.actor.authenticatedWorkspaceIds).toEqual([])
    expect(await a.ports.resolvePrincipal('urn:wrong-issuer', a.identity.subject)).toBeNull()
    expect(await a.ports.resolvePrincipal(issuer, a.login)).toBeNull()
    await database.unsafe(`UPDATE ${prefix}workspace_member SET deleted_at = clock_timestamp() WHERE workspace_id = $1 AND principal_id = $2`, [workspace, a.identity.principalId])
    expect((await a.resolver.revalidate(aBound)).actor.authenticatedWorkspaceIds).toEqual([])
    const credentials = await database.unsafe<{ password_hash: string }[]>(`SELECT password_hash FROM ${prefix}bootstrap_auth_credential WHERE issuer = $1 AND subject = $2`, [issuer, a.identity.subject])
    expect(required(credentials[0]).password_hash.startsWith('$argon2id$')).toBe(true)
    expect(await Bun.password.verify(a.credential, required(credentials[0]).password_hash)).toBe(true)
    await expect(a.local.authenticate(a.login, 'incorrect-password')).rejects.toBeInstanceOf(AuthenticationError)
  })

  test('account provisioning is atomic under duplicate/concurrent login and aliases cannot be rebound', async () => {
    const ports = adapter()
    const login = `duplicate-${crypto.randomUUID()}`
    const credential = password()
    const outcomes = await Promise.allSettled([ports.provisionAccount(login, credential), ports.provisionAccount(login, credential)])
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(value => value.status === 'rejected')).toHaveLength(1)
    const [row] = await database.unsafe<{ subject: string; principal_id: string }[]>(`SELECT subject,principal_id FROM ${prefix}bootstrap_auth_credential WHERE issuer = $1 AND login = $2`, [issuer, login])
    const identity = required(row)
    const other = await account()
    await expect(Promise.resolve(database.unsafe(`UPDATE ${prefix}auth_subject_alias SET principal_id = $1 WHERE issuer = $2 AND subject = $3`, [other.identity.principalId, issuer, identity.subject]))).rejects.toThrow()
    await expect(Promise.resolve(database.unsafe(`DELETE FROM ${prefix}auth_subject_alias WHERE issuer = $1 AND subject = $2`, [issuer, identity.subject]))).rejects.toThrow()
    await expect(Promise.resolve(database.unsafe(`UPDATE ${prefix}bootstrap_auth_credential SET principal_id = $1 WHERE issuer = $2 AND subject = $3`, [other.identity.principalId, issuer, identity.subject]))).rejects.toThrow()
    expect(await ports.resolvePrincipal(issuer, identity.subject)).toBe(identity.principal_id)
  })


  test('real PostgreSQL authority rejects cryptographic forgery and signed authority substitutions', async () => {
    const a = await account()
    const b = await account()
    const issued = await a.local.authenticate(a.login, a.credential)
    const claims = decodeJwt(issued.token)
    const privateKey = await importJWK(JSON.parse(await readFile(join(directory, 'private', 'issuer-ed25519.private.jwk'), 'utf8')), 'EdDSA')
    const jwk = required(a.local.jwks().keys[0])
    const sign = (payload: Record<string, unknown>) => new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid }).sign(privateKey)
    const invalids = await Promise.all([
      sign({ ...claims, iss: 'urn:forged' }), sign({ ...claims, aud: 'forged-audience' }),
      sign({ ...claims, sub: b.identity.subject }), sign({ ...claims, jti: crypto.randomUUID() }),
      sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 1 }),
    ])
    const attacker = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
    invalids.push(await new SignJWT(claims).setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid }).sign(attacker.privateKey))
    for (const token of invalids) await expect(a.resolver.authenticate(token)).rejects.toBeInstanceOf(AuthenticationError)
    const customClaims = await sign({ ...claims, principalId: b.identity.principalId, authenticatedWorkspaceIds: ['forged'], roles: ['admin'] })
    expect((await a.resolver.authenticate(customClaims)).actor.principalId).toBe(a.identity.principalId)
    const bound = await a.resolver.authenticate(issued.token)
    await expect(Promise.resolve(database.unsafe(`UPDATE ${prefix}bootstrap_auth_session SET token_id = $1 WHERE session_id = $2`, [crypto.randomUUID(), bound.actor.sessionId]))).rejects.toThrow()
    await expect(Promise.resolve(database.unsafe(`UPDATE ${prefix}bootstrap_auth_session SET device_id = $1 WHERE session_id = $2`, [crypto.randomUUID(), bound.actor.sessionId]))).rejects.toThrow()
  })

  test('signed sid+jti, principal and persisted expiry are all required', async () => {
    const a = await account()
    const issued = await a.local.authenticate(a.login, a.credential)
    const claims = decodeJwt(issued.token)
    expect(typeof claims.sid).toBe('string')
    expect(typeof claims.jti).toBe('string')
    const input = { issuer, subject: a.identity.subject, principalId: a.identity.principalId,
      verifiedSessionId: claims.sid as string, verifiedTokenId: claims.jti, tokenExpiresAt: issued.expiresAt }
    expect(await a.ports.resolveSession(input)).not.toBeNull()
    expect(await a.ports.resolveSession({ ...input, verifiedTokenId: crypto.randomUUID() })).toBeNull()
    expect(await a.ports.resolveSession({ ...input, verifiedSessionId: crypto.randomUUID() })).toBeNull()
    expect(await a.ports.resolveSession({ ...input, principalId: crypto.randomUUID() })).toBeNull()
    expect(await a.ports.resolveSession({ ...input, verifiedTokenId: undefined })).toBeNull()
    const bound = await a.resolver.authenticate(issued.token)
    await database.unsafe(`UPDATE ${prefix}bootstrap_auth_session SET created_at = clock_timestamp() - interval '1 minute', expires_at = clock_timestamp() - interval '1 second' WHERE session_id = $1`, [bound.actor.sessionId])
    expect(await a.ports.findSession(issuer, bound.actor.sessionId)).toBeNull()
    await expect(a.resolver.authenticate(issued.token)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(a.resolver.revalidate(bound)).rejects.toBeInstanceOf(AuthenticationError)
  })

  test('revocation and disabling are durable and deny previously authenticated sessions', async () => {
    const a = await account()
    const first = await a.local.authenticate(a.login, a.credential)
    const bound = await a.resolver.authenticate(first.token)
    expect(await a.ports.revokeSession(bound.actor.sessionId)).toBe(true)
    await expect(a.resolver.revalidate(bound)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(a.resolver.authenticate(first.token)).rejects.toBeInstanceOf(AuthenticationError)
    const second = await a.local.authenticate(a.login, a.credential)
    const active = await a.resolver.authenticate(second.token)
    await a.ports.disableAccount(a.identity.subject)
    expect(await a.ports.resolvePrincipal(issuer, a.identity.subject)).toBeNull()
    await expect(a.resolver.revalidate(active)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(a.local.authenticate(a.login, a.credential)).rejects.toBeInstanceOf(AuthenticationError)
    const sessions = await database.unsafe<{ live: number }[]>(`SELECT count(*) FILTER (WHERE revoked_at IS NULL)::integer AS live FROM ${prefix}bootstrap_auth_session WHERE issuer = $1 AND subject = $2`, [issuer, a.identity.subject])
    expect(required(sessions[0]).live).toBe(0)
  })

  test('issuance waiting on the credential lock rechecks disabled state before inserting', async () => {
    const a = await account()
    const held = barrier()
    const release = barrier()
    const disable = database.begin(async tx => {
      await tx.unsafe(`SELECT subject FROM ${prefix}bootstrap_auth_credential WHERE issuer = $1 AND subject = $2 FOR UPDATE`, [issuer, a.identity.subject])
      held.signal()
      await release.promise
      await tx.unsafe(`UPDATE ${prefix}bootstrap_auth_credential SET disabled_at = clock_timestamp() WHERE issuer = $1 AND subject = $2`, [issuer, a.identity.subject])
    })
    await held.promise
    const session = { issuer, subject: a.identity.subject, sessionId: crypto.randomUUID(), tokenId: crypto.randomUUID(), deviceId: crypto.randomUUID(), expiresAt: Date.now() + 60000 }
    const issuance = a.ports.createSession(session)
    try { await waitForBlockedQuery() } finally { release.signal() }
    await disable
    expect(await issuance).toBe(false)
    const inserted = await database.unsafe<{ count: number }[]>(`SELECT count(*)::integer AS count FROM ${prefix}bootstrap_auth_session WHERE session_id = $1`, [session.sessionId])
    expect(required(inserted[0]).count).toBe(0)
  })

  test('revoke during live membership lookup is observed by the actual resolver', async () => {
    const a = await account()
    const issued = await a.local.authenticate(a.login, a.credential)
    const sid = decodeJwt(issued.token).sid
    if (typeof sid !== 'string') throw new Error('Missing issued session')
    const resolver = createVerifiedActorResolver({ issuer, audience, algorithms: ['EdDSA'], keySource: { jwks: a.local.jwks() } }, a.ports, {
      async listActiveWorkspaceIds(principalId) {
        const workspaces = await a.ports.listActiveWorkspaceIds(principalId)
        await a.ports.revokeSession(sid)
        return workspaces
      },
    }, actorFactory)
    await expect(resolver.authenticate(issued.token)).rejects.toBeInstanceOf(AuthenticationError)
  })

  test('transaction session gate serializes revoke and rejects post-revoke operations', async () => {
    const a = await account()
    const issued = await a.local.authenticate(a.login, a.credential)
    const bound = await a.resolver.authenticate(issued.token)
    const held = barrier()
    const release = barrier()
    const operation = database.begin(async tx => {
      await lockPostgresActorSession(tx, schema, bound.actor)
      held.signal()
      await release.promise
    })
    await held.promise
    const revoke = a.ports.revokeSession(bound.actor.sessionId)
    try { await waitForBlockedQuery() } finally { release.signal() }
    await operation
    expect(await revoke).toBe(true)
    await expect(database.begin(tx => lockPostgresActorSession(tx, schema, bound.actor))).rejects.toBeInstanceOf(AuthenticationError)
    await expect(database.begin(tx => lockPostgresActorSession(tx, schema, { ...bound.actor, deviceId: crypto.randomUUID() }))).rejects.toBeInstanceOf(AuthenticationError)
  })

  test('recreated SQL pool and durable issuer key preserve principal/session binding', async () => {
    const a = await account()
    const issued = await a.local.authenticate(a.login, a.credential)
    const original = await a.resolver.authenticate(issued.token)
    const restartedDatabase = new SQL(url)
    try {
      const ports = new PostgresIdentityAuth(restartedDatabase, issuer, schema)
      const local = await createLocalIssuer(localConfig(), ports)
      expect(local.jwks()).toEqual(a.local.jwks())
      const resolver = createVerifiedActorResolver({ issuer, audience, algorithms: ['EdDSA'], keySource: { jwks: local.jwks() } }, ports, ports, actorFactory)
      const recovered = await resolver.authenticate(issued.token)
      expect(recovered.actor).toEqual(original.actor)
      const renewed = await local.authenticate(a.login, a.credential)
      expect((await resolver.authenticate(renewed.token)).actor.principalId).toBe(a.identity.principalId)
    } finally { await restartedDatabase.close() }
  })

  test('secret loader refuses unsafe permissions and redacts malformed content', async () => {
    const file = join(directory, 'bad-environment.json')
    await writeFile(file, '{"ROX_WORKSPACE_DATABASE_URL":"private-invalid-config"}', { mode: 0o600 })
    await expect(loadProtectedWorkspaceDatabaseUrl(file)).rejects.toThrow('Protected workspace PostgreSQL configuration unavailable')
    await chmod(file, 0o644)
    await expect(loadProtectedWorkspaceDatabaseUrl(file)).rejects.toThrow('Protected workspace PostgreSQL configuration unavailable')
  })
})
