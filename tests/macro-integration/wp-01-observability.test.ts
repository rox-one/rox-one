import { afterEach, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../../apps/workspace-service/src/server.ts'
import { loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a structured response')
  return Object.fromEntries(Object.entries(value))
}
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('Expected response string'); return value }
function required<T>(value: T | undefined): T { if (value === undefined) throw new Error('Missing persisted test row'); return value }

async function fixture() {
  const url = await loadProtectedWorkspaceDatabaseUrl(process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents/state/rox-compound-workspace/postgres-environment.json'))
  const database = new SQL(url, { max: 12 })
  const schema = 'wp01_counters_' + randomBytes(6).toString('hex')
  const directory = await mkdtemp(join(tmpdir(), 'rox-counter-test-'))
  const stateDirectory = join(directory, 'issuer')
  const issuer = 'urn:rox:counters:' + randomUUID()
  const audience = 'rox-counter-test'
  const workspaceId = randomUUID()
  const workspaceName = 'Counter workspace ' + randomUUID()
  const password = 'Synthetic-only-password-' + randomUUID()
  const login = randomUUID() + '@example.invalid'
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  const service = await createWorkspaceServer({ database, schema, port: 0, host: '127.0.0.1', serverId: schema,
    migrations: await loadWorkspaceBootstrapMigrations(resolve(import.meta.dir, '../../apps/workspace-service/migrations')),
    authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience,
      stateDirectory, checkoutDirectory: process.cwd(), tokenLifetimeSeconds: 300 } } })
  cleanups.push(async () => {
    service.server.close()
    try { await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`) }
    finally { await database.close(); await rm(directory, { recursive: true, force: true }) }
  })
  await service.server.listen()
  const account = await service.identity.provisionAccount(login, password)
  await service.repository.provisionWorkspace(account.principalId, workspaceId, workspaceName)
  const tokenResponse = await fetch(`http://127.0.0.1:${service.server.port}/v1/auth/local/token`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) })
  expect(tokenResponse.status).toBe(200)
  const parsed: unknown = await tokenResponse.json()
  const token = string(object(parsed).token)
  async function call(body: unknown, port = service.server.port) {
    const response = await fetch(`http://127.0.0.1:${port}/v1/workspaces/${workspaceId}/commands/project.createShared`, {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    })
    const value: unknown = await response.json()
    return { status: response.status, value }
  }
  function command(name: string) {
    return { commandId: randomUUID(), schemaVersion: 2, workspaceId, idempotencyKey: randomUUID(), expectedRevision: '0',
      payload: { name, workspaceName, visibility: 'private' } }
  }
  return { database, schema, directory, stateDirectory, issuer, audience, url, service, token, login, password,
    account, workspaceId, workspaceName, call, command }
}

test('fixed counters follow actual committed/replayed/conflicting SQL branches; rollback never reports applied', async () => {
  const f = await fixture()
  const name = 'PRIVATE_COUNTER_TITLE_' + randomUUID()
  const command = f.command(name)
  const responses = await Promise.all(Array.from({ length: 6 }, () => f.call(command)))
  expect(responses.every(response => response.status === 200)).toBe(true)
  for (const response of responses) expect(response.value).toEqual(required(responses[0]).value)
  expect((await f.call({ ...command, payload: { ...command.payload, name: 'changed' } })).status).toBe(409)
  expect(f.service.observability.snapshot()).toMatchObject({ projectApplied: 1, projectReplayed: 5, projectConflicts: 1, projectFailed: 0 })
  await f.database.unsafe(`CREATE FUNCTION "${f.schema}".reject_project_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic rollback'; END $$`)
  await f.database.unsafe(`CREATE TRIGGER reject_project_event BEFORE INSERT ON "${f.schema}".project_event FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_project_event()`)
  const failed = await f.call(f.command('rolled back'))
  expect(failed.status).toBe(500)
  expect(failed.value).toEqual({ error: { code: 'INTERNAL_ERROR' } })
  const [persisted] = await f.database.unsafe<{ projects: number; receipts: number }[]>(`SELECT
    (SELECT count(*)::int FROM "${f.schema}".project) AS projects,
    (SELECT count(*)::int FROM "${f.schema}".project_create_receipt) AS receipts`)
  expect(persisted).toEqual({ projects: 1, receipts: 1 })
  const snapshot = f.service.observability.snapshot()
  expect(snapshot).toMatchObject({ projectApplied: 1, projectReplayed: 5, projectConflicts: 1, projectFailed: 1 })
  expect(Object.isFrozen(snapshot)).toBe(true)
  const text = JSON.stringify(snapshot)
  for (const secret of [name, f.token, f.login, f.password, command.commandId, command.idempotencyKey, f.workspaceId, f.account.principalId]) expect(text).not.toContain(secret)
  const unavailable = await fetch(`http://127.0.0.1:${f.service.server.port}/v1/observability`, { headers: { authorization: 'Bearer ' + f.token } })
  expect(unavailable.status).toBe(404)
  expect(await unavailable.text()).not.toContain('projectApplied')
}, 30000)

test('consumer exception rolls back effect/inbox/watermark; retry and exhausted inbox dedup are measured from durable state', async () => {
  const f = await fixture()
  await f.database.unsafe(`CREATE TABLE "${f.schema}".test_effect (event_id uuid PRIMARY KEY)`)
  const consumer = 'PRIVATE_CONSUMER_LABEL_' + randomUUID()
  await expect(f.service.repository.consumeNextEvent(consumer, async (tx, event) => {
    await tx.unsafe(`INSERT INTO "${f.schema}".test_effect VALUES ($1)`, [event.id])
    throw new Error('Synthetic consumer exception with PRIVATE_PAYLOAD')
  })).rejects.toThrow('Synthetic consumer exception')
  const [rollback] = await f.database.unsafe<{ effects: number; inbox: number; watermark: number }[]>(`SELECT
    (SELECT count(*)::int FROM "${f.schema}".test_effect) AS effects,
    (SELECT count(*)::int FROM "${f.schema}".project_event_inbox) AS inbox,
    (SELECT count(*)::int FROM "${f.schema}".project_projection_watermark) AS watermark`)
  expect(rollback).toEqual({ effects: 0, inbox: 0, watermark: 0 })
  expect(f.service.observability.snapshot()).toMatchObject({ consumerFailed: 1, consumerRetried: 0, consumerCommitted: 0 })
  expect(await f.service.repository.consumeNextEvent(consumer, async (tx, event) => {
    await tx.unsafe(`INSERT INTO "${f.schema}".test_effect VALUES ($1)`, [event.id])
  })).toBe(true)
  expect(await f.service.repository.consumeNextEvent(consumer, async () => { throw new Error('Dedup must skip effect') })).toBe(false)
  const [committed] = await f.database.unsafe<{ effects: number; inbox: number; watermark: number }[]>(`SELECT
    (SELECT count(*)::int FROM "${f.schema}".test_effect) AS effects,
    (SELECT count(*)::int FROM "${f.schema}".project_event_inbox) AS inbox,
    (SELECT count(*)::int FROM "${f.schema}".project_projection_watermark) AS watermark`)
  expect(committed).toEqual({ effects: 1, inbox: 1, watermark: 1 })
  const snapshot = f.service.observability.snapshot()
  expect(snapshot).toMatchObject({ consumerFailed: 1, consumerRetried: 1, consumerCommitted: 1, consumerEmptyPolls: 1, consumerInboxDeduplicatedPolls: 1 })
  expect(JSON.stringify(snapshot)).not.toContain(consumer)
  expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_PAYLOAD')
  const historic = snapshot.consumerCommitted
  await f.service.repository.consumeNextEvent('empty-' + randomUUID(), async () => {})
  expect(snapshot.consumerCommitted).toBe(historic)
}, 30000)

test('actual source CLI emits host-only fixed aggregates after graceful drain and resets process counters on restart', async () => {
  const f = await fixture()
  const command = f.command('CLI private title ' + randomUUID())
  expect((await f.call(command)).status).toBe(200)
  f.service.server.close()
  const configurationPath = join(f.directory, 'runtime.json')
  await writeFile(configurationPath, JSON.stringify({ schemaVersion: 1, database: { url: f.url }, schema: f.schema, serverId: f.schema,
    listen: { host: '127.0.0.1', port: 0 }, authentication: { mode: 'local-bootstrap', issuer: f.issuer, audience: f.audience,
      algorithms: ['EdDSA'], stateDirectory: f.stateDirectory, checkoutDirectory: process.cwd(), tokenLifetimeSeconds: 300 } }), { mode: 0o600 })
  await chmod(configurationPath, 0o600)
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../../apps/workspace-service/src/index.ts'), 'serve', '--config', configurationPath],
    { cwd: process.cwd(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const lines: Record<string, unknown>[] = []
  let ready: (port: number) => void = () => { throw new Error('CLI readiness not initialized') }
  const started = new Promise<number>(resolve => { ready = resolve })
  const output = (async () => {
    const reader = child.stdout.getReader(); const decoder = new TextDecoder(); let pending = ''
    for (;;) {
      const read = await reader.read(); if (read.done) break
      pending += decoder.decode(read.value, { stream: true })
      const parts = pending.split('\n'); pending = parts.pop() ?? ''
      for (const line of parts.filter(Boolean)) {
        const parsed: unknown = JSON.parse(line); const record = object(parsed); lines.push(record)
        if (record.event === 'listening' && typeof record.port === 'number') ready(record.port)
      }
    }
    if (pending.trim()) throw new Error('Incomplete CLI output')
  })()
  const errors = new Response(child.stderr).text()
  cleanups.push(async () => { if (child.exitCode === null) { child.kill('SIGKILL'); await child.exited }; await Promise.all([output, errors]) })
  const port = await Promise.race([started, Bun.sleep(10000).then(() => { throw new Error('CLI not ready') })])
  expect((await f.call(command, port)).status).toBe(200)
  expect((await f.call(command, port)).status).toBe(200)
  child.kill('SIGTERM')
  expect(await child.exited).toBe(0)
  await output
  expect(await errors).toBe('')
  const counts = required(lines.find(line => line.event === 'identity_counters'))
  expect(counts).toMatchObject({ projectApplied: 0, projectReplayed: 2, projectConflicts: 0, consumerCommitted: 0, consumerFailed: 0 })
  expect(required(lines[lines.length - 1]).event).toBe('stopped')
  const outputText = JSON.stringify(lines)
  for (const secret of [f.url, f.token, f.password, f.login, command.payload.name, command.commandId]) expect(outputText).not.toContain(secret)
}, 30000)
