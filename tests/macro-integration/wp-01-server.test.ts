import { afterEach, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { decodeJwt } from 'jose'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { PROTOCOL_VERSION } from '../../packages/shared/src/protocol'
import { DOMAIN_PROJECT_RPC } from '../../packages/shared/src/workspace-domain/identity/contracts'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../../apps/workspace-service/src/server'
import { loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected structured service response')
  return Object.fromEntries(Object.entries(value))
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Expected service string')
  return value
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected service array')
  return value
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing service fixture')
  return value
}
function barrier() {
  let signal: () => void = () => { throw new Error('Uninitialized barrier') }
  const promise = new Promise<void>(resolve => { signal = resolve })
  return { promise, signal }
}

async function fixture() {
  // The protected loader validates ownership/permissions and the approved local
  // PG destination. Its URL is never emitted or copied into evidence/source.
  const url = await loadProtectedWorkspaceDatabaseUrl(process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json'))
  let database = new SQL(url, { max: 12 })
  const schema = 'wp01_server_' + randomBytes(6).toString('hex')
  const directory = await mkdtemp(join(tmpdir(), 'rox-composed-server-'))
  const issuer = 'urn:rox:composed-server:' + randomUUID()
  const audience = 'rox-composed-server-test'
  const password = 'synthetic-service-test-' + randomUUID()
  const workspaceId = randomUUID()
  const workspaceName = 'Synthetic composed service workspace'
  const clients: WsRpcClient[] = []
  const sockets: WebSocket[] = []
  let service: Awaited<ReturnType<typeof createWorkspaceServer>> | undefined
  let createdSchema = false
  const current = () => required(service)
  const migrations = await loadWorkspaceBootstrapMigrations(resolve(import.meta.dir, '../../apps/workspace-service/migrations'))
  async function stop() {
    for (const client of clients.splice(0)) client.destroy()
    for (const socket of sockets.splice(0)) socket.terminate()
    if (service) { service.server.close(); service = undefined }
  }
  cleanups.push(async () => {
    await stop()
    try { if (createdSchema) await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`) }
    finally { await database.close(); await rm(directory, { recursive: true, force: true }) }
  })
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  createdSchema = true
  async function start() {
    service = await createWorkspaceServer({ database, schema, migrations, host: '127.0.0.1', port: 0,
      serverId: 'composed-test-' + schema,
      authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience,
        stateDirectory: directory, checkoutDirectory: process.cwd(), tokenLifetimeSeconds: 300 } } })
    await service.server.listen()
    return service
  }
  await start()
  const account = async (label: string) => {
    const login = label + '-' + randomUUID() + '@example.invalid'
    return { login, ...await current().identity.provisionAccount(login, password) }
  }
  const owner = await account('owner')
  const member = await account('member')
  const outsider = await account('outsider')
  await current().repository.provisionWorkspace(owner.principalId, workspaceId, workspaceName)
  await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceId, member.principalId])

  async function http(path: string, token?: string, body?: unknown) {
    const response = await fetch(`http://127.0.0.1:${current().server.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    })
    const text = await response.text()
    const parsed: unknown = JSON.parse(text)
    return { status: response.status, body: parsed, text }
  }
  async function token(login: string) {
    const response = await http('/v1/auth/local/token', undefined, { login, password })
    expect(response.status).toBe(200)
    return string(object(response.body).token)
  }
  const ownerToken = await token(owner.login)
  const memberToken = await token(member.login)
  const outsiderToken = await token(outsider.login)

  async function ws(token: string, workspace = workspaceId) {
    const client = new WsRpcClient(`ws://127.0.0.1:${current().server.port}`, {
      token, workspaceId: workspace, mode: 'remote', autoReconnect: false, connectTimeout: 2000, requestTimeout: 5000,
    })
    clients.push(client)
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('Composed service handshake timed out')) }, 2500)
      const off = client.onConnectionStateChanged(state => {
        if (state.status === 'connected') { clearTimeout(timer); off(); resolve() }
        else if (state.status === 'failed' || state.status === 'disconnected') { clearTimeout(timer); off(); reject(new Error('Composed service handshake denied')) }
      })
    })
    client.connect()
    await connected
    return client
  }
  async function rawHandshake(fields: Record<string, unknown>): Promise<unknown> {
    const socket = new WebSocket(`ws://127.0.0.1:${current().server.port}`)
    sockets.push(socket)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Raw composed handshake timed out')), 2500)
      socket.once('open', () => socket.send(JSON.stringify({ id: randomUUID(), type: 'handshake', protocolVersion: PROTOCOL_VERSION, workspaceId, ...fields })))
      socket.on('message', data => {
        const message = object(JSON.parse(data.toString()))
        if (message.type === 'handshake_ack') { clearTimeout(timer); resolve(message) }
        if (message.type === 'error') { clearTimeout(timer); reject(new Error('Handshake denied: ' + string(object(message.error).code))) }
      })
      socket.once('close', () => { clearTimeout(timer); reject(new Error('Raw composed handshake denied')) })
      socket.once('error', () => { clearTimeout(timer); reject(new Error('Raw composed handshake failed')) })
    })
  }
  function command(name: string, visibility: 'private' | 'members' = 'private') {
    return { commandId: randomUUID(), schemaVersion: 2, workspaceId, idempotencyKey: randomUUID(), expectedRevision: '0',
      payload: { name, workspaceName, visibility } }
  }
  const basePath = '/v1/workspaces/' + workspaceId
  async function counts() {
    const rows = await database.unsafe<{ projects: number; receipts: number; events: number }[]>(`SELECT
      (SELECT count(*)::integer FROM "${schema}".project WHERE workspace_id=$1) AS projects,
      (SELECT count(*)::integer FROM "${schema}".project_create_receipt WHERE workspace_id=$1) AS receipts,
      (SELECT count(*)::integer FROM "${schema}".project_event WHERE workspace_id=$1 AND type='project.created') AS events`, [workspaceId])
    return required(rows[0])
  }
  async function waitForBlockedSessionQuery() {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const rows = await database<{ count: number }[]>`SELECT count(*)::integer AS count FROM pg_stat_activity
        WHERE cardinality(pg_blocking_pids(pid)) > 0 AND query LIKE ${'%' + '"' + schema + '".bootstrap_auth_session' + '%'}`
      if (required(rows[0]).count > 0) return
      await Bun.sleep(10)
    }
    throw new Error('Composed command did not wait on its persisted session transaction gate')
  }
  return { get database() { return database }, schema, current, issuer, directory, owner, member, outsider,
    workspaceId, basePath, ownerToken, memberToken, outsiderToken, http, ws, rawHandshake, command, counts, waitForBlockedSessionQuery,
    async restart() { await stop(); await database.close(); database = new SQL(url, { max: 12 }); return start() } }
}

describe('WP-01 actual composed workspace service, PostgreSQL and cryptographic accounts', () => {
  test('WS creates a canonical private project that the same HTTP authority reads; B and outsider receive no title', async () => {
    const f = await fixture()
    expect(f.owner.principalId).not.toBe(f.member.principalId)
    const owner = await f.ws(f.ownerToken)
    const member = await f.ws(f.memberToken)
    const command = f.command('PRIVATE_COMPOSED_' + randomUUID())
    const created: unknown = await owner.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, f.workspaceId, command)
    const result = object(created)
    const entityId = string(object(result.entity).entityId)
    expect(result.status).toBe('applied')
    expect(result.commandId).toBe(command.commandId)
    const read = await f.http(f.basePath + '/projects/' + encodeURIComponent(entityId), f.ownerToken)
    expect(read.status).toBe(200)
    expect(read.body).toEqual(result.data)
    expect(await owner.invoke(DOMAIN_PROJECT_RPC.GET, f.workspaceId, { entityId })).toEqual(read.body)
    for (const token of [f.memberToken, f.outsiderToken]) {
      const denied = await f.http(f.basePath + '/projects/' + encodeURIComponent(entityId), token)
      expect(denied.status).toBe(403)
      expect(denied.body).toEqual({ error: { code: 'FORBIDDEN' } })
      expect(denied.text).not.toContain(command.payload.name)
    }
    const privateRpcError: unknown = await member.invoke(DOMAIN_PROJECT_RPC.GET, f.workspaceId, { entityId }).then(
      () => { throw new Error('Private project read unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(object(privateRpcError).code).toBe('FORBIDDEN')
    expect(JSON.stringify(privateRpcError)).not.toContain(command.payload.name)
    const list = await f.http(f.basePath + '/projects', f.memberToken)
    expect(list.status).toBe(200)
    expect(list.body).toEqual({ items: [] })
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
  }, 30000)

  test('outsider/forged handshakes and command actor/workspace injection cannot obtain authority', async () => {
    const f = await fixture()
    await expect(f.ws(f.outsiderToken)).rejects.toThrow('handshake denied')
    for (const claims of [{ actor: { principalId: f.owner.principalId } }, { principalId: f.owner.principalId }, { authenticatedWorkspaceIds: [f.workspaceId] }]) {
      await expect(f.rawHandshake({ token: f.ownerToken, ...claims })).rejects.toThrow('denied')
    }
    const owner = await f.ws(f.ownerToken)
    const input = f.command('FORGED_INPUT_MUST_NOT_PERSIST')
    const extra = { actor: { principalId: f.owner.principalId, authenticatedWorkspaceIds: [f.workspaceId] } }
    for (const body of [{ ...input, ...extra }, { ...input, payload: { ...input.payload, ...extra } }]) {
      await expect(owner.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, f.workspaceId, body)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
      expect((await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, body)).body).toEqual({ error: { code: 'INVALID_PAYLOAD' } })
    }
    const otherWorkspace = randomUUID()
    await expect(owner.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, otherWorkspace, input)).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' })
    const wrongScope = await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, { ...input, workspaceId: otherWorkspace })
    expect(wrongScope.status).toBe(403)
    expect(wrongScope.body).toEqual({ error: { code: 'WORKSPACE_MISMATCH' } })
    expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
  }, 30000)

  test('cross-transport concurrent retries and full listener/pool restart retain key, project, receipt and replay cursor', async () => {
    const f = await fixture()
    const jwks = await f.http('/.well-known/jwks.json')
    expect(jwks.status).toBe(200)
    for (const key of array(object(jwks.body).keys)) {
      expect(object(key).kty).toBe('OKP')
      expect(object(key).crv).toBe('Ed25519')
      for (const field of ['d', 'k', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) expect(Object.hasOwn(object(key), field)).toBe(false)
    }
    const owner = await f.ws(f.ownerToken)
    const input = f.command('PERSISTED_COMPOSED_' + randomUUID(), 'members')
    const replies: unknown[] = await Promise.all(Array.from({ length: 6 }, (_, index) => index % 2
      ? owner.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, f.workspaceId, input)
      : f.http(f.basePath + '/commands/project.createShared', f.ownerToken, input).then(reply => { expect(reply.status).toBe(200); return reply.body })))
    const first = required(replies[0])
    for (const reply of replies) expect(reply).toEqual(first)
    const entityId = string(object(object(first).entity).entityId)
    const page = await f.http(f.basePath + '/events?limit=1', f.ownerToken)
    expect(page.status).toBe(200)
    expect(array(object(page.body).events)).toHaveLength(1)
    const cursor = string(object(page.body).nextCursor)
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
    const restarted = await f.restart()
    expect(restarted.migrations.applied).toEqual([])
    expect(restarted.migrations.retained).toEqual(['01-domain-contract.sql', '01-local-auth-bootstrap.sql'])
    expect((await f.http('/.well-known/jwks.json')).body).toEqual(jwks.body)
    const retried = await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, input)
    expect(retried.status).toBe(200)
    expect(retried.body).toEqual(first)
    const reconnected = await f.ws(f.ownerToken)
    expect(await reconnected.invoke(DOMAIN_PROJECT_RPC.GET, f.workspaceId, { entityId })).toEqual(object(first).data)
    const replay = await f.http(f.basePath + '/events?cursor=' + cursor, f.ownerToken)
    expect(replay.status).toBe(200)
    const events = array(object(replay.body).events)
    expect(events).toHaveLength(1)
    expect(object(required(events[0])).type).toBe('project.created')
    expect(object(required(events[0])).causationId).toBe(input.commandId)
    expect(replay.text).not.toContain(input.payload.name)
    const empty: unknown = await reconnected.invoke(DOMAIN_PROJECT_RPC.EVENTS, f.workspaceId, { cursor: string(object(replay.body).nextCursor) })
    expect(array(object(empty).events)).toEqual([])
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
    const conflict = await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, { ...input, payload: { ...input.payload, name: 'Changed retry' } })
    expect(conflict.status).toBe(409)
    expect(conflict.body).toEqual({ error: { code: 'IDEMPOTENCY_CONFLICT' } })
  }, 30000)

  test('durable session revocation denies an existing WS client and HTTP receipt replay after restart', async () => {
    const f = await fixture()
    const owner = await f.ws(f.ownerToken)
    const command = f.command('PRIVATE_REVOKED_' + randomUUID())
    const first: unknown = await owner.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, f.workspaceId, command)
    expect(await f.current().identity.revokeSession(string(decodeJwt(f.ownerToken).sid))).toBe(true)
    await expect(owner.invoke(DOMAIN_PROJECT_RPC.LIST, f.workspaceId, {})).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    const denied = await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, command)
    expect(denied.status).toBe(401)
    expect(denied.text).not.toContain(command.payload.name)
    await f.restart()
    expect((await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, command)).status).toBe(401)
    const tokenReply = await f.http('/v1/auth/local/token', undefined, { login: f.owner.login, password: 'incorrect synthetic password' })
    expect(tokenReply.status).toBe(401)
    expect(object(first).status).toBe('applied')
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
  }, 30000)

  for (const transport of ['HTTP', 'WS'] as const) test(`revocation that owns the session row first prevents a waiting ${transport} command from committing`, async () => {
    const f = await fixture()
    const client = transport === 'WS' ? await f.ws(f.ownerToken) : undefined
    const sid = string(decodeJwt(f.ownerToken).sid)
    const held = barrier()
    const release = barrier()
    const revoke = f.database.begin(async tx => {
      await tx.unsafe(`SELECT session_id FROM "${f.schema}".bootstrap_auth_session WHERE session_id=$1 FOR UPDATE`, [sid])
      held.signal()
      await release.promise
      await tx.unsafe(`UPDATE "${f.schema}".bootstrap_auth_session SET revoked_at=clock_timestamp() WHERE session_id=$1`, [sid])
    })
    await held.promise
    const input = f.command('PRIVATE_RACING_COMMAND_' + randomUUID())
    const request: Promise<unknown> = client
      ? client.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, f.workspaceId, input).then(
        (value: unknown) => ({ unexpectedSuccess: value }),
        (error: unknown) => error,
      )
      : f.http(f.basePath + '/commands/project.createShared', f.ownerToken, input)
    try { await f.waitForBlockedSessionQuery() }
    finally { release.signal(); await revoke; await request }
    const denied = object(await request)
    if (transport === 'HTTP') {
      expect(denied.status).toBe(401)
      expect(denied.body).toEqual({ error: { code: 'UNAUTHENTICATED' } })
      expect(denied.text).not.toContain(input.payload.name)
    } else {
      expect(denied.code).toBe('UNAUTHENTICATED')
      expect(JSON.stringify(denied)).not.toContain(input.payload.name)
    }
    expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
  }, 30000)
})

describe('WP-01 root review durable data boundaries', () => {
  test('persisted receipt JSON cannot substitute scope, canonical identity, title or unknown payload on retry', async () => {
    const f = await fixture()
    const input = f.command('ORIGINAL_PRIVATE_RECEIPT_' + randomUUID())
    const created = await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, input)
    expect(created.status).toBe(200)
    const result = object(created.body)
    const sentinel = 'UNTRUSTED_PERSISTED_PRIVATE_' + randomUUID()
    const variants: unknown[] = [{ ...result, extraPrivate: sentinel },
      { ...result, entity: { ...object(result.entity), workspaceId: randomUUID() } },
      { ...result, data: { ...object(result.data), name: sentinel } },
      { ...result, data: { ...object(result.data), ownerPrincipalId: f.member.principalId } },
      { ...result, receipt: { ...object(result.receipt), remoteId: 'project:' + randomUUID() } },
      { ...result, observedRevision: '99' }, { ...result, requestHash: '0'.repeat(64) },
      { ...result, verifiedAt: '2000-01-01T00:00:00.000Z' },
      { ...result, data: { ...object(result.data), createdAt: '2000-01-01T00:00:00.000Z' },
        verifiedAt: '2000-01-01T00:00:00.000Z', receipt: { ...object(result.receipt), verifiedAt: '2000-01-01T00:00:00.000Z' } },
      { ...result, data: { ...object(result.data), policyEpoch: '999' } },
      { ...result, data: { ...object(result.data), updatedAt: '2099-01-01T00:00:00.000Z' } },
      null,
    ]
    for (const corrupted of variants) {
    await f.database.unsafe(`UPDATE "${f.schema}".project_create_receipt SET result=$1::jsonb WHERE receipt_id=$2`, [JSON.stringify(corrupted), string(result.receiptId)])
    const denied = await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, input)
    expect(denied.status).toBe(503)
    expect(denied.body).toEqual({ error: { code: 'PROVIDER_UNAVAILABLE' } })
    expect(denied.text).not.toContain(sentinel)
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
    }
    await f.database.unsafe(`UPDATE "${f.schema}".project_create_receipt SET result=$1::jsonb WHERE receipt_id=$2`, [result, string(result.receiptId)])
    expect((await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, input)).body).toEqual(result)
  }, 30000)

  test('event replay never advances beyond an earlier transaction whose event sequence exists but is uncommitted', async () => {
    const f = await fixture()
    const slow = f.command('SLOW_EVENT_' + randomUUID(), 'members')
    const fast = f.command('FAST_EVENT_' + randomUUID(), 'members')
    const lock = String(BigInt('0x' + randomBytes(6).toString('hex')))
    const held = barrier(), release = barrier()
    const blocker = f.database.begin(async tx => {
      await tx.unsafe('SELECT pg_advisory_xact_lock($1::bigint)', [lock])
      held.signal()
      await release.promise
    })
    await held.promise
    await f.database.unsafe(`CREATE FUNCTION "${f.schema}".hold_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.causation_id = '${slow.commandId}' THEN PERFORM pg_advisory_xact_lock(${lock}::bigint); END IF; RETURN NEW; END $$`)
    await f.database.unsafe(`CREATE TRIGGER hold_event BEFORE INSERT ON "${f.schema}".project_event FOR EACH ROW EXECUTE FUNCTION "${f.schema}".hold_event()`)
    const slowRequest = f.http(f.basePath + '/commands/project.createShared', f.ownerToken, slow)
    let fastRequest: ReturnType<typeof f.http> | undefined
    let firstPage: Awaited<ReturnType<typeof f.http>> | undefined
    try {
      let slowBlocked = false
      for (let attempt = 0; attempt < 300; attempt++) {
        const rows = await f.database<{ count: number }[]>`SELECT count(*)::integer AS count FROM pg_stat_activity
          WHERE cardinality(pg_blocking_pids(pid)) > 0 AND query LIKE ${'%"' + f.schema + '".project_event%'}`
        if (required(rows[0]).count) { slowBlocked = true; break }
        await Bun.sleep(10)
      }
      expect(slowBlocked).toBe(true)
      let fastFinished = false
      fastRequest = f.http(f.basePath + '/commands/project.createShared', f.ownerToken, fast).then(reply => { fastFinished = true; return reply })
      let fastSettled = false
      for (let attempt = 0; attempt < 300; attempt++) {
        const rows = await f.database<{ count: number }[]>`SELECT count(*)::integer AS count FROM pg_stat_activity
          WHERE cardinality(pg_blocking_pids(pid)) > 0 AND query LIKE '%SELECT pg_advisory_xact_lock%'`
        if (fastFinished || required(rows[0]).count) { fastSettled = true; break }
        await Bun.sleep(10)
      }
      expect(fastSettled).toBe(true)
      firstPage = await f.http(f.basePath + '/events?limit=100', f.ownerToken)
      expect(firstPage.status).toBe(200)
    } finally { release.signal(); await blocker; await slowRequest; if (fastRequest) await fastRequest }
    expect((await slowRequest).status).toBe(200)
    expect((await required(fastRequest)).status).toBe(200)
    const initial = required(firstPage)
    const next = await f.http(f.basePath + '/events?cursor=' + string(object(initial.body).nextCursor), f.ownerToken)
    expect(next.status).toBe(200)
    const seen = [...array(object(initial.body).events), ...array(object(next.body).events)]
      .filter(event => object(event).type === 'project.created').map(event => string(object(event).causationId)).sort()
    expect(seen).toEqual([slow.commandId, fast.commandId].sort())
    expect(await f.counts()).toEqual({ projects: 2, receipts: 2, events: 2 })
  }, 30000)
})

describe('WP-01 root review event privacy', () => {
  test('persisted event payload cannot disclose extra title/body fields through replay', async () => {
    const f = await fixture()
    const input = f.command('PRIVATE_EVENT_PAYLOAD_' + randomUUID(), 'members')
    const created = await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, input)
    expect(created.status).toBe(200)
    const sentinel = 'PERSISTED_PRIVATE_EVENT_BODY_' + randomUUID()
    await f.database.unsafe(`UPDATE "${f.schema}".project_event SET payload=$1::jsonb WHERE causation_id=$2`,
      [{ entityId: string(object(object(created.body).entity).entityId), body: sentinel }, input.commandId])
    const denied = await f.http(f.basePath + '/events', f.memberToken)
    expect(denied.status).toBe(503)
    expect(denied.body).toEqual({ error: { code: 'PROVIDER_UNAVAILABLE' } })
    expect(denied.text).not.toContain(sentinel)
    expect(denied.text).not.toContain(input.payload.name)
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
  }, 30000)
})

describe('WP-01 root review command identity', () => {
  test('a command ID already bound to another receipt cannot be reused with an older idempotency key', async () => {
    const f = await fixture()
    const first = f.command('SAME_CONTENT_DIFFERENT_COMMAND_' + randomUUID(), 'members')
    const second = { ...first, commandId: randomUUID(), idempotencyKey: randomUUID() }
    expect((await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, first)).status).toBe(200)
    expect((await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, second)).status).toBe(200)
    for (const body of [{ ...first, commandId: second.commandId }, { ...second, commandId: first.commandId }]) {
      const crossed = await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, body)
      expect(crossed.status).toBe(409)
      expect(crossed.body).toEqual({ error: { code: 'IDEMPOTENCY_CONFLICT' } })
    }
    expect(await f.counts()).toEqual({ projects: 2, receipts: 2, events: 2 })
  }, 30000)
})
