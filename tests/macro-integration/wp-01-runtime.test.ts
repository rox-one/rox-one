import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { decodeJwt, exportJWK, generateKeyPair } from 'jose'
import { loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity.ts'
import { loadRuntimeConfiguration, MAX_CONFIGURATION_BYTES } from '../../apps/workspace-service/src/configuration.ts'
import { WorkspaceRequestDrain } from '../../apps/workspace-service/src/index.ts'
import { WsRpcClient } from '../../packages/server-core/src/transport/client.ts'
import { DOMAIN_PROJECT_RPC } from '../../packages/shared/src/workspace-domain/identity/contracts.ts'

const CHECKOUT = resolve(import.meta.dir, '../..')
const SOURCE = join(CHECKOUT, 'apps/workspace-service/src/index.ts')
const BUILT = join(CHECKOUT, 'apps/workspace-service/dist/index.js')
const PROTECTED_DATABASE = process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
beforeAll(async () => {
  const build = Bun.spawn([process.execPath, 'run', 'build'], {
    cwd: join(CHECKOUT, 'apps/workspace-service'), stdout: 'pipe', stderr: 'pipe',
  })
  const stdout = new Response(build.stdout).text()
  const stderr = new Response(build.stderr).text()
  expect(await build.exited).toBe(0)
  await Promise.all([stdout, stderr])
}, 15000)

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected runtime response record')
  return Object.fromEntries(Object.entries(value))
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Expected runtime response string')
  return value
}
function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Missing runtime fixture')
  return value
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('Expected runtime response array'); return value }
function spawn(entry: string, args: readonly string[]) {
  return Bun.spawn([process.execPath, entry, ...args], { cwd: CHECKOUT, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
}
async function command(entry: string, args: readonly string[], input?: string) {
  const child = spawn(entry, args)
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  if (input !== undefined) child.stdin.write(input)
  child.stdin.end()
  const exitCode = await child.exited
  return { exitCode, stdout: await stdout, stderr: await stderr }
}
async function start(entry: string, path: string) {
  const child = spawn(entry, ['serve', '--config', path])
  child.stdin.end()
  let stdout = ''
  let stderr = ''
  const consume = async (stream: ReadableStream<Uint8Array>, receive: (value: string) => void) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    for (;;) { const next = await reader.read(); if (next.done) break; receive(decoder.decode(next.value, { stream: true })) }
    receive(decoder.decode())
  }
  const output = consume(child.stdout, value => { stdout += value })
  const errors = consume(child.stderr, value => { stderr += value })
  let stopped = false
  const stop = async () => {
    if (stopped) return
    if (child.exitCode === null) child.kill('SIGTERM')
    const code = await Promise.race([child.exited, Bun.sleep(15000).then(() => { throw new Error('Runtime shutdown timed out') })])
    await Promise.all([output, errors])
    stopped = true
    expect(code).toBe(0)
    expect(stdout).toContain('"event":"stopped"')
  }
  cleanups.push(async () => {
    if (!stopped && child.exitCode === null) { child.kill('SIGKILL'); await child.exited }
    await Promise.all([output, errors])
  })
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    for (const line of stdout.split('\n').filter(Boolean)) {
      const parsed: unknown = JSON.parse(line)
      const value = object(parsed)
      if (value.event === 'listening') {
        if (typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1) throw new Error('Invalid runtime listener port')
        return { child, port: value.port, protocol: value.protocol, stop,
          get stdout() { return stdout }, get stderr() { return stderr }, finished: async () => { await Promise.all([output, errors]) } }
      }
    }
    if (child.exitCode !== null) throw new Error('Runtime failed before listening; output is redacted')
    await Bun.sleep(10)
  }
  throw new Error('Runtime did not expose a real listener')
}
async function protectedDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'rox-runtime-test-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}
function syntheticConfiguration(directory: string, url = 'postgres://synthetic:CONFIG_SECRET_SENTINEL@127.0.0.1:1/synthetic') {
  return { schemaVersion: 1, database: { url }, schema: 'public', serverId: 'runtime-test',
    listen: { host: '127.0.0.1', port: 0 },
    authentication: { mode: 'local-bootstrap', issuer: 'urn:rox:runtime:' + randomUUID(), audience: 'rox-runtime',
      algorithms: ['EdDSA'], stateDirectory: join(directory, 'issuer'), checkoutDirectory: CHECKOUT, tokenLifetimeSeconds: 300 } }
}
async function writeConfiguration(directory: string, config: unknown, name = 'runtime.json') {
  const path = join(directory, name)
  await writeFile(path, JSON.stringify(config), { mode: 0o600 })
  return path
}
async function fixture(entry = SOURCE) {
  const directory = await protectedDirectory()
  const url = await loadProtectedWorkspaceDatabaseUrl(PROTECTED_DATABASE)
  const database = new SQL(url, { max: 12 })
  const schema = 'wp01_runtime_' + randomBytes(6).toString('hex')
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  cleanups.push(async () => { try { await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`) } finally { await database.close() } })
  const config = { ...syntheticConfiguration(directory, url), schema }
  const path = await writeConfiguration(directory, config)
  const password = 'synthetic-runtime-password-' + randomUUID()
  async function provision(label: string) {
    const login = label + '-' + randomUUID() + '@example.invalid'
    const result = await command(entry, ['bootstrap-account', '--config', path], JSON.stringify({ login, password }))
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain(login)
    expect(result.stdout).not.toContain(password)
    const account = object(JSON.parse(result.stdout))
    expect(Object.keys(account).sort()).toEqual(['event', 'principalId', 'subject'])
    expect(account.event).toBe('account_provisioned')
    return { login, principalId: string(account.principalId), subject: string(account.subject) }
  }
  const owner = await provision('owner')
  const other = await provision('other')
  expect(owner.principalId).not.toBe(other.principalId)
  const workspaceId = randomUUID()
  const workspaceName = 'Synthetic runtime workspace'
  const workspace = await command(entry, ['bootstrap-workspace', '--config', path], JSON.stringify({ ownerPrincipalId: owner.principalId, workspaceId, name: workspaceName }))
  expect(workspace.exitCode).toBe(0)
  expect(object(JSON.parse(workspace.stdout))).toEqual({ event: 'workspace_provisioned', workspaceId, ownerPrincipalId: owner.principalId })
  await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceId, other.principalId])
  let running = await start(entry, path)
  async function http(route: string, token?: string, body?: unknown) {
    const response = await fetch(`http://127.0.0.1:${running.port}${route}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) })
    const text = await response.text()
    const parsed: unknown = JSON.parse(text)
    return { status: response.status, body: parsed, text }
  }
  async function token(login: string) {
    const result = await http('/v1/auth/local/token', undefined, { login, password })
    expect(result.status).toBe(200)
    return string(object(result.body).token)
  }
  const ownerToken = await token(owner.login)
  const otherToken = await token(other.login)
  const base = '/v1/workspaces/' + workspaceId
  function createCommand() {
    return { commandId: randomUUID(), schemaVersion: 2, workspaceId, idempotencyKey: randomUUID(), expectedRevision: '0',
      payload: { name: 'PRIVATE_RUNTIME_' + randomUUID(), workspaceName, visibility: 'private' } }
  }
  async function counts() {
    const rows = await database.unsafe<{ projects: number; receipts: number; events: number }[]>(`SELECT
      (SELECT count(*)::integer FROM "${schema}".project) AS projects,
      (SELECT count(*)::integer FROM "${schema}".project_create_receipt) AS receipts,
      (SELECT count(*)::integer FROM "${schema}".project_event WHERE type='project.created') AS events`)
    return required(rows[0])
  }
  function redact() {
    expect(running.stdout + running.stderr).not.toContain(url)
    expect(running.stdout + running.stderr).not.toContain(password)
    expect(running.stdout + running.stderr).not.toContain(ownerToken)
    expect(running.stdout + running.stderr).not.toContain(owner.login)
  }
  return { directory, database, schema, config, path, owner, other, ownerToken, otherToken, password, workspaceId, base,
    http, createCommand, counts, redact, get running() { return running },
    async restart() { await running.stop(); redact(); running = await start(entry, path) } }
}

describe('WP-01 protected service runtime and actual subprocess persistence', () => {
  test('read admission drains actual operations and rejects subsequent work', async () => {
    const drain = new WorkspaceRequestDrain()
    expect(drain.begin()).toBe(true)
    let drained = false
    const complete = drain.quiesce().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    expect(drain.begin()).toBe(false)
    drain.end()
    await complete
    expect(drained).toBe(true)
    expect(() => drain.end()).toThrow('lifecycle mismatch')
  })

  test('protected config rejects modes, symlinks, oversized and invalid UTF-8 without secret output', async () => {
    const directory = await protectedDirectory()
    const config = syntheticConfiguration(directory)
    const path = await writeConfiguration(directory, config)
    const accepted = await loadRuntimeConfiguration(path)
    expect(accepted.workspace.authentication.mode).toBe('local-bootstrap')
    expect(accepted.workspace.port).toBe(0)
    await chmod(path, 0o644)
    await expect(loadRuntimeConfiguration(path)).rejects.toMatchObject({ code: 'CONFIGURATION_UNAVAILABLE' })
    await chmod(path, 0o600)
    const alias = join(directory, 'alias.json')
    await symlink(path, alias)
    await expect(loadRuntimeConfiguration(alias)).rejects.toMatchObject({ code: 'CONFIGURATION_UNAVAILABLE' })
    await expect(loadRuntimeConfiguration(directory)).rejects.toMatchObject({ code: 'CONFIGURATION_UNAVAILABLE' })
    await writeFile(path, Buffer.alloc(MAX_CONFIGURATION_BYTES + 1, 32))
    await expect(loadRuntimeConfiguration(path)).rejects.toMatchObject({ code: 'CONFIGURATION_UNAVAILABLE' })
    await writeFile(path, Buffer.from([0xff, 0xfe]))
    await expect(loadRuntimeConfiguration(path)).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' })
    const failed = await command(SOURCE, ['serve', '--config', path])
    expect(failed.exitCode).toBe(2)
    expect(failed.stdout).toBe('')
    expect(failed.stderr).toBe('{"error":{"code":"INVALID_CONFIGURATION"}}\n')
    expect(failed.stderr).not.toContain('CONFIG_SECRET_SENTINEL')
  })

  test('explicit algorithms, issuer, TLS and trusted public keys are mandatory', async () => {
    const directory = await protectedDirectory()
    const config = syntheticConfiguration(directory)
    const malformed: unknown[] = [
      { ...config, unexpected: 'CONFIG_SECRET_SENTINEL' },
      { ...config, authentication: undefined },
      { ...config, authentication: { ...config.authentication, algorithms: [] } },
      { ...config, authentication: { ...config.authentication, issuer: '' } },
      { ...config, listen: { host: '0.0.0.0', port: 0 } },
      { ...config, authentication: { mode: 'trusted-issuer', issuer: 'urn:test', audience: 'test', algorithms: ['EdDSA'],
        keySource: { jwksUri: 'http://remote.example.invalid/jwks' } } },
      { ...config, authentication: { mode: 'trusted-issuer', issuer: 'urn:test', audience: 'test', algorithms: ['EdDSA'],
        keySource: { jwks: { keys: [{ kty: 'OKP', crv: 'Ed25519', x: 'bad', d: 'CONFIG_SECRET_SENTINEL' }] } } } },
    ]
    for (const value of malformed) {
      const path = await writeConfiguration(directory, value)
      await expect(loadRuntimeConfiguration(path)).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' })
      const result = await command(SOURCE, ['serve', '--config', path])
      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('{"error":{"code":"INVALID_CONFIGURATION"}}\n')
    }
  }, 15000)

  test('trusted public RSA keys without optional alg import under the explicit configured algorithm', async () => {
    const directory = await protectedDirectory()
    const config = syntheticConfiguration(directory)
    const { publicKey } = await generateKeyPair('RS256')
    const key = await exportJWK(publicKey)
    const authentication = { mode: 'trusted-issuer', issuer: 'urn:configured-rsa', audience: 'rsa-test', algorithms: ['RS256'],
      keySource: { jwks: { keys: [key] } } }
    const path = await writeConfiguration(directory, { ...config, authentication })
    const accepted = await loadRuntimeConfiguration(path)
    expect(accepted.workspace.authentication.mode).toBe('trusted-issuer')
    await writeConfiguration(directory, { ...config, authentication: { ...authentication, keySource: { jwks: { keys: [{ ...key, kid: 42 }] } } } })
    await expect(loadRuntimeConfiguration(path)).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' })
    await writeConfiguration(directory, { ...config, authentication: { ...authentication, algorithms: ['EdDSA'] } })
    await expect(loadRuntimeConfiguration(path)).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' })
  })

  test('CLI argument and bounded stdin failures redact input before opening PostgreSQL', async () => {
    const directory = await protectedDirectory()
    const path = await writeConfiguration(directory, syntheticConfiguration(directory))
    for (const args of [['bootstrap-account', '--password', 'PASSWORD_SECRET_SENTINEL'], ['serve'], ['serve', '--config', path, 'EXTRA_SECRET_SENTINEL']]) {
      const result = await command(SOURCE, args)
      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('{"error":{"code":"INVALID_ARGUMENTS"}}\n')
    }
    for (const input of ['{"password":"PASSWORD_SECRET_SENTINEL"', 'x'.repeat(65537), JSON.stringify({ login: 'synthetic', password: 'PASSWORD_SECRET_SENTINEL', actor: 'forged' })]) {
      const result = await command(SOURCE, ['bootstrap-account', '--config', path], input)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe('{"error":{"code":"INVALID_ADMIN_INPUT"}}\n')
      expect(result.stdout).toBe('')
    }
    const failed = await command(SOURCE, ['serve', '--config', path])
    expect(failed.exitCode).toBe(1)
    expect(failed.stderr).toBe('{"error":{"code":"STARTUP_FAILED"}}\n')
    expect(failed.stdout).toBe('')
  }, 20000)

  test('actual source CLI provisions crypto accounts; WS and HTTP share authority; key/receipt/cursor survive full restart', async () => {
    const f = await fixture()
    const jwks = await f.http('/.well-known/jwks.json')
    expect(jwks.status).toBe(200)
    expect(jwks.text).not.toContain('"d":')
    const client = new WsRpcClient(`ws://127.0.0.1:${f.running.port}`, { token: f.ownerToken, workspaceId: f.workspaceId, mode: 'remote', autoReconnect: false, connectTimeout: 2000, requestTimeout: 5000 })
    cleanups.push(async () => { client.destroy() })
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('Runtime WS handshake timed out')) }, 3000)
      const off = client.onConnectionStateChanged(state => {
        if (state.status === 'connected') { clearTimeout(timer); off(); resolve() }
        else if (state.status === 'failed' || state.status === 'disconnected') { clearTimeout(timer); off(); reject(new Error('Runtime WS handshake denied')) }
      })
    })
    client.connect()
    await connected
    const input = f.createCommand()
    const receipt: unknown = await client.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, f.workspaceId, input)
    expect(object(receipt).status).toBe('applied')
    const entityId = string(object(object(receipt).entity).entityId)
    const read = await f.http(f.base + '/projects/' + encodeURIComponent(entityId), f.ownerToken)
    expect(read.status).toBe(200)
    expect(read.body).toEqual(object(receipt).data)
    const denied = await f.http(f.base + '/projects/' + encodeURIComponent(entityId), f.otherToken)
    expect(denied.status).toBe(403)
    expect(denied.text).not.toContain(input.payload.name)
    const page = await f.http(f.base + '/events?limit=1', f.ownerToken)
    const cursor = string(object(page.body).nextCursor)
    client.destroy()
    await f.restart()
    expect((await f.http('/.well-known/jwks.json')).body).toEqual(jwks.body)
    const replay = await f.http(f.base + '/commands/project.createShared', f.ownerToken, input)
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(receipt)
    expect((await f.http(f.base + '/projects/' + encodeURIComponent(entityId), f.ownerToken)).body).toEqual(read.body)
    const events = await f.http(f.base + '/events?cursor=' + cursor, f.ownerToken)
    expect(array(object(events.body).events)).toHaveLength(1)
    expect(events.text).not.toContain(input.payload.name)
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
    await f.running.stop()
    f.redact()
    const sessions = await f.database.unsafe<{ password_hash: string }[]>(`SELECT password_hash FROM "${f.schema}".bootstrap_auth_credential`)
    expect(sessions).toHaveLength(2)
    expect(sessions.every(row => row.password_hash.startsWith('$argon2id$') && !row.password_hash.includes(f.password))).toBe(true)
  }, 30000)

  test('SIGTERM keeps a command blocked on the real PostgreSQL transaction gate alive; release persists one durable receipt', async () => {
    const f = await fixture()
    let release: (() => void) | undefined
    let locked: (() => void) | undefined
    const wait = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { locked = resolve })
    const lock = f.database.begin(async tx => {
      await tx.unsafe(`SELECT session_id FROM "${f.schema}".bootstrap_auth_session WHERE session_id=$1 FOR UPDATE`, [string(decodeJwt(f.ownerToken).sid)])
      locked?.()
      await wait
    })
    cleanups.push(async () => { release?.(); await lock })
    await ready
    const input = f.createCommand()
    const request = f.http(f.base + '/commands/project.createShared', f.ownerToken, input)
    const deadline = Date.now() + 5000
    let blocked = false
    while (Date.now() < deadline) {
      const rows = await f.database<{ count: number }[]>`SELECT count(*)::integer AS count FROM pg_stat_activity
        WHERE cardinality(pg_blocking_pids(pid)) > 0 AND query LIKE ${'%' + '"' + f.schema + '".bootstrap_auth_session' + '%'}`
      if (required(rows[0]).count > 0) { blocked = true; break }
      await Bun.sleep(10)
    }
    expect(blocked).toBe(true)
    f.running.child.kill('SIGTERM')
    await Bun.sleep(100)
    expect(f.running.child.exitCode).toBeNull()
    release?.()
    await lock
    const result = await request
    expect(result.status).toBe(200)
    expect(await f.running.child.exited).toBe(0)
    await f.running.finished()
    expect(f.running.stdout).toContain('"event":"stopped"')
    await f.restart()
    const replay = await f.http(f.base + '/commands/project.createShared', f.ownerToken, input)
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(result.body)
    expect(await f.counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
    await f.running.stop()
    f.redact()
  }, 30000)

  test('trusted issuer has no credential fallback and pinned loopback JWKS verifies existing persisted sessions', async () => {
    const f = await fixture()
    const input = f.createCommand()
    const created = await f.http(f.base + '/commands/project.createShared', f.ownerToken, input)
    expect(created.status).toBe(200)
    const entityId = string(object(object(created.body).entity).entityId)
    const path = await writeConfiguration(f.directory, { ...f.config, authentication: {
      mode: 'trusted-issuer', issuer: f.config.authentication.issuer, audience: f.config.authentication.audience,
      algorithms: ['EdDSA'], keySource: { jwksUri: `http://127.0.0.1:${f.running.port}/.well-known/jwks.json`, allowLoopbackHttp: true },
    } }, 'trusted.json')
    const trusted = await start(SOURCE, path)
    const read = await fetch(`http://127.0.0.1:${trusted.port}${f.base}/projects/${encodeURIComponent(entityId)}`, {
      headers: { authorization: 'Bearer ' + f.ownerToken }, signal: AbortSignal.timeout(10000),
    })
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual(object(created.body).data)
    const unavailable = await fetch(`http://127.0.0.1:${trusted.port}/v1/auth/local/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: f.owner.login, password: f.password }),
    })
    expect(unavailable.status).toBe(404)
    expect(await unavailable.json()).toEqual({ error: { code: 'NOT_FOUND' } })
    const forbidden = await command(SOURCE, ['bootstrap-account', '--config', path], JSON.stringify({ login: f.owner.login, password: f.password }))
    expect(forbidden.exitCode).toBe(2)
    expect(forbidden.stdout).toBe('')
    expect(forbidden.stderr).toBe('{"error":{"code":"INVALID_ARGUMENTS"}}\n')
    await trusted.stop()
    expect(trusted.stdout + trusted.stderr).not.toContain(f.ownerToken)
    expect(trusted.stdout + trusted.stderr).not.toContain(f.password)
    await f.running.stop()
  }, 30000)

  test('actual HTTPS listener permits non-loopback binding only with protected TLS material and explicit public issuer keys', async () => {
    const f = await fixture()
    const input = f.createCommand()
    const created = await f.http(f.base + '/commands/project.createShared', f.ownerToken, input)
    const entityId = string(object(object(created.body).entity).entityId)
    const publicKeys = (await f.http('/.well-known/jwks.json')).body
    const certificateFile = join(f.directory, 'server.crt')
    const keyFile = join(f.directory, 'server.key')
    const openssl = Bun.spawn(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyFile, '-out', certificateFile, '-days', '1', '-subj', '/CN=localhost'], { stdout: 'pipe', stderr: 'pipe' })
    const opensslOutput = new Response(openssl.stdout).text()
    const opensslErrors = new Response(openssl.stderr).text()
    expect(await openssl.exited).toBe(0)
    await Promise.all([opensslOutput, opensslErrors])
    await chmod(certificateFile, 0o600)
    await chmod(keyFile, 0o600)
    const path = await writeConfiguration(f.directory, { ...f.config, listen: { host: '0.0.0.0', port: 0 },
      tls: { certificateFile, keyFile }, authentication: { mode: 'trusted-issuer',
        issuer: f.config.authentication.issuer, audience: f.config.authentication.audience, algorithms: ['EdDSA'],
        keySource: { jwks: publicKeys } } }, 'tls.json')
    const secure = await start(BUILT, path)
    expect(secure.protocol).toBe('https')
    const read = await fetch(`https://127.0.0.1:${secure.port}${f.base}/projects/${encodeURIComponent(entityId)}`, {
      headers: { authorization: 'Bearer ' + f.ownerToken }, tls: { rejectUnauthorized: false }, signal: AbortSignal.timeout(10000),
    })
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual(object(created.body).data)
    await secure.stop()
    expect(secure.stdout + secure.stderr).not.toContain(f.password)
    expect(secure.stdout + secure.stderr).not.toContain('PRIVATE KEY')
    await f.running.stop()
  }, 30000)

  test('built executable starts, retains public issuer key after restart and drains SIGINT', async () => {
    expect((await readFile(BUILT)).length).toBeGreaterThan(0)
    const f = await fixture(BUILT)
    const jwks = await f.http('/.well-known/jwks.json')
    await f.restart()
    expect((await f.http('/.well-known/jwks.json')).body).toEqual(jwks.body)
    f.running.child.kill('SIGINT')
    expect(await f.running.child.exited).toBe(0)
    await f.running.finished()
    expect(f.running.stdout).toContain('"event":"stopped"')
    f.redact()
  }, 30000)
})
