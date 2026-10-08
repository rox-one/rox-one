import { afterEach, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeJwt } from 'jose'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { DOMAIN_PROJECT_RPC } from '../../packages/shared/src/workspace-domain/identity/contracts'
import { PostgresIdentityAuth, loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity'
import { IdentityRepository } from '../../apps/workspace-service/src/modules/identity/repository'
import { loadWorkspaceBootstrapMigrations } from '../../apps/workspace-service/src/server'

const DATABASE_CONFIGURATION = process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json')
const CHILD_TIMEOUT_MS = 5000
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected sanitized structured result')
  return Object.fromEntries(Object.entries(value))
}
function text(value: unknown): string { if (typeof value !== 'string' || !value) throw new Error('Expected service string'); return value }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('Expected service array'); return value }
function required<T>(value: T | undefined): T { if (value === undefined) throw new Error('Missing service crash fixture'); return value }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rox-service-process-crash-'))
  const bin = join(directory, 'bin'); await mkdir(bin); await symlink(process.execPath, join(bin, 'bun'))
  const schema = 'wp01_process_' + randomBytes(6).toString('hex')
  const database = new SQL(await loadProtectedWorkspaceDatabaseUrl(DATABASE_CONFIGURATION), { max: 12 })
  const issuer = 'urn:rox:service-process-crash:' + randomUUID()
  const audience = 'rox-service-process-crash'
  const workspaceId = randomUUID(); const workspaceName = 'Actual crash workspace'
  const password = 'actual-process-account-' + randomUUID()
  const ownerLogin = randomUUID() + '@example.invalid'; const memberLogin = randomUUID() + '@example.invalid'
  const clients: WsRpcClient[] = []
  function launchServer() {
    return Bun.spawn([process.execPath, join(import.meta.dir, 'wp-01-service-crash-child.ts')], {
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', cwd: process.cwd(), env: { ...process.env, PATH: bin,
        ROX_CONFIG_DIR: join(directory, 'profile'), CRAFT_CONFIG_DIR: join(directory, 'profile'), CRAFT_DEBUG: 'false' },
    })
  }
  type Process = ReturnType<typeof launchServer>
  let child: Process | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let diagnostic: Promise<string> | undefined
  let buffered = ''
  let port = 0
  let createdSchema = false
  async function killServer() {
    if (child) {
      child.kill('SIGKILL'); expect((await child.exited) !== 0).toBe(true); expect(child.signalCode).toBe('SIGKILL')
      expect((await required(diagnostic)).length === 0).toBe(true)
      reader?.releaseLock(); reader = undefined; child = undefined
    }
  }
  async function stop() { await killServer(); for (const client of clients.splice(0)) client.destroy() }
  cleanups.push(async () => {
    try { await stop(); if (createdSchema) await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`) }
    finally { await database.close(); await rm(directory, { recursive: true, force: true }) }
  })
  await database.unsafe(`CREATE SCHEMA "${schema}"`); createdSchema = true
  async function message(expectedType: string): Promise<Record<string, unknown>> {
    const reading = required(reader)
    const timeout = setTimeout(() => child?.kill('SIGKILL'), CHILD_TIMEOUT_MS)
    try {
      while (!buffered.includes('\n')) {
        const part = await reading.read()
        if (part.done) throw new Error('Service exited before expected sanitized checkpoint')
        buffered += new TextDecoder().decode(part.value)
        if (buffered.length > 8192) throw new Error('Unexpected service child output')
      }
      const index = buffered.indexOf('\n'); const line = buffered.slice(0, index); buffered = buffered.slice(index + 1)
      const value = record(JSON.parse(line)); expect(value.type).toBe(expectedType); return value
    } finally { clearTimeout(timeout) }
  }
  function control(value: unknown) { required(child).stdin.write(JSON.stringify(value) + '\n') }
  async function start() {
    const running = launchServer()
    child = running; reader = running.stdout.getReader(); buffered = ''; diagnostic = new Response(running.stderr).text()
    control({ databaseConfiguration: DATABASE_CONFIGURATION, schema, issuer, audience, serverId: 'process-crash-' + schema,
      issuerDirectory: join(directory, 'issuer') })
    const ready = await message('ready')
    if (typeof ready.port !== 'number' || ready.port <= 0) throw new Error('Missing real service port')
    port = ready.port; return ready
  }
  await start()
  const identity = new PostgresIdentityAuth(database, issuer, schema)
  const repository = new IdentityRepository(database, schema)
  const owner = await identity.provisionAccount(ownerLogin, password)
  const member = await identity.provisionAccount(memberLogin, password)
  await repository.provisionWorkspace(owner.principalId, workspaceId, workspaceName)
  await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceId, member.principalId])
  await database.unsafe(`CREATE TABLE "${schema}".crash_projection (event_id uuid PRIMARY KEY, applications integer NOT NULL)`)
  async function http(path: string, token?: string, body?: unknown) {
    const response = await fetch('http://127.0.0.1:' + port + path, { method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(CHILD_TIMEOUT_MS), headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const serialized = await response.text(); const value: unknown = JSON.parse(serialized)
    return { status: response.status, body: value, serialized }
  }
  async function token(login: string) {
    const issued = await http('/v1/auth/local/token', undefined, { login, password })
    expect(issued.status).toBe(200); return text(record(issued.body).token)
  }
  const ownerToken = await token(ownerLogin); const memberToken = await token(memberLogin)
  async function ws(token: string) {
    const client = new WsRpcClient('ws://127.0.0.1:' + port, { token, workspaceId, mode: 'remote', autoReconnect: false,
      requestTimeout: CHILD_TIMEOUT_MS, connectTimeout: 2000 })
    clients.push(client)
    const connected = Promise.withResolvers<void>()
    const timer = setTimeout(() => connected.reject(new Error('Actual service handshake timeout')), 2500)
    const off = client.onConnectionStateChanged(state => {
      if (state.status === 'connected') connected.resolve()
      if (state.status === 'failed' || state.status === 'disconnected') connected.reject(new Error('Actual service handshake denied'))
    })
    client.connect()
    try { await connected.promise } finally { clearTimeout(timer); off() }
    return client
  }
  const command = { commandId: randomUUID(), idempotencyKey: randomUUID(), schemaVersion: 2, workspaceId, expectedRevision: '0',
    payload: { name: 'PRIVATE_POSTCOMMIT_' + randomUUID(), workspaceName, visibility: 'private' } }
  async function counts() {
    const rows = await database.unsafe<{ projects: number; receipts: number; events: number }[]>(`SELECT
      (SELECT count(*)::integer FROM "${schema}".project WHERE workspace_id=$1) projects,
      (SELECT count(*)::integer FROM "${schema}".project_create_receipt WHERE workspace_id=$1) receipts,
      (SELECT count(*)::integer FROM "${schema}".project_event WHERE workspace_id=$1 AND type='project.created') events`, [workspaceId])
    return required(rows[0])
  }
  const basePath = '/v1/workspaces/' + workspaceId
  const beforeJwks = (await http('/.well-known/jwks.json')).body
  const beforePage = await http(basePath + '/events?limit=1', ownerToken)
  expect(beforePage.status).toBe(200); expect(array(record(beforePage.body).events)).toHaveLength(1)
  const oldCursor = text(record(beforePage.body).nextCursor)
  const consumerId = 'actual-consumer-' + randomUUID()
  control({ action: 'consume', consumerId, schema }); expect((await message('consumed')).changed).toBe(true)
  async function crashAfterCommittedRequest() {
    const ownerClient = await ws(ownerToken)
    control({ action: 'arm' }); await message('armed')
    let successReplies = 0; let settled = false
    const pending = ownerClient.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, workspaceId, command).then(
      () => { settled = true; successReplies++; return { success: true, failure: null } },
      (error: unknown) => { settled = true; return { success: false, failure: error instanceof Error ? error.message : null } },
    )
    const checkpoint = await message('postcommit-pre-reply')
    expect(checkpoint.completions).toBe(2); expect(checkpoint.active).toBe(0)
    // This separate SQL connection proves the real transaction committed before process death.
    expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
    const receipts = await database.unsafe<{ result: unknown; receipt_id: string; request_hash: string; sequence: string }[]>(`SELECT
      r.result,r.receipt_id,r.request_hash,e.sequence::text FROM "${schema}".project_create_receipt r
      JOIN "${schema}".project_event e ON e.workspace_id=r.workspace_id AND e.causation_id=r.command_id
      WHERE r.workspace_id=$1 AND r.command_id=$2`, [workspaceId, command.commandId])
    expect(receipts).toHaveLength(1)
    const receipt = required(receipts[0]); expect(record(receipt.result).receiptId).toBe(receipt.receipt_id)
    expect(record(receipt.result).requestHash).toBe(receipt.request_hash)
    expect(record(receipt.result).verification).toBe('receipt_verified')
    expect(successReplies).toBe(0); expect(settled).toBe(false)
    // Kill the real service first. The real client must reject from transport loss,
    // before fixture cleanup destroys it.
    await killServer(); expect(await pending).toEqual({ success: false, failure: 'Connection lost' }); expect(successReplies).toBe(0)
    for (const client of clients.splice(0)) client.destroy()
    return receipt
  }
  return { database, schema, owner, member, identity, workspaceId, command, basePath, ownerToken, memberToken, consumerId,
    oldCursor, beforeJwks, crashAfterCommittedRequest, http, ws, token: () => token(ownerLogin), counts,
    async restart() { const ready = await start(); expect(record(ready.migrations).applied).toEqual([])
      // Startup always loads the full sorted set (01-*, 48, 5NN-*), so a restart retains all of it.
      expect(record(ready.migrations).retained).toEqual((await loadWorkspaceBootstrapMigrations(join(import.meta.dir, '../../apps/workspace-service/migrations'))).map(m => m.name))
      expect((await http('/.well-known/jwks.json')).body).toEqual(beforeJwks); return ready },
    async consume() { control({ action: 'consume', consumerId, schema }); return message('consumed') },
  }
}

describe('WP-01 actual service process dies after SQL commit and before private reply', () => {
  test('fresh process retains receipt/key/cursor; concurrent HTTP/WS retries create no duplicate and durable consumer applies once', async () => {
    const f = await fixture(); const retained = await f.crashAfterCommittedRequest(); await f.restart()
    const owner = await f.ws(f.ownerToken)
    const replies: unknown[] = await Promise.all(Array.from({ length: 6 }, (_, index) => index % 2
      ? owner.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, f.workspaceId, f.command)
      : f.http(f.basePath + '/commands/project.createShared', f.ownerToken, f.command).then(reply => { expect(reply.status).toBe(200); return reply.body })))
    for (const reply of replies) expect(reply).toEqual(retained.result)
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
    const entityId = text(record(retained.result).entityId)
    const member = await f.ws(f.memberToken)
    await expect(member.invoke(DOMAIN_PROJECT_RPC.GET, f.workspaceId, { entityId })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const denied = await f.http(f.basePath + '/projects/' + entityId, f.memberToken)
    expect(denied.status).toBe(403); expect(denied.body).toEqual({ error: { code: 'FORBIDDEN' } })
    expect(denied.serialized).not.toContain(f.command.payload.name)
    const memberRetry = await f.http(f.basePath + '/commands/project.createShared', f.memberToken, f.command)
    expect(memberRetry.status).toBe(403); expect(memberRetry.serialized).not.toContain(f.command.payload.name)
    const replay = await f.http(f.basePath + '/events?cursor=' + f.oldCursor, f.ownerToken)
    expect(replay.status).toBe(200); const events = array(record(replay.body).events); expect(events).toHaveLength(1)
    expect(record(required(events[0])).causationId).toBe(f.command.commandId)
    expect(record(required(events[0])).type).toBe('project.created'); expect(replay.serialized).not.toContain(f.command.payload.name)
    const cursor = text(record(replay.body).nextCursor)
    expect(array(record(await owner.invoke(DOMAIN_PROJECT_RPC.EVENTS, f.workspaceId, { cursor })).events)).toEqual([])
    expect((await f.consume()).changed).toBe(true); expect((await f.consume()).changed).toBe(false)
    const projections = await f.database.unsafe<{ applications: number }[]>(`SELECT applications FROM "${f.schema}".crash_projection`)
    expect(projections).toEqual([{ applications: 1 }])
    const watermarks = await f.database.unsafe<{ sequence: string; inbox: number }[]>(`SELECT w.sequence::text,
      (SELECT count(*)::integer FROM "${f.schema}".project_event_inbox WHERE consumer_id=$1) inbox
      FROM "${f.schema}".project_projection_watermark w WHERE consumer_id=$1 AND workspace_id=$2`, [f.consumerId,f.workspaceId])
    expect(watermarks).toEqual([{ sequence: retained.sequence, inbox: 2 }])
    const conflict = await f.http(f.basePath + '/commands/project.createShared', f.ownerToken,
      { ...f.command, payload: { ...f.command.payload, name: 'Changed post-crash intent' } })
    expect(conflict.status).toBe(409); expect(conflict.body).toEqual({ error: { code: 'IDEMPOTENCY_CONFLICT' } })
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
  }, 30000)
  test('revoked persisted session cannot recover a private receipt after restart; new real login recovers exactly the original receipt', async () => {
    const f = await fixture(); const retained = await f.crashAfterCommittedRequest()
    const sessionId = text(decodeJwt(f.ownerToken).sid)
    await f.identity.revokeSession(sessionId); await f.restart()
    const denied = await f.http(f.basePath + '/commands/project.createShared', f.ownerToken, f.command)
    expect(denied.status).toBe(401); expect(denied.body).toEqual({ error: { code: 'UNAUTHENTICATED' } })
    expect(denied.serialized).not.toContain(f.command.payload.name)
    await expect(f.ws(f.ownerToken)).rejects.toThrow('handshake denied')
    const fresh = await f.token(); expect(fresh === f.ownerToken).toBe(false)
    const recovered = await f.http(f.basePath + '/commands/project.createShared', fresh, f.command)
    expect(recovered.status).toBe(200); expect(recovered.body).toEqual(retained.result)
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
  }, 30000)
  test('current membership removal denies receipt/project/event replay despite a valid old signed session after restart', async () => {
    const f = await fixture(); const retained = await f.crashAfterCommittedRequest()
    await f.database.unsafe(`UPDATE "${f.schema}".workspace_member SET deleted_at=clock_timestamp()
      WHERE workspace_id=$1 AND principal_id=$2`, [f.workspaceId,f.owner.principalId])
    await f.restart()
    const entityId = text(record(retained.result).entityId)
    for (const path of [f.basePath + '/commands/project.createShared', f.basePath + '/projects/' + entityId, f.basePath + '/events?cursor=' + f.oldCursor]) {
      const denied = await f.http(path, f.ownerToken, path.endsWith('project.createShared') ? f.command : undefined)
      expect(denied.status).toBe(403); expect(denied.body).toEqual({ error: { code: 'FORBIDDEN' } })
      expect(denied.serialized).not.toContain(f.command.payload.name)
    }
    await expect(f.ws(f.ownerToken)).rejects.toThrow('handshake denied')
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
  }, 30000)
})
