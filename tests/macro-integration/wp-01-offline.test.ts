import { afterEach, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { createServer, request, type Server } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../../apps/workspace-service/src/server'
import { loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity'
import { createSharedProjectIntent } from '../../apps/electron/src/shared/project-authority'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected test response object')
  return Object.fromEntries(Object.entries(value))
}
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('Expected test response string'); return value }
function required<T>(value: T | undefined): T { if (value === undefined) throw new Error('Missing actual fixture'); return value }

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rox-offline-intent-'))
  const pathDirectory = join(directory, 'bin'); await mkdir(pathDirectory)
  await symlink(process.execPath, join(pathDirectory, 'bun'))
  // No security/secret-tool CLI is exposed. The actual existing v3 credentials.key fallback is isolated.
  const database = new SQL(await loadProtectedWorkspaceDatabaseUrl(process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents/state/rox-compound-workspace/postgres-environment.json')), { max: 12 })
  const schema = 'wp01_offline_' + randomBytes(6).toString('hex')
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  const issuer = 'urn:rox:offline:' + randomUUID()
  const audience = 'rox-offline-test'
  const migrations = await loadWorkspaceBootstrapMigrations(resolve(import.meta.dir, '../../apps/workspace-service/migrations'))
  let port = 0
  let service: Awaited<ReturnType<typeof createWorkspaceServer>> | undefined
  const current = () => required(service)
  async function start() {
    service = await createWorkspaceServer({ database, schema, migrations, host: '127.0.0.1', port, serverId: schema,
      authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience,
        stateDirectory: join(directory, 'issuer'), checkoutDirectory: process.cwd(), tokenLifetimeSeconds: 900 } } })
    await service.server.listen(); port = service.server.port
  }
  function stop() { current().server.close(); service = undefined }
  await start()
  const password = 'Synthetic-offline-' + randomUUID()
  const loginA = 'a-' + randomUUID() + '@example.invalid'
  const loginB = 'b-' + randomUUID() + '@example.invalid'
  const owner = await current().identity.provisionAccount(loginA, password)
  const member = await current().identity.provisionAccount(loginB, password)
  const workspaceId = randomUUID(); const otherWorkspace = randomUUID(); const workspaceName = 'Actual offline workspace ' + randomUUID()
  await current().repository.provisionWorkspace(owner.principalId, workspaceId, workspaceName)
  await current().repository.provisionWorkspace(member.principalId, otherWorkspace, 'Other actual workspace')
  await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id, principal_id, role) VALUES ($1,$2,'member')`, [workspaceId, member.principalId])
  const profile = join(directory, 'profile'); const localId = randomUUID()
  const sockets = new Set<WebSocket>()
  let proxy: Server | undefined
  let wsServer: WebSocketServer | undefined
  let dropReply = false
  let createFrames = 0
  async function proxyUrl() {
    proxy = createServer((req, res) => {
      const upstream = request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers }, reply => {
        res.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(res)
      })
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":{"code":"PROVIDER_UNAVAILABLE"}}') })
      req.pipe(upstream)
    })
    wsServer = new WebSocketServer({ noServer: true })
    const wire = wsServer
    proxy.on('upgrade', (req, socket, head) => wire.handleUpgrade(req, socket, head, client => wire.emit('connection', client)))
    wire.on('connection', downstream => {
      const upstream = new WebSocket(`ws://127.0.0.1:${port}`)
      sockets.add(upstream); sockets.add(downstream)
      const buffered: Array<{ data: WebSocket.RawData; binary: boolean }> = []
      const commands = new Set<string>()
      upstream.on('open', () => { for (const entry of buffered.splice(0)) upstream.send(entry.data, { binary: entry.binary }) })
      downstream.on('message', (data, binary) => {
        const parsed: unknown = JSON.parse(data.toString()); const message = object(parsed)
        if (message.type === 'request' && message.channel === 'domain.project.createShared') { ++createFrames; commands.add(string(message.id)) }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary })
        else buffered.push({ data, binary })
      })
      upstream.on('message', (data, binary) => {
        const parsed: unknown = JSON.parse(data.toString()); const message = object(parsed)
        if (dropReply && message.type === 'response' && commands.has(string(message.id))) {
          downstream.terminate(); upstream.terminate(); return // Cut only a real accepted command response.
        }
        if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary })
      })
      for (const socket of [upstream, downstream]) {
        socket.on('error', () => { upstream.terminate(); downstream.terminate() })
        socket.on('close', () => { sockets.delete(socket); if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate(); if (downstream.readyState !== WebSocket.CLOSED) downstream.terminate() })
      }
    })
    await new Promise<void>(resolve => required(proxy).listen(0, '127.0.0.1', resolve))
    const address = proxy.address(); if (!address || typeof address === 'string') throw new Error('Missing actual cut proxy address')
    return `http://127.0.0.1:${address.port}`
  }
  cleanups.push(async () => {
    for (const socket of sockets) socket.terminate()
    if (proxy) { proxy.closeAllConnections(); await new Promise<void>(resolve => required(proxy).close(() => resolve())) }
    wsServer?.close(); service?.server.close()
    try { await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`) }
    finally { await database.close(); await rm(directory, { recursive: true, force: true }) }
  })
  let serviceUrl = `http://127.0.0.1:${port}`
  function loginInput(login = loginA) { return { serviceUrl, workspaceId, workspaceName, login, password } }
  function spawn(mode: string, extra: Record<string, unknown> = {}) {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, 'wp-01-offline-child.ts')], {
      cwd: process.cwd(), env: { ...process.env, PATH: pathDirectory, ROX_CONFIG_DIR: profile }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    })
    child.stdin.write(JSON.stringify({ profile, localId, mode, ...extra })); child.stdin.end()
    return child
  }
  async function run(mode: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown> & { outputText: string }> {
    const child = spawn(mode, extra); const stdout = new Response(child.stdout).text(); const stderr = new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    const text = await stdout; expect(await stderr).not.toContain(password)
    const parsed: unknown = JSON.parse(required(text.trim().split('\n').filter(Boolean).at(-1)))
    const result = object(parsed); expect(result.failed).not.toBe(true)
    return { ...result, outputText: text }
  }
  async function killed(mode: string, extra: Record<string, unknown>, stage: string) {
    const child = spawn(mode, { ...extra, stopAt: stage })
    const errors = new Response(child.stderr).text()
    const reader = child.stdout.getReader(); const decoder = new TextDecoder(); let text = ''
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000)
    try {
      let hit = false
      for (;;) {
        const part = await reader.read(); if (part.done) break
        text += decoder.decode(part.value, { stream: true })
        for (const line of text.split('\n').filter(Boolean)) {
          try { const parsed: unknown = JSON.parse(line); const row = object(parsed); if (row.type === 'checkpoint' && row.stage === stage) hit = true } catch { /* Incomplete chunk. */ }
        }
        if (hit) break
      }
      expect(hit).toBe(true)
      child.kill('SIGKILL'); await child.exited; expect(child.signalCode).toBe('SIGKILL')
    } finally { clearTimeout(timeout); if (child.exitCode === null) { child.kill('SIGKILL'); await child.exited }; reader.releaseLock(); await errors }
  }
  async function counts() {
    const [row] = await database.unsafe<{ projects: number; receipts: number; events: number }[]>(`SELECT
      (SELECT count(*)::int FROM "${schema}".project WHERE workspace_id=$1) AS projects,
      (SELECT count(*)::int FROM "${schema}".project_create_receipt WHERE workspace_id=$1) AS receipts,
      (SELECT count(*)::int FROM "${schema}".project_event WHERE workspace_id=$1 AND type='project.created') AS events`, [workspaceId])
    return required(row)
  }
  return { directory, profile, localId, database, schema, owner, member, workspaceId, workspaceName, otherWorkspace,
    password, loginA, loginB, issuer, loginInput, run, killed, stop, start, counts, current, proxyUrl,
    setUrl(url: string) { serviceUrl = url }, setDrop(drop: boolean) { dropReply = drop }, frames: () => createFrames,
    command(name = 'PRIVATE_OFFLINE_' + randomUUID()) { return createSharedProjectIntent(localId, workspaceName, name, 'private') } }
}

test('actual encrypted queue persists before send; SIGKILL/new process/offline reload retain IDs, payload and verified scope; explicit retry applies once', async () => {
  const f = await fixture()
  expect(object((await f.run('seed-login', { loginInput: f.loginInput() })).mutation).ok).toBe(true)
  const command = f.command()
  f.stop()
  await f.killed('queue', { command }, 'queued-persisted')
  expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
  const restored = await f.run('get', { secrets: [command.payload.name, f.password] })
  const view = object(restored.view); expect(view.state).toBe('queued'); expect(view.eligible).toBe(true)
  expect(object(view.command)).toEqual({ ...command, workspaceId: f.workspaceId })
  const scope = object(restored.scope)
  expect(scope).toMatchObject({ issuer: f.issuer, principalId: f.owner.principalId, workspaceId: f.workspaceId })
  expect(typeof scope.sessionId).toBe('string'); expect(typeof scope.deviceId).toBe('string')
  expect(restored.plaintextLeak).toBe(false)
  const offlineTransport = await f.run('transport')
  expect(offlineTransport.transportState).toBe('unavailable')
  expect(object(offlineTransport.view)).toMatchObject({ state: 'queued', eligible: true })
  expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
  await f.start()
  expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
  const retried = await f.run('retry'); const applied = object(retried.result)
  expect(applied.state).toBe('applied')
  const receipt = object(applied.result); expect(receipt.commandId).toBe(command.commandId)
  expect(object(receipt.data).name).toBe(command.payload.name)
  expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
  expect(object((await f.run('retry')).result).state).toBe('none')
  expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
  const [persisted] = await f.database.unsafe<{ command_id: string; idempotency_key: string; request_hash: string }[]>(`SELECT command_id,idempotency_key,request_hash FROM "${f.schema}".project_create_receipt`)
  expect(persisted).toEqual({ command_id: command.commandId, idempotency_key: command.idempotencyKey, request_hash: string(receipt.requestHash) })
}, 60000)

test('real accepted WS response cut + main SIGKILL retains uncertain intent; fresh process recovers exact original receipt without duplicate', async () => {
  const f = await fixture(); f.setUrl(await f.proxyUrl())
  expect(object((await f.run('seed-login', { loginInput: f.loginInput() })).mutation).ok).toBe(true)
  const command = f.command(); expect(object((await f.run('queue', { command })).result).state).toBe('queued')
  f.setDrop(true)
  await f.killed('retry', {}, 'lost-reply-persisted')
  expect(f.frames()).toBe(1)
  expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
  const [stored] = await f.database.unsafe<{ result: unknown }[]>(`SELECT result FROM "${f.schema}".project_create_receipt`)
  const restored = await f.run('get'); expect(object(restored.view).state).toBe('uncertain')
  expect(object(object(restored.view).command)).toEqual({ ...command, workspaceId: f.workspaceId })
  f.setDrop(false)
  const retried = await f.run('retry'); expect(object(retried.result).state).toBe('applied')
  expect(object(retried.result).result).toEqual(required(stored).result)
  expect(f.frames()).toBe(2)
  expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
}, 60000)

test('offline cancellation survives process restart; conflicting drafts cannot replace immutable pending bytes or IDs', async () => {
  const f = await fixture(); await f.run('seed-login', { loginInput: f.loginInput() }); f.stop()
  const original = f.command(); await f.run('queue', { command: original })
  const conflicting = await f.run('queue', { command: f.command('another draft') })
  expect(object(conflicting.result)).toMatchObject({ state: 'blocked', code: 'IDEMPOTENCY_CONFLICT' })
  expect(object(object(conflicting.view).command)).toEqual({ ...original, workspaceId: f.workspaceId })
  expect(object((await f.run('cancel')).result).state).toBe('none')
  expect(object((await f.run('get')).view).state).toBe('none')
  await f.start(); expect(object((await f.run('retry')).result).state).toBe('none')
  expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
}, 60000)

test('live session revoke blocks retry durably without send; fresh same-user or other-principal sessions cannot view/replay old intent', async () => {
  const f = await fixture(); await f.run('seed-login', { loginInput: f.loginInput() })
  const command = f.command(); const queued = await f.run('queue', { command })
  const scope = object(queued.scope); await f.current().identity.revokeSession(string(scope.sessionId))
  const denied = await f.run('retry'); expect(object(denied.result)).toMatchObject({ state: 'blocked', code: 'UNAUTHENTICATED' })
  expect(object((await f.run('get')).view).state).toBe('blocked')
  expect(object((await f.run('login', { loginInput: f.loginInput() })).mutation).ok).toBe(true)
  const newSession = await f.run('retry'); expect(object(newSession.result).state).toBe('blocked'); expect(newSession.outputText).not.toContain(command.payload.name)
  expect(object((await f.run('login', { loginInput: f.loginInput(f.loginB) })).mutation).ok).toBe(true)
  const other = await f.run('retry'); expect(object(other.result).state).toBe('blocked'); expect(other.outputText).not.toContain(command.payload.name)
  expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
}, 60000)

test('wrong-password replacement remains quiesced with exact durable credential/config retained; foreign local scope/body Actor injection cannot enqueue', async () => {
  const f = await fixture(); const seeded = await f.run('seed-login', { loginInput: f.loginInput() })
  const command = f.command(); await f.run('queue', { command })
  const beforeConfig = createHash('sha256').update(await readFile(join(f.profile, 'config.json'))).digest('hex')
  const beforeStore = createHash('sha256').update(await readFile(join(f.profile, 'credentials.enc'))).digest('hex')
  const rejected = await f.run('wrong-login', { loginInput: { ...f.loginInput(f.loginB), password: 'wrong synthetic password' } })
  expect(object(rejected.mutation).ok).toBe(false); expect(object(rejected.view)).toMatchObject({ state: 'blocked', code: 'AUTH_FAILED' })
  expect(rejected.outputText).not.toContain(command.payload.name); expect(rejected.tokenDigest).toBe(seeded.tokenDigest)
  expect(createHash('sha256').update(await readFile(join(f.profile, 'config.json'))).digest('hex')).toBe(beforeConfig)
  expect(createHash('sha256').update(await readFile(join(f.profile, 'credentials.enc'))).digest('hex')).toBe(beforeStore)
  expect(object((await f.run('foreign-local', { foreignLocalId: randomUUID(), command })).result).state).toBe('blocked')
  await f.run('cancel')
  expect(object((await f.run('queue', { command: { ...command, actor: { principalId: f.owner.principalId } } })).result)).toMatchObject({ state: 'blocked', code: 'INVALID_PAYLOAD' })
  expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
}, 60000)

test('explicit disconnect removes pending/scope before credential; unknown encrypted intent formats are blocked and byte-preserved', async () => {
  const f = await fixture(); await f.run('seed-login', { loginInput: f.loginInput() }); await f.run('queue', { command: f.command() })
  const disconnected = await f.run('disconnect'); expect(object(disconnected.mutation).ok).toBe(true)
  expect(disconnected.pendingPresent).toBe(false); expect(disconnected.tokenDigest).toBe(null)
  expect(object((await f.run('retry')).result)).toEqual({ state: 'none', eligible: false })
  expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
  await f.run('login', { loginInput: f.loginInput() })
  const unknown = await f.run('future-format', { command: f.command() })
  expect(unknown.preserved).toBe(true)
  for (const key of ['view', 'queue', 'cancel']) expect(object(unknown[key])).toMatchObject({ state: 'blocked', code: 'CAPABILITY_UNAVAILABLE' })
}, 60000)


test('authenticated identity query rejects forged scope/query; current membership removal blocks queued retry and persists hidden terminal state', async () => {
  const f = await fixture(); await f.run('seed-login', { loginInput: f.loginInput() }); const command = f.command()
  const queued = await f.run('queue', { command }); const scope = object(queued.scope)
  expect(scope.principalId).toBe(f.owner.principalId)
  const identity = await f.run('identity-probes', { ownerId: f.owner.principalId, foreignWorkspace: f.otherWorkspace })
  expect(object(identity.own).status).toBe(200)
  expect(object(object(identity.own).value)).toEqual(scope)
  expect(object(identity.forged)).toEqual({ status: 400, value: { error: { code: 'INVALID_PAYLOAD' } } })
  expect(object(identity.foreign)).toEqual({ status: 403, value: { error: { code: 'FORBIDDEN' } } })
  await f.database.unsafe(`UPDATE "${f.schema}".workspace_member SET deleted_at=clock_timestamp() WHERE workspace_id=$1 AND principal_id=$2`, [f.workspaceId, f.owner.principalId])
  const denied = await f.run('retry'); expect(object(denied.result)).toMatchObject({ state: 'blocked', code: 'FORBIDDEN' })
  expect(denied.outputText).not.toContain(command.payload.name)
  const recovered = await f.run('get'); expect(object(recovered.view).state).toBe('blocked'); expect(recovered.outputText).not.toContain(command.payload.name)
  expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
}, 60000)

test('unknown encrypted scope proof is preserved and cannot be overwritten by queue/cancel or interpreted as empty', async () => {
  const f = await fixture(); await f.run('seed-login', { loginInput: f.loginInput() })
  const unknown = await f.run('future-binding', { command: f.command() })
  expect(unknown.preserved).toBe(true)
  for (const key of ['view', 'queue', 'cancel']) expect(object(unknown[key])).toMatchObject({ state: 'blocked', code: 'CAPABILITY_UNAVAILABLE' })
  expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
}, 60000)


test('verified replacement session/principal cannot view or replay a still-queued private draft; explicit discard allows a new request', async () => {
  const f = await fixture(); f.setUrl(await f.proxyUrl()); await f.run('seed-login', { loginInput: f.loginInput() })
  const command = f.command(); await f.run('queue', { command })
  expect(object((await f.run('login', { loginInput: f.loginInput() })).mutation).ok).toBe(true)
  const samePrincipal = await f.run('get')
  expect(object(samePrincipal.view)).toMatchObject({ state: 'blocked', code: 'WORKSPACE_MISMATCH' })
  expect(samePrincipal.outputText).not.toContain(command.payload.name)
  expect(object((await f.run('login', { loginInput: f.loginInput(f.loginB) })).mutation).ok).toBe(true)
  const otherPrincipal = await f.run('retry')
  expect(object(otherPrincipal.result)).toMatchObject({ state: 'blocked', code: 'WORKSPACE_MISMATCH' })
  expect(otherPrincipal.outputText).not.toContain(command.payload.name)
  expect(f.frames()).toBe(0)
  expect(await f.counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
  await f.run('cancel')
  expect(object((await f.run('get')).view)).toMatchObject({ state: 'none', eligible: true })
}, 60000)
