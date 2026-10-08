/**
 * W1-03 (#1500) — composed workspace service + PostgreSQL: `system.ping`
 * round-trip (HTTP receipt + domain_event row + WS push), idempotency,
 * negatives, topic ACL, seq gap recovery / server cursors, revoked sessions.
 *
 * Needs a protected PG config (`ROX_WORKSPACE_TEST_CONFIG`, file 0600 with
 * `{ "ROX_WORKSPACE_DATABASE_URL": ... }`, same as tests/macro-integration
 * wp-01-*); skipped when it is absent. Each test uses its own schema.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { existsSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { decodeJwt } from 'jose'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client.ts'
import { PLACEHOLDER_PAYLOAD_SCHEMA } from '../../../packages/core/src/commands/index.ts'
import { REALTIME_RPC, type RealtimeEventFrame, type RealtimeSubscribeResult } from '../../../packages/core/src/events/index.ts'
import { createCommandRegistry } from '../../../packages/server-core/src/commands/registry.ts'
import { RealtimeSubscriber, wsRpcRealtimeConnection } from '../../../packages/server-core/src/workspace-sync/realtime.ts'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../src/server.ts'
import { migrationFromSource } from '../src/database/migrations.ts'
import { loadProtectedWorkspaceDatabaseUrl } from '../src/auth/postgres-identity.ts'

const configPath = process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json')
const hasDatabase = existsSync(configPath)

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function registry() {
  const r = createCommandRegistry()
  r.define({ type: 'test.unbound', module: 'test', authority: 'workspace', verb: 'write', schema: PLACEHOLDER_PAYLOAD_SCHEMA, schemaBound: false })
  r.define({ type: 'test.bump', module: 'test', authority: 'workspace', verb: 'write', schema: PLACEHOLDER_PAYLOAD_SCHEMA, schemaBound: false })
  r.bind('test.bump', async ctx => {
    // Revision lives in the same transaction as the receipt (ctx.transaction is the PG tx).
    const { sql, prefix } = ctx.transaction as { sql: SQL; prefix: string }
    const [row] = await sql.unsafe<{ n: string }[]>(`SELECT count(*)::text AS n FROM ${prefix}domain_event WHERE workspace_id = $1 AND type = 'task.task_status_change'`, [ctx.workspaceId])
    const current = Number(row?.n ?? 0)
    if (ctx.envelope.expectedRevision !== undefined && ctx.envelope.expectedRevision !== current) ctx.conflict(current)
    return { ref: { kind: 'task', id: 'bump' }, revision: current + 1, events: [{ type: 'task.task_status_change' }] }
  })
  return r
}

async function fixture() {
  const url = await loadProtectedWorkspaceDatabaseUrl(configPath)
  const database = new SQL(url, { max: 12 })
  const schema = 'w103_bus_' + randomBytes(6).toString('hex')
  const directory = await mkdtemp(join(tmpdir(), 'rox-w103-bus-'))
  const issuer = 'urn:rox:w103-bus:' + randomUUID()
  const password = 'synthetic-w103-' + randomUUID()
  const workspaceId = randomUUID()
  const clients: WsRpcClient[] = []
  const errors: unknown[] = []
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  const bootstrap = await loadWorkspaceBootstrapMigrations(resolve(import.meta.dir, '../migrations'))
  const eventsFixture = migrationFromSource('05-events-test-fixture.sql', await readFile(resolve(import.meta.dir, 'fixtures/events-ddl.sql'), 'utf8'))
  const service = await createWorkspaceServer({
    database, schema, migrations: [...bootstrap, eventsFixture], host: '127.0.0.1', port: 0, serverId: 'w103-' + schema,
    authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience: 'rox-w103-test',
      stateDirectory: directory, checkoutDirectory: process.cwd(), tokenLifetimeSeconds: 300 } },
    commandBus: { registry: registry(), onError: error => errors.push(error) },
  })
  await service.server.listen()
  cleanups.push(async () => {
    for (const client of clients.splice(0)) client.destroy()
    service.server.close()
    try { await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`) }
    finally { await database.close(); await rm(directory, { recursive: true, force: true }) }
  })
  const account = async (label: string) => {
    const login = `${label}-${randomUUID()}@example.invalid`
    return { login, ...await service.identity.provisionAccount(login, password) }
  }
  const owner = await account('owner')
  const member = await account('member')
  const outsider = await account('outsider')
  await service.repository.provisionWorkspace(owner.principalId, workspaceId, 'W1-03 bus workspace')
  await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceId, member.principalId])
  const base = `http://127.0.0.1:${service.server.port}`
  async function http(path: string, token?: string, body?: unknown) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    })
    return { status: response.status, body: JSON.parse(await response.text()) as Record<string, any> }
  }
  async function token(login: string): Promise<string> {
    const response = await http('/v1/auth/local/token', undefined, { login, password })
    expect(response.status).toBe(200)
    return response.body.token as string
  }
  async function ws(tokenValue: string) {
    const client = new WsRpcClient(`ws://127.0.0.1:${service.server.port}`, { token: tokenValue, workspaceId, mode: 'remote', autoReconnect: false, connectTimeout: 2000, requestTimeout: 5000 })
    clients.push(client)
    const connected = new Promise<void>((resolveConnected, reject) => {
      const off = client.onConnectionStateChanged(state => {
        if (state.status === 'connected') { off(); resolveConnected() }
        else if (state.status === 'failed' || state.status === 'disconnected') { off(); reject(new Error('handshake denied')) }
      })
    })
    client.connect()
    await connected
    const frames: RealtimeEventFrame[] = []
    client.on(REALTIME_RPC.EVENT, (ws: string, frame: RealtimeEventFrame) => { if (ws === workspaceId) frames.push(frame) })
    return { client, frames }
  }
  const commandsPath = `/v1/workspaces/${workspaceId}/commands`
  const ping = (nonce?: string, extra: Record<string, unknown> = {}) => ({ commandId: randomUUID(), type: 'system.ping', payload: nonce ? { nonce } : {}, issuedAt: new Date().toISOString(), ...extra })
  async function counts() {
    const [row] = await database.unsafe<{ receipts: number; events: number }[]>(`SELECT
      (SELECT count(*)::integer FROM "${schema}".command_receipt WHERE workspace_id=$1) AS receipts,
      (SELECT count(*)::integer FROM "${schema}".domain_event WHERE workspace_id=$1) AS events`, [workspaceId])
    return row!
  }
  async function until(check: () => boolean, ms = 3000) {
    const deadline = Date.now() + ms
    while (!check()) {
      if (Date.now() > deadline) throw new Error('timed out waiting for realtime frame')
      await Bun.sleep(10)
    }
  }
  return { service, database, schema, workspaceId, owner, member, outsider, http, token, ws, commandsPath, ping, counts, until, errors }
}

describe.skipIf(!hasDatabase)('W1-03 command bus on the composed workspace service (PostgreSQL)', () => {
  test('system.ping round-trips: HTTP receipt, domain_event row, WS push to user:{actor}; replay is a duplicate', async () => {
    const f = await fixture()
    const ownerToken = await f.token(f.owner.login)
    const memberToken = await f.token(f.member.login)
    const owner = await f.ws(ownerToken)
    const member = await f.ws(memberToken)
    const subscribed = await owner.client.invoke(REALTIME_RPC.SUBSCRIBE, f.workspaceId, { topics: [{ topic: `user:${f.owner.principalId}` }] }) as RealtimeSubscribeResult
    expect(subscribed.topics[0]).toMatchObject({ status: 'subscribed', seq: 0 })
    const spy = await member.client.invoke(REALTIME_RPC.SUBSCRIBE, f.workspaceId, { topics: [{ topic: `user:${f.owner.principalId}` }, { topic: `user:${f.member.principalId}` }] }) as RealtimeSubscribeResult
    expect(spy.topics.map(t => t.status)).toEqual(['forbidden', 'subscribed'])

    const envelope = f.ping('nonce-1')
    const response = await f.http(f.commandsPath, ownerToken, envelope)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ commandId: envelope.commandId, status: 'applied', result: { pong: true, nonce: 'nonce-1', authority: 'workspace' } })
    const [event] = await f.database.unsafe<Record<string, unknown>[]>(`SELECT event_id::text, type, actor_id::text, causation_id, payload FROM "${f.schema}".domain_event WHERE workspace_id=$1`, [f.workspaceId])
    expect(event).toMatchObject({ event_id: response.body.eventIds[0], type: 'system.pinged', actor_id: f.owner.principalId, causation_id: envelope.commandId })
    await f.until(() => owner.frames.length === 1)
    expect(owner.frames[0]).toMatchObject({ frame: 'event', topic: `user:${f.owner.principalId}`, type: 'system.pinged', seq: 1, eventId: response.body.eventIds[0], payload: { commandId: envelope.commandId, nonce: 'nonce-1' } })
    await Bun.sleep(100)
    expect(member.frames).toEqual([])

    const replay = await f.http(f.commandsPath, ownerToken, envelope)
    expect(replay.body).toMatchObject({ status: 'duplicate', original: { commandId: envelope.commandId, status: 'applied' } })
    const racing = f.ping('race')
    const all = await Promise.all(Array.from({ length: 8 }, () => f.http(f.commandsPath, ownerToken, racing)))
    expect(all.filter(r => r.body.status === 'applied')).toHaveLength(1)
    expect(all.filter(r => r.body.status === 'duplicate')).toHaveLength(7)
    expect(await f.counts()).toEqual({ receipts: 2, events: 2 })
    expect(f.errors).toEqual([])
  }, 30_000)

  test('negatives: VALIDATION, unknown, unbound, conflict, oversized, outsider 403; existing project command still works', async () => {
    const f = await fixture()
    const ownerToken = await f.token(f.owner.login)
    const outsiderToken = await f.token(f.outsider.login)
    const post = (body: unknown, token = ownerToken) => f.http(f.commandsPath, token, body)
    expect((await post({ type: 'system.ping' })).body).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect((await post({ ...f.ping(), type: 'ghost.command' })).body).toMatchObject({ error: { code: 'UNKNOWN_COMMAND' } })
    expect((await post({ ...f.ping(), type: 'test.unbound' })).body).toMatchObject({ error: { code: 'NOT_BOUND' } })
    expect((await post({ ...f.ping(), type: 'test.bump' })).body).toMatchObject({ status: 'applied', revision: 1 })
    expect((await post({ ...f.ping(), type: 'test.bump', expectedRevision: 0 })).body).toEqual(expect.objectContaining({ status: 'conflict', conflict: { currentRevision: 1 } }))
    expect((await post(f.ping('x'.repeat(4096)))).body).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    expect(await post(f.ping(), outsiderToken)).toEqual({ status: 403, body: { error: { code: 'FORBIDDEN' } } })
    expect(await f.counts()).toEqual({ receipts: 1, events: 1 })
    // The legacy command route is untouched by the generic bus.
    const legacy = await f.http(`/v1/workspaces/${f.workspaceId}/commands/project.createShared`, ownerToken, {
      commandId: randomUUID(), schemaVersion: 2, workspaceId: f.workspaceId, idempotencyKey: randomUUID(), expectedRevision: '0',
      payload: { name: 'Legacy', workspaceName: 'W1-03 bus workspace', visibility: 'private' },
    })
    expect(legacy).toMatchObject({ status: 200, body: { status: 'applied', ok: true } })
  }, 30_000)

  test('seq gap recovery over WS: sinceSeq replay, server cursor resume, RealtimeSubscriber', async () => {
    const f = await fixture()
    const ownerToken = await f.token(f.owner.login)
    const topic = `user:${f.owner.principalId}`
    const first = await f.ws(ownerToken)
    await first.client.invoke(REALTIME_RPC.SUBSCRIBE, f.workspaceId, { topics: [{ topic }] })
    await f.http(f.commandsPath, ownerToken, f.ping('1'))
    await f.until(() => first.frames.length === 1)
    const epoch = first.frames[0]!.epoch
    first.client.destroy() // offline: frames 2 and 3 are missed
    await Bun.sleep(100)
    await f.http(f.commandsPath, ownerToken, f.ping('2'))
    await f.http(f.commandsPath, ownerToken, f.ping('3'))

    const second = await f.ws(ownerToken)
    const replay = await second.client.invoke(REALTIME_RPC.SUBSCRIBE, f.workspaceId, { topics: [{ topic, sinceSeq: 1, epoch }] }) as RealtimeSubscribeResult
    expect(replay.topics[0]).toMatchObject({ status: 'subscribed', seq: 3 })
    expect(replay.topics[0]!.frames!.map(fr => [fr.seq, (fr.payload as { nonce: string }).nonce])).toEqual([[2, '2'], [3, '3']])
    const stale = await second.client.invoke(REALTIME_RPC.SUBSCRIBE, f.workspaceId, { topics: [{ topic, sinceSeq: 1, epoch: 'previous-process' }] }) as RealtimeSubscribeResult
    expect(stale.topics[0]!.status).toBe('snapshot_required')

    // Server-side cursor (realtime_cursor): the first client's position was stored on disconnect.
    const third = await f.ws(ownerToken)
    const resumed = await third.client.invoke(REALTIME_RPC.SUBSCRIBE, f.workspaceId, { topics: [{ topic }], resume: true }) as RealtimeSubscribeResult
    expect(resumed.topics[0]!.frames!.map(fr => fr.seq)).toEqual([2, 3])
    const [cursorRows] = await f.database.unsafe<{ n: number }[]>(`SELECT count(*)::integer AS n FROM "${f.schema}".realtime_cursor WHERE principal_id=$1`, [f.owner.principalId])
    expect(cursorRows!.n).toBeGreaterThanOrEqual(1)

    // Client library end to end: live frames apply in order.
    const fourth = await f.ws(ownerToken)
    const seen: number[] = []
    const subscriber = new RealtimeSubscriber({ connection: wsRpcRealtimeConnection(fourth.client, f.workspaceId), onEvent: frame => seen.push(frame.seq) })
    await subscriber.subscribe([topic])
    await f.http(f.commandsPath, ownerToken, f.ping('4'))
    await f.until(() => seen.length === 1)
    expect(seen).toEqual([4])
    subscriber.close()
  }, 30_000)

  test('a revoked session receives no push; other sessions still do', async () => {
    const f = await fixture()
    const revokedToken = await f.token(f.owner.login)
    const liveToken = await f.token(f.owner.login)
    const topic = `user:${f.owner.principalId}`
    const revoked = await f.ws(revokedToken)
    const live = await f.ws(liveToken)
    for (const c of [revoked, live]) await c.client.invoke(REALTIME_RPC.SUBSCRIBE, f.workspaceId, { topics: [{ topic }] })
    expect(await f.service.identity.revokeSession(String(decodeJwt(revokedToken).sid))).toBe(true)
    await f.http(f.commandsPath, liveToken, f.ping('after-revoke'))
    await f.until(() => live.frames.length === 1)
    await Bun.sleep(150)
    expect(revoked.frames).toEqual([])
  }, 30_000)
})
