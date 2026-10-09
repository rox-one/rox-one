/**
 * W1-09 (#1506) — notify on the *composed* workspace service (PostgreSQL).
 *
 * `notify.test.ts` drives the notify module through the HTTP handler and an
 * in-process bus. This suite closes the remaining gap: the real composition
 * (`createWorkspaceServer` → `createWorkspaceCommandBus` → `NOTIFY_ROUTES` →
 * `RealtimeGateway`) with the W1-05 DDL applied, a real command transaction,
 * the real relay and a real WebSocket push on `user:{id}`.
 *
 * The exit criterion of the package card lives in the first test: a reference
 * goal update notifies the champion, the reviewer and the subscribers, and
 * nobody else. W1-06 (#1503) swaps the reference handlers for the real goal
 * handler; the assertions do not change.
 *
 * Postgres comes from `ROX_TEST_PG_URL` or a temp `initdb` cluster, exactly as
 * `migrations.unified.test.ts` and `command-bus.pg.test.ts` do; without either
 * the suite skips (the static and in-process suites still run).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { z } from 'zod'
import { PLACEHOLDER_PAYLOAD_SCHEMA } from '../../../packages/core/src/commands/index.ts'
import { REALTIME_RPC, type RealtimeEventFrame, type RealtimeSubscribeResult } from '../../../packages/core/src/events/index.ts'
import { createWiredCommandRegistry } from '../../../packages/server-core/src/commands/registry.ts'
import type { CommandReceipt } from '../../../packages/core/src/commands/index.ts'
import { commandReceiptSchema } from '../../../packages/shared/src/commands/schemas.ts'
import {
  notificationListResultSchema,
  notificationReadResultSchema,
} from '../../../packages/shared/src/notify/schemas.ts'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client.ts'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../src/server.ts'
import type { DomainEventRelay } from '../src/modules/events/relay.ts'
import { InMemoryNotificationStore } from '../src/modules/notify/store.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

// ---------------------------------------------------------------------------
// Postgres (ROX_TEST_PG_URL, else a temp initdb cluster, else skip)
// ---------------------------------------------------------------------------

interface TestDatabase { url: string; label: string; cleanup(): Promise<void> }

function whichBinary(name: string): string | null {
  const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' })
  return found.stdout?.trim() || null
}

async function tryConnect(url: string): Promise<SQL | null> {
  try {
    const database = new SQL(url)
    await database`SELECT 1`
    return database
  } catch {
    return null
  }
}

async function startTempPostgres(): Promise<TestDatabase | null> {
  const initdb = whichBinary('initdb')
  const pgctl = whichBinary('pg_ctl')
  if (!initdb || !pgctl) return null
  let dir: string
  try {
    dir = await mkdtemp(join(tmpdir(), 'w109-pg-'))
  } catch {
    return null
  }
  const data = join(dir, 'data')
  const teardown = async () => {
    spawnSync(pgctl, ['-D', data, 'stop', '-m', 'fast'], { encoding: 'utf8' })
    await rm(dir, { recursive: true, force: true })
  }
  try {
    if (spawnSync(initdb, ['-D', data, '-U', 'postgres', '--auth=trust'], { encoding: 'utf8' }).status !== 0) {
      await teardown()
      return null
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const port = 46800 + (process.pid % 2000) + attempt
      const started = spawnSync(pgctl, ['-D', data, '-w', '-o', `-k ${dir} -p ${port} -c listen_addresses='127.0.0.1'`, '-l', join(dir, 'log'), 'start'], { encoding: 'utf8' })
      if (started.status !== 0) {
        spawnSync(pgctl, ['-D', data, 'stop', '-m', 'fast'], { encoding: 'utf8' })
        continue
      }
      const url = `postgres://postgres@127.0.0.1:${port}/postgres`
      const probe = await tryConnect(url)
      if (probe) {
        await probe.close()
        return { url, label: `temp initdb cluster (port ${port})`, cleanup: teardown }
      }
      spawnSync(pgctl, ['-D', data, 'stop', '-m', 'fast'], { encoding: 'utf8' })
    }
    await teardown()
    return null
  } catch {
    await teardown().catch(() => {})
    return null
  }
}

/** Resolves on the first frame of `type`; the timer only fires when it never arrives. */
function waitForFrame(client: WsRpcClient, type: string, withinMs = 5000): Promise<RealtimeEventFrame> {
  const { promise, resolve, reject } = Promise.withResolvers<RealtimeEventFrame>()
  const timer = setTimeout(() => { off(); reject(new Error(`no ${type} frame within ${withinMs}ms`)) }, withinMs)
  const off = client.on(REALTIME_RPC.EVENT, (_ws: string, frame: RealtimeEventFrame) => {
    if (frame.type !== type) return
    clearTimeout(timer)
    off()
    resolve(frame)
  })
  return promise
}

const testDb = process.env.ROX_TEST_PG_URL
  ? { url: process.env.ROX_TEST_PG_URL, label: 'ROX_TEST_PG_URL', cleanup: async () => {} }
  : await startTempPostgres()
if (testDb) console.log(`[w1-09] notify tests use ${testDb.label}`)
else if (process.env.ROX_TEST_PG_REQUIRED === '1') throw new Error('ROX_TEST_PG_REQUIRED=1 but no Postgres is available (set ROX_TEST_PG_URL or put initdb/pg_ctl on PATH)')
else console.log('[w1-09] no Postgres available (set ROX_TEST_PG_URL or put initdb/pg_ctl on PATH): notify.pg tests skip')

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const GOAL = '11111111-1111-4111-8111-111111111111'
const SECRET = 'Confidential: the acquisition plan'

/** Payloads the reference handlers accept (validated, not assumed). */
const championPayload = z.object({ championId: z.string().min(1) })
const checkInPayload = z.object({
  reviewerId: z.string().min(1),
  subscriberIds: z.array(z.string().min(1)),
  notify: z.enum(['everyone', 'selected', 'none']),
  title: z.string().optional(),
})

/** Minimal goal reference handlers — W1-06 (#1503) binds the real ones. */
function referenceRegistry() {
  // `goals.checkins.v1` is the CHK module's flag (W1-06 registers it); the reference
  // handlers need it on, exactly as the real ones will.
  const registry = createWiredCommandRegistry({
    isFlagEnabled: flag => flag === 'goals.checkins.v1' || flag === 'goals.v1',
  })
  let revision = 0
  // #1615: `createWiredCommandRegistry()` now installs REFERENCE_COMMAND_MODULE
  // and DOMAIN_SCHEMA_COMMAND_MODULE, which already bound a handler and a strict
  // payload schema for these catalogue types. Release the handler (`bind` throws
  // on a second bind) and widen the schema so this fixture keeps receiving the
  // audience fields the notify fan-out reads.
  for (const type of ['goals.update_champion', 'goals.create_check_in']) {
    registry.unbind(type)
    registry.bindSchema(type, PLACEHOLDER_PAYLOAD_SCHEMA)
  }
  registry.bind('goals.update_champion', ctx => {
    const payload = championPayload.parse(ctx.payload)
    revision += 1
    return {
      ref: { kind: 'goal', id: GOAL },
      revision,
      events: [{ type: 'goals.goal_champion_updating', payload: { refs: [{ kind: 'goal', id: GOAL }], championId: payload.championId } }],
    }
  })
  registry.bind('goals.create_check_in', ctx => {
    const payload = checkInPayload.parse(ctx.payload)
    revision += 1
    return {
      ref: { kind: 'goal', id: GOAL },
      revision,
      events: [{
        type: 'goals.goal_check_in',
        payload: {
          refs: [{ kind: 'goal', id: GOAL }],
          reviewerId: payload.reviewerId,
          subscriberIds: payload.subscriberIds,
          allSubscriberIds: payload.subscriberIds,
          notify: payload.notify,
          // The restricted fields a real check-in carries: they must never reach a notification.
          title: payload.title,
          body: payload.title,
        },
      }],
    }
  })
  return registry
}

interface ProvisionedAccount { login: string; principalId: string }
interface HttpResult { status: number; body: unknown }
/** `/v1/auth/local/token` (the composed server's local-bootstrap route). */
const tokenResponse = z.object({ token: z.string().min(1) })

interface NotifyFixture {
  database: SQL
  schema: string
  workspaceId: string
  notifications: InMemoryNotificationStore
  /** The committed-event relay of the composed bus (`idle()` = every sink drained). */
  relay: DomainEventRelay
  editor: ProvisionedAccount
  champion: ProvisionedAccount
  reviewer: ProvisionedAccount
  subscriber: ProvisionedAccount
  outsider: ProvisionedAccount
  http(path: string, token?: string, body?: unknown): Promise<HttpResult>
  token(login: string): Promise<string>
  post(path: string, token: string, body: unknown): Promise<{ status: number; body: CommandReceipt }>
  ws(token: string): Promise<{ client: WsRpcClient; frames: RealtimeEventFrame[] }>
}

async function fixture(options: { notify?: boolean } = {}): Promise<NotifyFixture> {
  const database = new SQL(testDb!.url, { max: 12 })
  const schema = 'w109_notify_' + randomBytes(6).toString('hex')
  const directory = await mkdtemp(join(tmpdir(), 'w109-notify-'))
  const issuer = 'urn:rox:w109-notify:' + randomUUID()
  const password = 'synthetic-w109-' + randomUUID()
  const workspaceId = randomUUID()
  const notifications = new InMemoryNotificationStore()
  const clients: WsRpcClient[] = []
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  const migrations = await loadWorkspaceBootstrapMigrations(resolve(import.meta.dir, '../migrations'))
  const service = await createWorkspaceServer({
    database, schema, migrations, host: '127.0.0.1', port: 0, serverId: 'w109-' + schema,
    authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience: 'rox-w109-test',
      stateDirectory: directory, checkoutDirectory: process.cwd(), tokenLifetimeSeconds: 300 } },
    commandBus: {
      registry: referenceRegistry(),
      ...(options.notify === false ? {} : { notify: { store: notifications } }),
    },
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
    const { principalId } = await service.identity.provisionAccount(login, password)
    return { login, principalId }
  }
  const [editor, champion, reviewer, subscriber, outsider] = await Promise.all([
    account('editor'), account('champion'), account('reviewer'), account('subscriber'), account('outsider'),
  ])
  await service.repository.provisionWorkspace(editor!.principalId, workspaceId, 'W1-09 notify workspace')
  const members = [champion, reviewer, subscriber, outsider]
  for (const member of members) {
    await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceId, member.principalId])
  }
  const base = `http://127.0.0.1:${service.server.port}`
  async function http(path: string, token?: string, body?: unknown): Promise<HttpResult> {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : {} }
  }
  async function token(login: string): Promise<string> {
    const response = await http('/v1/auth/local/token', undefined, { login, password })
    expect(response.status).toBe(200)
    return tokenResponse.parse(response.body).token
  }
  async function ws(tokenValue: string) {
    const client = new WsRpcClient(`ws://127.0.0.1:${service.server.port}`, { token: tokenValue, workspaceId, mode: 'remote', autoReconnect: false, connectTimeout: 2000, requestTimeout: 5000 })
    clients.push(client)
    const connected = Promise.withResolvers<void>()
    const off = client.onConnectionStateChanged(state => {
      if (state.status === 'connected') { off(); connected.resolve() }
      else if (state.status === 'failed' || state.status === 'disconnected') { off(); connected.reject(new Error('handshake denied')) }
    })
    client.connect()
    await connected.promise
    const frames: RealtimeEventFrame[] = []
    client.on(REALTIME_RPC.EVENT, (ws: string, frame: RealtimeEventFrame) => { if (ws === workspaceId) frames.push(frame) })
    return { client, frames }
  }
  return {
    database, schema, workspaceId, notifications, relay: service.commandBus!.relay,
    editor: editor!, champion: champion!, reviewer: reviewer!, subscriber: subscriber!, outsider: outsider!,
    http,
    token,
    post: async (path, tokenValue, body) => {
      const response = await http(path, tokenValue, body)
      return { status: response.status, body: commandReceiptSchema.parse(response.body) }
    },
    ws,
  }
}

const envelope = (type: string, payload: unknown) =>
  ({ commandId: randomUUID(), type, payload, issuedAt: new Date().toISOString() })

describe.skipIf(!testDb)('W1-09 notify on the composed workspace service (PostgreSQL)', () => {
  // The fixture creates a schema, applies every migration and boots the composed
  // server, so the per-test budget is larger than bun's 5 s default.
  test('a reference goal update notifies the champion, the reviewer and the subscribers — and nobody else', async () => {
    const f = await fixture()
    const commandsPath = `/v1/workspaces/${f.workspaceId}/commands`
    const listPath = `/v1/workspaces/${f.workspaceId}/notifications`
    const editorToken = await f.token(f.editor.login)
    const reviewerToken = await f.token(f.reviewer.login)
    const outsiderToken = await f.token(f.outsider.login)
    const reviewer = await f.ws(reviewerToken)
    const subscribed = await reviewer.client.invoke(REALTIME_RPC.SUBSCRIBE, f.workspaceId, { topics: [{ topic: `user:${f.reviewer.principalId}` }] }) as RealtimeSubscribeResult
    expect(subscribed.topics[0]).toMatchObject({ status: 'subscribed' })
    const createdFrame = waitForFrame(reviewer.client, 'notification.created')

    // The W1-05 DDL is applied by the real bootstrap loader (the in-memory store mirrors it).
    const [ddl] = await f.database.unsafe<{ n: string }[]>(`SELECT count(*)::text AS n FROM "${f.schema}".notification`)
    expect(ddl?.n).toBe('0')

    const champion = await f.post(commandsPath, editorToken, envelope('goals.update_champion', { championId: f.champion.principalId }))
    expect(champion.status).toBe(200)
    expect(champion.body).toMatchObject({ status: 'applied' })
    const checkIn = await f.post(commandsPath, editorToken, envelope('goals.create_check_in', {
      reviewerId: f.reviewer.principalId,
      subscriberIds: [f.subscriber.principalId],
      notify: 'everyone',
      title: SECRET,
    }))
    expect(checkIn.status).toBe(200)
    expect(checkIn.body).toMatchObject({ status: 'applied' })

    await f.relay.idle()
    expect(f.notifications.all(f.workspaceId, f.champion.principalId).map(row => row.kind)).toEqual(['assignment'])
    expect(f.notifications.all(f.workspaceId, f.reviewer.principalId).map(row => row.kind)).toEqual(['check_in_submitted'])
    expect(f.notifications.all(f.workspaceId, f.subscriber.principalId).map(row => row.kind)).toEqual(['check_in_submitted'])
    // The editor authored both commands; the outsider is in neither audience.
    expect(f.notifications.all(f.workspaceId, f.editor.principalId)).toEqual([])
    expect(f.notifications.all(f.workspaceId, f.outsider.principalId)).toEqual([])

    const reviewerRow = f.notifications.all(f.workspaceId, f.reviewer.principalId)[0]!
    expect(reviewerRow).toMatchObject({
      workspaceId: f.workspaceId,
      kind: 'check_in_submitted',
      subject: { kind: 'goal', id: GOAL },
      actorId: f.editor.principalId,
      schemaVersion: 1,
    })
    expect(reviewerRow.emailState).toBeUndefined()
    // No restricted content: the title and the body never leave the command payload.
    expect(JSON.stringify(reviewerRow.payload)).not.toContain('Confidential')
    expect(reviewerRow.payload).toEqual({ refs: [{ kind: 'goal', id: GOAL }] })

    // Live push on `user:{id}` — the reviewer's own topic only.
    const pushed = await createdFrame
    expect(pushed).toMatchObject({ topic: `user:${f.reviewer.principalId}`, payload: { notification: { notificationId: reviewerRow.notificationId, kind: 'check_in_submitted' } } })
    expect(JSON.stringify(pushed.payload)).not.toContain('Confidential')
    expect(reviewer.frames.filter(frame => frame.type === 'notification.created').map(frame => frame.topic))
      .toEqual([`user:${f.reviewer.principalId}`])

    // The Inbox route is reachable only because the composition root configured notify.
    const listed = await f.http(listPath, reviewerToken)
    expect(listed.status).toBe(200)
    const page = notificationListResultSchema.parse(listed.body)
    expect(page).toMatchObject({ unread: 1 })
    expect(page.notifications).toHaveLength(1)
    expect(page.notifications[0]).toMatchObject({ notificationId: reviewerRow.notificationId, principalId: f.reviewer.principalId })
    expect(await f.http(listPath)).toMatchObject({ status: 401 })
    // Another principal sees their own (empty) list, never the reviewer's.
    expect(notificationListResultSchema.parse((await f.http(listPath, outsiderToken)).body)).toMatchObject({ unread: 0, notifications: [] })

    // Mark-read over the route; the same state travels back on `user:{id}`.
    const readFrame = waitForFrame(reviewer.client, 'notification.read')
    const read = await f.http(`${listPath}/read`, reviewerToken, { all: true })
    expect(read.status).toBe(200)
    expect(notificationReadResultSchema.parse(read.body)).toMatchObject({ updated: 1, unread: 0 })
    expect(f.notifications.all(f.workspaceId, f.reviewer.principalId)[0]?.readAt).toBeString()
    expect(await readFrame).toMatchObject({
      topic: `user:${f.reviewer.principalId}`,
      payload: { all: true, unread: 0 },
    })
    expect(notificationListResultSchema.parse((await f.http(listPath, reviewerToken)).body)).toMatchObject({ unread: 0 })
  }, 30_000)

  test('without the notify module the two paths answer 404 and nothing is fanned out', async () => {
    const f = await fixture({ notify: false })
    const editorToken = await f.token(f.editor.login)
    const applied = await f.post(`/v1/workspaces/${f.workspaceId}/commands`, editorToken, envelope('goals.create_check_in', {
      reviewerId: f.reviewer.principalId,
      subscriberIds: [f.subscriber.principalId],
      notify: 'everyone',
    }))
    expect(applied).toMatchObject({ status: 200, body: { status: 'applied' } })
    await f.relay.idle()
    expect(f.notifications.all(f.workspaceId)).toEqual([])
    expect(await f.http(`/v1/workspaces/${f.workspaceId}/notifications`, editorToken)).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } })
    expect(await f.http(`/v1/workspaces/${f.workspaceId}/notifications/read`, editorToken, { all: true })).toMatchObject({ status: 404 })
  }, 30_000)
})