import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PostgresIdentityAuth, loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity.ts'
import { createLocalIssuer } from '../../apps/workspace-service/src/auth/local-issuer.ts'
import { createVerifiedActorResolver } from '../../apps/workspace-service/src/auth/verified-actor.ts'
import { IdentityCommands } from '../../apps/workspace-service/src/modules/identity/commands.ts'
import { IdentityRepository } from '../../apps/workspace-service/src/modules/identity/repository.ts'
import { IdentityDomainError, type AuthenticatedActor, type IdentityErrorCode, type SharedProjectResult } from '../../packages/shared/src/workspace-domain/identity/contracts.ts'

const environmentPath = process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json')
const schema = `wp01_${randomUUID().replaceAll('-', '')}`
let database: SQL
let repository: IdentityRepository
let commands: IdentityCommands
let provisioned = false
let stateDirectory: string | undefined

function requiredFixtureValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing domain fixture')
  return value
}

/** The sole credential loader. Values are never printed, persisted in evidence or embedded in source. */
async function connectProvisionedTestDatabase(): Promise<SQL> {
  const url = await loadProtectedWorkspaceDatabaseUrl(environmentPath)
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.pathname.length <= 1) {
    throw new Error('WP-01 test connection must target a protected loopback database')
  }
  return new SQL(url, { max: 8 })
}

beforeAll(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), 'rox-wp01-domain-'))
  database = await connectProvisionedTestDatabase()
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  provisioned = true
  // Record the isolated test namespace so interrupted runs can be cleaned without guessing ownership.
  console.info('WP-01 owned test schema:', schema)
  await database.unsafe(`COMMENT ON SCHEMA "${schema}" IS 'WP-01 behavioral test namespace; never production'`)
  await database.begin(async tx => {
    await tx.unsafe(`SET LOCAL search_path TO "${schema}"`)
    await tx.unsafe(readFileSync(new URL('../../apps/workspace-service/migrations/01-domain-contract.sql', import.meta.url), 'utf8'))
    await tx.unsafe(readFileSync(new URL('../../apps/workspace-service/migrations/01-local-auth-bootstrap.sql', import.meta.url), 'utf8'))
  })
  repository = new IdentityRepository(database, schema)
  commands = new IdentityCommands(repository)
}, 10000)

afterAll(async () => {
  if (database) {
    try { if (provisioned) await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`) }
    finally { await database.close() }
  }
  if (stateDirectory) await rm(stateDirectory, { recursive: true, force: true })
})

async function fixture() {
  const issuer = `wp01:${randomUUID()}`
  const identity = new PostgresIdentityAuth(database, issuer, schema)
  const password = 'synthetic-domain-' + randomUUID()
  const audience = 'rox-wp01-domain-test'
  const localIssuer = await createLocalIssuer({ mode: 'local-bootstrap', issuer, audience,
    stateDirectory: join(requiredFixtureValue(stateDirectory), randomUUID()), checkoutDirectory: process.cwd(), tokenLifetimeSeconds: 300 }, identity)
  const resolver = createVerifiedActorResolver<AuthenticatedActor>({ issuer, audience, algorithms: ['EdDSA'],
    keySource: { jwks: localIssuer.jwks() } }, identity, identity, verified => Object.freeze({
      principalId: verified.principalId, sessionId: verified.sessionId, deviceId: verified.deviceId,
      expiresAt: verified.expiresAt, authenticatedWorkspaceIds: verified.authenticatedWorkspaceIds,
    }))
  const account = async (label: string) => {
    const login = label + '-' + randomUUID() + '@example.invalid'
    return { login, ...await identity.provisionAccount(login, password) }
  }
  const ownerAccount = await account('owner'), memberAccount = await account('member'), outsiderAccount = await account('outsider')
  const workspaceId = randomUUID()
  const ownerId = ownerAccount.principalId, memberId = memberAccount.principalId, outsiderId = outsiderAccount.principalId
  await repository.provisionWorkspace(ownerId, workspaceId, 'WP-01 workspace')
  await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceId, memberId])
  const issue = async (login: string) => (await resolver.authenticate((await localIssuer.authenticate(login, password)).token)).actor
  return { workspaceId, ownerId, memberId, outsiderId, issuer, identity, ownerSubject: ownerAccount.subject,
    owner: await issue(ownerAccount.login), member: await issue(memberAccount.login), outsider: await issue(outsiderAccount.login),
    issueOwnerActor: () => issue(ownerAccount.login) }
}

function createBody(workspaceId: string, visibility: 'private' | 'members' = 'private', name = 'PRIVATE_WP-01') {
  return { commandId: randomUUID(), schemaVersion: 2 as const, workspaceId, idempotencyKey: randomUUID(),
    payload: { name, workspaceName: 'WP-01 workspace', visibility } }
}

async function denied(action: Promise<unknown>, code: IdentityErrorCode, statusCode?: number) {
  try { await action } catch (error) {
    expect(error).toBeInstanceOf(IdentityDomainError)
    expect((error as IdentityDomainError).code).toBe(code)
    if (statusCode) expect((error as IdentityDomainError).statusCode).toBe(statusCode)
    expect(JSON.stringify(error)).not.toContain('PRIVATE_WP-01')
    expect((error as Error).message).toBe(code)
    return
  }
  throw new Error(`Expected denied ${code}`)
}

async function rejectsUniqueConstraint(statement: string, parameters: unknown[]) {
  // Await Bun's lazy Query directly; passing it to rejects can leave it unexecuted.
  try { await database.unsafe(statement, parameters) } catch (error) {
    expect(error).toBeInstanceOf(SQL.PostgresError)
    expect((error as SQL.PostgresError).errno).toBe('23505')
    return
  }
  throw new Error('Expected database uniqueness rejection')
}

/** Acceptance oracle detects missing/duplicated durable events, not just a successful method return. */
async function assertAtomicCreate(result: SharedProjectResult) {
  const [counts] = await database.unsafe(`SELECT
    (SELECT count(*)::int FROM "${schema}".project WHERE workspace_id=$1 AND project_id=$2) AS projects,
    (SELECT count(*)::int FROM "${schema}".project_create_receipt WHERE receipt_id=$3) AS receipts,
    (SELECT count(*)::int FROM "${schema}".project_event WHERE workspace_id=$1 AND project_id=$2 AND type='project.created') AS events`,
  [result.entity.workspaceId, result.entity.entityId.slice('project:'.length), result.receiptId])
  expect(counts).toEqual({ projects: 1, receipts: 1, events: 1 })
}

describe('WP-01 real PostgreSQL private Project bootstrap', () => {
  test('owner creates and reads stable canonical identity, receipt and reference-only durable events', async () => {
    const f = await fixture()
    const result = await commands.createSharedProject(f.owner, f.workspaceId, createBody(f.workspaceId))
    expect(result).toMatchObject({ status: 'applied', executionMode: 'live', lifecycle: 'succeeded', verification: 'receipt_verified',
      observedRevision: '1', data: { name: 'PRIVATE_WP-01', ownerPrincipalId: f.ownerId, visibility: 'private', policyEpoch: '1' } })
    expect(result.entity.entityId).toMatch(/^project:[0-9a-f-]{36}$/)
    expect(await commands.getProject(f.owner, f.workspaceId, { entityId: result.entity.entityId })).toEqual(result.data)
    await assertAtomicCreate(result)
    const replay = await commands.replayEvents(f.owner, f.workspaceId, {})
    expect(replay.events.map(e => e.type)).toEqual(['workspace.member_joined', 'project.created'])
    expect(replay.events[1]).toMatchObject({ entityRef: result.entity, causationId: result.commandId, correlationId: result.commandId, aggregateRevision: '1' })
    expect(requiredFixtureValue(replay.events[1]).payload).toEqual({ entityId: result.entity.entityId })
    expect(JSON.stringify(replay)).not.toContain('PRIVATE_WP-01')
  })

  test('outsider and private-project member receive 403 without title, even with forged cached workspace scope', async () => {
    const f = await fixture()
    const created = await commands.createSharedProject(f.owner, f.workspaceId, createBody(f.workspaceId))
    await denied(commands.getProject(f.outsider, f.workspaceId, { entityId: created.entity.entityId }), 'FORBIDDEN', 403)
    const forgedScope: AuthenticatedActor = { ...f.outsider, authenticatedWorkspaceIds: [f.workspaceId] }
    await denied(commands.getProject(forgedScope, f.workspaceId, { entityId: created.entity.entityId }), 'FORBIDDEN', 403)
    await denied(commands.createSharedProject(forgedScope, f.workspaceId, createBody(f.workspaceId)), 'FORBIDDEN', 403)
    await denied(commands.getProject(f.member, f.workspaceId, { entityId: created.entity.entityId }), 'FORBIDDEN', 403)
    expect(await commands.listProjects(f.member, f.workspaceId, {})).toEqual({ items: [] })
    const events = await commands.replayEvents(f.member, f.workspaceId, {})
    expect(events.events.map(e => e.type)).toEqual(['workspace.member_joined'])
    expect(JSON.stringify(events)).not.toContain(created.entity.entityId)
  })

  test('members visibility permits read but never grants create; authorized pagination excludes private rows and totals', async () => {
    const f = await fixture()
    await commands.createSharedProject(f.owner, f.workspaceId, createBody(f.workspaceId))
    const first = await commands.createSharedProject(f.owner, f.workspaceId, createBody(f.workspaceId, 'members', 'Visible one'))
    const second = await commands.createSharedProject(f.owner, f.workspaceId, createBody(f.workspaceId, 'members', 'Visible two'))
    expect(await commands.getProject(f.member, f.workspaceId, { entityId: first.entity.entityId })).toEqual(first.data)
    await denied(commands.createSharedProject(f.member, f.workspaceId, createBody(f.workspaceId, 'members')), 'FORBIDDEN', 403)
    const page = await commands.listProjects(f.member, f.workspaceId, { limit: 1 })
    expect(page.items.map(p => p.entity.entityId)).toEqual([first.entity.entityId])
    expect(page.nextCursor).toMatch(/^[0-9a-f-]{36}$/)
    const next = await commands.listProjects(f.member, f.workspaceId, { limit: 1, cursor: page.nextCursor })
    expect(next.items.map(p => p.entity.entityId)).toEqual([second.entity.entityId])
    expect(next.nextCursor).toBeUndefined()
    expect(JSON.stringify([page, next])).not.toContain('PRIVATE_WP-01')
    await denied(commands.listProjects(f.owner, f.workspaceId, { cursor: page.nextCursor }), 'CURSOR_INVALID')
    await denied(commands.replayEvents(f.member, f.workspaceId, { cursor: page.nextCursor }), 'CURSOR_INVALID')
  })

  test('transport gateway rejects forged principal, actor, workspace, execution grants and unsupported schema', async () => {
    const f = await fixture(), body = createBody(f.workspaceId)
    for (const extra of [{ actor: f.owner }, { principalId: f.ownerId }, { permissionMode: 'allow-all' }]) {
      await denied(commands.createSharedProject(f.owner, f.workspaceId, { ...body, ...extra }), 'INVALID_PAYLOAD')
      await denied(commands.createSharedProject(f.owner, f.workspaceId, { ...body, payload: { ...body.payload, ...extra } }), 'INVALID_PAYLOAD')
    }
    await denied(commands.getProject(f.owner, f.workspaceId, { entityId: `project:${randomUUID()}`, actor: f.owner }), 'INVALID_PAYLOAD')
    await denied(commands.listProjects(f.owner, f.workspaceId, { workspaceId: randomUUID() }), 'INVALID_PAYLOAD')
    await denied(commands.createSharedProject(f.owner, f.workspaceId, { ...body, workspaceId: randomUUID() }), 'WORKSPACE_MISMATCH', 403)
    await denied(commands.createSharedProject(f.owner, f.workspaceId, { ...body, schemaVersion: 1 }), 'SCHEMA_VERSION_UNSUPPORTED')
    await denied(commands.createSharedProject(null, f.workspaceId, body), 'UNAUTHENTICATED', 401)
    await denied(commands.createSharedProject({ ...f.owner, expiresAt: Date.now() - 1 }, f.workspaceId, body), 'UNAUTHENTICATED', 401)
  })

  test('strict name, envelope, visibility, revision and pagination bounds reject before persistence', async () => {
    const f = await fixture(), body = createBody(f.workspaceId)
    for (const name of ['', ' ', 'x'.repeat(10001), 42]) {
      await denied(commands.createSharedProject(f.owner, f.workspaceId, { ...body, payload: { ...body.payload, name } }), 'INVALID_PAYLOAD')
    }
    for (const patch of [{ visibility: 'public' }, { workspaceName: 'different' }, { name: undefined }]) {
      await denied(commands.createSharedProject(f.owner, f.workspaceId, { ...body, payload: { ...body.payload, ...patch } }), 'INVALID_PAYLOAD')
    }
    await denied(commands.createSharedProject(f.owner, f.workspaceId, { ...body, expectedRevision: '1' }), 'REVISION_CONFLICT')
    await denied(commands.createSharedProject(f.owner, f.workspaceId, { ...body, idempotencyKey: '' }), 'INVALID_PAYLOAD')
    for (const limit of [0, -1, 101, 1.5, '1']) await denied(commands.listProjects(f.owner, f.workspaceId, { limit }), 'INVALID_PAYLOAD')
    const result = await commands.createSharedProject(f.owner, f.workspaceId, { ...body, expectedRevision: '0' })
    await assertAtomicCreate(result)
  })

  test('six concurrent retries commit one project, one event and one original receipt; changed payload conflicts', async () => {
    const f = await fixture(), body = createBody(f.workspaceId)
    const results = await Promise.all(Array.from({ length: 6 }, () => commands.createSharedProject(f.owner, f.workspaceId, body)))
    for (const result of results) expect(result).toEqual(requiredFixtureValue(results[0]))
    await assertAtomicCreate(requiredFixtureValue(results[0]))
    await denied(commands.createSharedProject(f.owner, f.workspaceId,
      { ...body, payload: { ...body.payload, name: 'Changed content' } }), 'IDEMPOTENCY_CONFLICT', 409)
    await denied(commands.createSharedProject(f.owner, f.workspaceId,
      { ...body, idempotencyKey: randomUUID() }), 'IDEMPOTENCY_CONFLICT', 409)
    expect(await commands.createSharedProject(f.owner, f.workspaceId, { ...body, commandId: randomUUID() })).toEqual(requiredFixtureValue(results[0]))
  })

  test('new authority connection recovers committed command after simulated lost reply with original ID and receipt', async () => {
    const f = await fixture(), body = createBody(f.workspaceId)
    const committed = await commands.createSharedProject(f.owner, f.workspaceId, body)
    const recoveredDatabase = await connectProvisionedTestDatabase()
    try {
      const recovered = new IdentityCommands(new IdentityRepository(recoveredDatabase, schema))
      const retried = await recovered.createSharedProject(f.owner, f.workspaceId, body)
      expect(retried).toEqual(committed)
      expect(await recovered.getProject(f.owner, f.workspaceId, { entityId: committed.entity.entityId })).toEqual(committed.data)
      await assertAtomicCreate(retried)
    } finally { await recoveredDatabase.close() }
  })

  test('forced outbox insertion failure rolls back project and receipt, then retry succeeds', async () => {
    const f = await fixture(), body = createBody(f.workspaceId)
    const triggerName = `fail_${randomUUID().replaceAll('-', '')}`
    await database.unsafe(`CREATE FUNCTION "${schema}"."${triggerName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.workspace_id = '${f.workspaceId}'::uuid AND NEW.type = 'project.created' THEN
        RAISE EXCEPTION 'WP-01 injected precommit event failure'; END IF; RETURN NEW; END $$`)
    await database.unsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "${schema}".project_event
      FOR EACH ROW EXECUTE FUNCTION "${schema}"."${triggerName}"()`)
    try {
      await expect(commands.createSharedProject(f.owner, f.workspaceId, body)).rejects.toThrow('WP-01 injected precommit event failure')
      const [count] = await database.unsafe(`SELECT
        (SELECT count(*)::int FROM "${schema}".project WHERE workspace_id=$1) AS projects,
        (SELECT count(*)::int FROM "${schema}".project_create_receipt WHERE workspace_id=$1) AS receipts`, [f.workspaceId])
      expect(count).toEqual({ projects: 0, receipts: 0 })
    } finally {
      await database.unsafe(`DROP TRIGGER "${triggerName}" ON "${schema}".project_event`)
      await database.unsafe(`DROP FUNCTION "${schema}"."${triggerName}"()`)
    }
    await assertAtomicCreate(await commands.createSharedProject(f.owner, f.workspaceId, body))
  })

  test('revoked membership invalidates cached actor and receipt; stale policy cursor cannot continue', async () => {
    const f = await fixture(), body = createBody(f.workspaceId)
    const privateResult = await commands.createSharedProject(f.owner, f.workspaceId, body)
    await commands.createSharedProject(f.owner, f.workspaceId, createBody(f.workspaceId, 'members', 'Shared one'))
    await commands.createSharedProject(f.owner, f.workspaceId, createBody(f.workspaceId, 'members', 'Shared two'))
    const page = await commands.listProjects(f.member, f.workspaceId, { limit: 1 })
    await database.unsafe(`UPDATE "${schema}".workspace SET policy_epoch=policy_epoch+1 WHERE workspace_id=$1`, [f.workspaceId])
    await denied(commands.listProjects(f.member, f.workspaceId, { cursor: page.nextCursor }), 'CURSOR_INVALID')
    await database.unsafe(`UPDATE "${schema}".workspace_member SET deleted_at=clock_timestamp() WHERE workspace_id=$1 AND principal_id=$2`, [f.workspaceId, f.ownerId])
    await denied(commands.getProject(f.owner, f.workspaceId, { entityId: privateResult.entity.entityId }), 'FORBIDDEN', 403)
    await denied(commands.createSharedProject(f.owner, f.workspaceId, body), 'FORBIDDEN', 403)
    await denied(commands.replayEvents(f.owner, f.workspaceId, {}), 'FORBIDDEN', 403)
  })

  test('issuer and subject, not email/display identity, bind principals; disabled and unknown identities fail', async () => {
    const f = await fixture()
    expect(await f.identity.resolvePrincipal('untrusted-other-issuer', f.ownerSubject)).toBeNull()
    expect(await f.identity.resolvePrincipal(f.issuer, 'owner@example.invalid')).toBeNull()
    expect(await f.identity.resolvePrincipal(f.issuer, f.ownerSubject)).toBe(f.ownerId)
    const anotherDevice = await f.issueOwnerActor()
    expect(anotherDevice.principalId).toBe(f.ownerId)
    expect(anotherDevice.deviceId).not.toBe(f.owner.deviceId)
    await database.unsafe(`UPDATE "${schema}".principal SET deleted_at=clock_timestamp() WHERE principal_id=$1`, [f.ownerId])
    expect(await f.identity.resolvePrincipal(f.issuer, f.ownerSubject)).toBeNull()
    await denied(commands.listProjects(f.owner, f.workspaceId, {}), 'UNAUTHENTICATED', 401)
  })

  test('DB-only consumer commits effect/inbox/watermark together and concurrent deliveries cannot duplicate effects', async () => {
    const f = await fixture()
    await commands.createSharedProject(f.owner, f.workspaceId, createBody(f.workspaceId))
    const consumerId = `wp01-consumer:${randomUUID()}`
    const effectTable = `effect_${randomUUID().replaceAll('-', '')}`
    await database.unsafe(`CREATE TABLE "${schema}"."${effectTable}" (event_id uuid PRIMARY KEY)`)
    let firstId: string | undefined
    await expect(repository.consumeNextEvent(consumerId, async (tx, event) => {
      firstId = event.id
      await tx.unsafe(`INSERT INTO "${schema}"."${effectTable}" (event_id) VALUES ($1)`, [event.id])
      throw new Error('WP-01 injected consumer crash')
    })).rejects.toThrow('WP-01 injected consumer crash')
    const [before] = await database.unsafe(`SELECT
      (SELECT count(*)::int FROM "${schema}"."${effectTable}") AS effects,
      (SELECT count(*)::int FROM "${schema}".project_event_inbox WHERE consumer_id=$1) AS receipts,
      (SELECT count(*)::int FROM "${schema}".project_projection_watermark WHERE consumer_id=$1) AS watermarks`, [consumerId])
    expect(before).toEqual({ effects: 0, receipts: 0, watermarks: 0 })
    const recoveredRepository = new IdentityRepository(database, schema)
    await recoveredRepository.consumeNextEvent(consumerId, async (tx, event) => {
      expect(event.id).toBe(requiredFixtureValue(firstId))
      await tx.unsafe(`INSERT INTO "${schema}"."${effectTable}" (event_id) VALUES ($1)`, [event.id])
    })
    const effect = async (tx: Parameters<Parameters<IdentityRepository['consumeNextEvent']>[1]>[0], event: Parameters<Parameters<IdentityRepository['consumeNextEvent']>[1]>[1]) => {
      await tx.unsafe(`INSERT INTO "${schema}"."${effectTable}" (event_id) VALUES ($1)`, [event.id])
    }
    while ((await Promise.all([repository.consumeNextEvent(consumerId, effect), recoveredRepository.consumeNextEvent(consumerId, effect)])).some(Boolean)) {}
    const [counts] = await database.unsafe(`SELECT
      (SELECT count(*)::int FROM "${schema}".project_event) AS expected,
      (SELECT count(*)::int FROM "${schema}"."${effectTable}") AS effects,
      (SELECT count(*)::int FROM "${schema}".project_event_inbox WHERE consumer_id=$1) AS receipts`, [consumerId])
    expect(counts.effects).toBe(counts.expected)
    expect(counts.receipts).toBe(counts.expected)
    const mismatches = await database.unsafe(`SELECT w.workspace_id FROM "${schema}".project_projection_watermark w
      WHERE w.consumer_id=$1 AND w.sequence != (SELECT max(e.sequence) FROM "${schema}".project_event e WHERE e.workspace_id=w.workspace_id)`, [consumerId])
    expect(mismatches).toEqual([])
  })

  test('seeded body-actor bypass is detected by the same denied acceptance assertion', async () => {
    const f = await fixture(), body = createBody(f.workspaceId)
    const forged = { ...body, actor: f.owner }
    await denied(commands.createSharedProject(f.outsider, f.workspaceId, forged), 'FORBIDDEN', 403)
    // Deliberately broken boundary, isolated in this test: trust the body rather than transport.
    const brokenBoundary = commands.createSharedProject(forged.actor, f.workspaceId, body)
    await expect(denied(brokenBoundary, 'FORBIDDEN', 403)).rejects.toThrow('Expected denied FORBIDDEN')
  })

  test('database rejects duplicate membership and duplicate event for the same command', async () => {
    const f = await fixture()
    const result = await commands.createSharedProject(f.owner, f.workspaceId, createBody(f.workspaceId))
    await rejectsUniqueConstraint(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role)
      VALUES ($1,$2,'owner')`, [f.workspaceId, f.ownerId])
    await rejectsUniqueConstraint(`INSERT INTO "${schema}".project_event
      (event_id,workspace_id,project_id,actor_principal_id,type,aggregate_revision,policy_epoch,causation_id,correlation_id,payload)
      SELECT $1,workspace_id,project_id,actor_principal_id,type,aggregate_revision,policy_epoch,causation_id,correlation_id,payload
      FROM "${schema}".project_event WHERE workspace_id=$2 AND project_id=$3`,
    [randomUUID(), f.workspaceId, result.entity.entityId.slice('project:'.length)])
    await assertAtomicCreate(result)
  })

  test('seeded dropped-event negative control trips the atomic acceptance oracle', async () => {
    const f = await fixture()
    const result = await commands.createSharedProject(f.owner, f.workspaceId, createBody(f.workspaceId))
    await assertAtomicCreate(result)
    await database.unsafe(`DELETE FROM "${schema}".project_event WHERE workspace_id=$1 AND project_id=$2`,
      [f.workspaceId, result.entity.entityId.slice('project:'.length)])
    await expect(assertAtomicCreate(result)).rejects.toThrow()
    // The deliberately damaged fixture is isolated and removed with this test-owned schema.
  })
})
