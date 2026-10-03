import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createConnection } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeJwt, importJWK, SignJWT } from 'jose'
import { createWorkspaceHttpHandler, type WorkspaceHttpOptions } from '../../apps/workspace-service/src/http'
import { createLocalIssuer } from '../../apps/workspace-service/src/auth/local-issuer'
import { createVerifiedActorResolver } from '../../apps/workspace-service/src/auth/verified-actor'
import { PostgresIdentityAuth, loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity'
import { applyWorkspaceMigrations, migrationFromSource } from '../../apps/workspace-service/src/database/migrations'
import { IdentityCommands } from '../../apps/workspace-service/src/modules/identity/commands'
import { IdentityRepository } from '../../apps/workspace-service/src/modules/identity/repository'
import type { AuthenticatedActor, SharedProjectAuthority } from '../../packages/shared/src/workspace-domain/identity/contracts'

const schema = 'wp01_http_' + randomBytes(6).toString('hex')
const issuerId = 'urn:rox:http-test:' + randomUUID()
const audience = 'rox-workspace-http-test'
const password = 'synthetic-test-password-' + randomUUID()
let database: SQL
let state: string
let auth: PostgresIdentityAuth
let repository: IdentityRepository
let commands: IdentityCommands
let localIssuer: Awaited<ReturnType<typeof createLocalIssuer>>
let resolver: ReturnType<typeof createVerifiedActorResolver<AuthenticatedActor>>
let options: WorkspaceHttpOptions
let base: string
const servers: Server[] = []
let owner: { login: string; subject: string; principalId: string }
let member: typeof owner
let outsider: typeof owner

async function serve(settings: WorkspaceHttpOptions, peerOverride?: string): Promise<string> {
  const handler = createWorkspaceHttpHandler(settings)
  const server = createServer((req, res) => {
    if (peerOverride) Object.defineProperty(req.socket, 'remoteAddress', { value: peerOverride, configurable: true })
    handler(req, res)
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback test listener unavailable')
  return `http://127.0.0.1:${address.port}`
}

beforeAll(async () => {
  const url = await loadProtectedWorkspaceDatabaseUrl(process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json'))
  database = new SQL(url)
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  const names = ['01-domain-contract.sql', '01-local-auth-bootstrap.sql']
  await applyWorkspaceMigrations(database, await Promise.all(names.map(async name =>
    migrationFromSource(name, await readFile(join(import.meta.dir, '../../apps/workspace-service/migrations', name), 'utf8')))), schema)
  auth = new PostgresIdentityAuth(database, issuerId, schema)
  const account = async (kind: string) => {
    const login = kind + '-' + randomUUID() + '@example.org'
    return { login, ...await auth.provisionAccount(login, password) }
  }
  owner = await account('owner'); member = await account('member'); outsider = await account('outsider')
  state = await mkdtemp(join(tmpdir(), 'rox-wp01-http-'))
  localIssuer = await createLocalIssuer({ mode: 'local-bootstrap', issuer: issuerId, audience,
    stateDirectory: state, checkoutDirectory: process.cwd() }, auth)
  resolver = createVerifiedActorResolver<AuthenticatedActor>({ issuer: issuerId, audience, algorithms: ['EdDSA'],
    keySource: { jwks: localIssuer.jwks() } }, auth, auth, input => ({
    principalId: input.principalId, deviceId: input.deviceId, sessionId: input.sessionId,
    authenticatedWorkspaceIds: input.authenticatedWorkspaceIds, expiresAt: input.expiresAt,
  }))
  repository = new IdentityRepository(database, schema)
  commands = new IdentityCommands(repository)
  options = { authority: commands, actorResolver: resolver, publicJwks: localIssuer.jwks(), localIssuer }
  base = await serve(options)
}, 30000)

afterAll(async () => {
  await Promise.all(servers.map(async server => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing owned HTTP fixture listener')
    // Bun clears its listener handle in close(), so force-close first to cancel
    // rejected request bodies too. Node still uses its ordinary close callback.
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => {
      if (error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING' || server.listening)) reject(error)
      else resolve()
    }))
    expect(server.listening).toBe(false)
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: address.port })
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('HTTP fixture shutdown readback timed out')) }, 5000)
      socket.once('connect', () => {
        clearTimeout(timer); socket.destroy(); reject(new Error('Owned HTTP fixture listener still accepts connections'))
      })
      socket.once('error', error => {
        clearTimeout(timer); socket.destroy()
        if ('code' in error && error.code === 'ECONNREFUSED') resolve()
        else reject(error)
      })
    })
  }))
  if (database) { await database.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await database.close() }
  if (state) await rm(state, { recursive: true, force: true })
})

async function call(method: string, path: string, token?: string, body?: unknown, url = base) {
  const response = await fetch(url + path, { method, headers: {
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  return { status: response.status, headers: response.headers, text, value: JSON.parse(text) }
}

async function login(user = owner): Promise<string> {
  const result = await call('POST', '/v1/auth/local/token', undefined, { login: user.login, password })
  expect(result.status).toBe(200)
  expect(result.headers.get('cache-control')).toBe('no-store')
  expect(typeof result.value.token).toBe('string')
  return result.value.token
}

async function workspace() {
  const id = randomUUID()
  await repository.provisionWorkspace(owner.principalId, id, 'Synthetic HTTP workspace')
  await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [id, member.principalId])
  return { id, route: '/v1/workspaces/' + id, ownerToken: await login(), memberToken: await login(member) }
}

function command(id: string, name: string, visibility: 'private' | 'members' = 'private') {
  return { commandId: randomUUID(), schemaVersion: 2, workspaceId: id, idempotencyKey: randomUUID(),
    expectedRevision: '0', payload: { name, workspaceName: 'Synthetic HTTP workspace', visibility } }
}

function denied(result: Awaited<ReturnType<typeof call>>, status: number, code: string, forbidden: string[] = []) {
  expect(result.status).toBe(status)
  expect(result.value).toEqual({ error: { code } })
  for (const secret of forbidden) expect(result.text).not.toContain(secret)
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string in test response')
  return value
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object in test response')
  return value as Record<string, unknown>
}

function projectEntityIds(value: unknown): string[] {
  const items = requireRecord(value).items
  if (!Array.isArray(items)) throw new Error('Expected project items in test response')
  return items.map((item: unknown) => requireString(requireRecord(requireRecord(item).entity).entityId))
}

function requireStatus(status: number | undefined): number {
  if (status === undefined) throw new Error('HTTP test response has no status code')
  return status
}

/** Raw TCP retains malformed paths, duplicate headers and real chunked framing on Bun and Node. */
function wire(path: string, headers: string[], body: string | Buffer = '', method = 'GET', url = base,
  pauseAfterFirstByte?: () => Promise<void>): Promise<{ status: number; text: string }> {
  const target = new URL(url)
  const fields: string[] = ['Host', target.host, 'Connection', 'close', ...headers]
  const hasHeader = (name: string) => fields.some((field, index) => index % 2 === 0 && field.toLowerCase() === name)
  const bytes = typeof body === 'string' ? Buffer.from(body) : body
  const chunked = fields.some((field, index) => index % 2 === 0 && field.toLowerCase() === 'transfer-encoding'
    && fields[index + 1]?.toLowerCase() === 'chunked')
  if (bytes.length && !chunked && !hasHeader('content-length')) fields.push('Content-Length', String(bytes.length))
  const payload = chunked ? bytes.length
    ? Buffer.concat([Buffer.from(bytes.length.toString(16) + '\r\n'), bytes, Buffer.from('\r\n0\r\n\r\n')])
    : Buffer.from('0\r\n\r\n') : bytes
  const head = Buffer.from(`${method} ${path} HTTP/1.1\r\n`
    + fields.filter((_, index) => index % 2 === 0).map((field, index) => `${field}: ${fields[index * 2 + 1]}\r\n`).join('') + '\r\n')
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: target.hostname, port: Number(target.port) })
    const chunks: Buffer[] = []
    let received = 0
    let settled = false
    const timer = setTimeout(() => finish(undefined, new Error('Bounded HTTP wire response timed out')), 5000)
    function finish(value?: { status: number; text: string }, error?: unknown) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else if (value) resolve(value)
      else reject(new Error('HTTP wire response unavailable'))
    }
    function response(ended: boolean) {
      const bytes = Buffer.concat(chunks, received)
      const separator = bytes.indexOf('\r\n\r\n')
      if (separator < 0) {
        if (ended) throw new Error('Incomplete HTTP wire headers')
        return
      }
      const head = bytes.subarray(0, separator).toString('latin1')
      const statusMatch = /^HTTP\/1\.[01] ([0-9]{3})(?: |$)/m.exec(head)
      const status = requireStatus(statusMatch ? Number(statusMatch[1]) : undefined)
      const length = /^Content-Length:\s*([0-9]+)\s*$/im.exec(head)
      const body = bytes.subarray(separator + 4)
      if (length) {
        const expected = Number(length[1])
        if (body.length >= expected) finish({ status, text: body.subarray(0, expected).toString() })
        else if (ended) throw new Error('Incomplete HTTP wire body')
      } else if (ended) finish({ status, text: body.toString() })
    }
    socket.on('data', chunk => {
      received += chunk.length
      if (received > 1048576) { finish(undefined, new Error('HTTP wire response exceeded fixture bound')); return }
      chunks.push(chunk)
      try { response(false) } catch (error) { finish(undefined, error) }
    })
    socket.once('end', () => {
      if (!settled) { try { response(true) } catch (error) { finish(undefined, error) } }
    })
    socket.once('error', error => finish(undefined, error))
    socket.once('close', () => { if (!settled) finish(undefined, new Error('HTTP wire closed before response')) })
    socket.once('connect', () => {
      void (async () => {
        socket.write(head)
        if (pauseAfterFirstByte && payload.length) {
          socket.write(payload.subarray(0, 1))
          await pauseAfterFirstByte()
          if (!settled) socket.write(payload.subarray(1))
        } else socket.write(payload)
      })().catch(error => finish(undefined, error))
    })
  })
}

describe('WP-01 HTTP facade with real JWT and PostgreSQL authority', () => {
  test('credential issuance, public JWKS and command receipt preserve canonical identity on reload and concurrent retry', async () => {
    const f = await workspace()
    const keys = await call('GET', '/.well-known/jwks.json')
    expect(keys.status).toBe(200)
    expect(keys.value).toEqual(localIssuer.jwks())
    expect(keys.text).not.toContain('"d":')
    expect(keys.text).not.toContain(password)
    const input = command(f.id, 'PRIVATE_HTTP_RELOAD_' + randomUUID())
    const [a, b] = await Promise.all([call('POST', f.route + '/commands/project.createShared', f.ownerToken, input),
      call('POST', f.route + '/commands/project.createShared', f.ownerToken, input)])
    expect(a.status).toBe(200); expect(b.value).toEqual(a.value)
    expect(a.value.entity.entityId).toMatch(/^project:/)
    expect(a.value.data.ownerPrincipalId).toBe(owner.principalId)
    const canonical = await call('GET', f.route + '/projects/' + encodeURIComponent(a.value.entity.entityId), f.ownerToken)
    const raw = await call('GET', f.route + '/projects/' + a.value.entity.entityId.slice(8), f.ownerToken)
    expect(canonical.value).toEqual(raw.value)
    expect(raw.value.entity).toEqual(a.value.entity)
    const restarted = await serve({ ...options, authority: new IdentityCommands(new IdentityRepository(database, schema)) })
    expect((await call('GET', f.route + '/projects/' + a.value.entity.entityId, f.ownerToken, undefined, restarted)).value).toEqual(raw.value)
    const count = await database.unsafe(`SELECT count(*)::integer AS n FROM "${schema}".project WHERE workspace_id=$1`, [f.id])
    expect(count[0].n).toBe(1)
    denied(await call('POST', f.route + '/commands/project.createShared', f.ownerToken,
      { ...input, payload: { ...input.payload, name: 'different intent' } }), 409, 'IDEMPOTENCY_CONFLICT')
  })

  test('ACL-filtered list and event replay never disclose private project titles, refs or totals', async () => {
    const f = await workspace()
    const hidden = await call('POST', f.route + '/commands/project.createShared', f.ownerToken, command(f.id, 'PRIVATE_HTTP_MARKER_' + randomUUID()))
    const shared = await call('POST', f.route + '/commands/project.createShared', f.ownerToken, command(f.id, 'Shared synthetic project', 'members'))
    const ownerList = await call('GET', f.route + '/projects?limit=1', f.ownerToken)
    expect(ownerList.value.items).toHaveLength(1)
    expect(ownerList.value.nextCursor).toBeDefined()
    const next = await call('GET', f.route + '/projects?limit=1&cursor=' + ownerList.value.nextCursor, f.ownerToken)
    expect(next.value.items).toHaveLength(1)
    expect(new Set([ownerList.value.items[0].entity.entityId, next.value.items[0].entity.entityId]).size).toBe(2)
    const visible = await call('GET', f.route + '/projects', f.memberToken)
    expect(projectEntityIds(visible.value)).toEqual([shared.value.entity.entityId])
    expect(visible.text).not.toContain(hidden.value.data.name)
    expect(visible.text).not.toContain(hidden.value.entity.entityId)
    expect(visible.value).not.toHaveProperty('total')
    denied(await call('GET', f.route + '/projects/' + hidden.value.entity.entityId, f.memberToken), 403, 'FORBIDDEN', [hidden.value.data.name])
    denied(await call('GET', f.route + '/projects/' + randomUUID(), f.memberToken), 403, 'FORBIDDEN')
    denied(await call('GET', f.route + '/projects?cursor=' + ownerList.value.nextCursor, f.memberToken), 400, 'CURSOR_INVALID')
    const replay = await call('GET', f.route + '/events?limit=100', f.memberToken)
    expect(replay.status).toBe(200)
    expect(replay.value.events).toHaveLength(2)
    expect(replay.text).not.toContain(hidden.value.entity.entityId)
    expect(replay.text).not.toContain(hidden.value.data.name)
    const tail = await call('GET', f.route + '/events?cursor=' + replay.value.nextCursor, f.memberToken)
    expect(tail.value.events).toEqual([])
    denied(await call('GET', f.route + '/events?cursor=' + replay.value.nextCursor, f.ownerToken), 400, 'CURSOR_INVALID')
  })

  test('missing, forged, duplicated and token-selected identities fail without private response fields', async () => {
    const f = await workspace()
    const secret = 'PRIVATE_HTTP_DENIED_' + randomUUID()
    await call('POST', f.route + '/commands/project.createShared', f.ownerToken, command(f.id, secret))
    denied(await call('GET', f.route + '/projects'), 401, 'UNAUTHENTICATED', [secret, owner.principalId])
    const invalid = f.ownerToken.slice(0, -8) + 'AAAAAAAA'
    denied(await call('GET', f.route + '/projects', invalid), 401, 'UNAUTHENTICATED', [secret])
    const outsiderToken = await login(outsider)
    const privateJwk = JSON.parse(await readFile(join(state, 'issuer-ed25519.private.jwk'), 'utf8'))
    const signingKey = localIssuer.jwks().keys[0]
    if (!signingKey) throw new Error('Local test issuer has no signing key')
    const hostile = await new SignJWT({ ...decodeJwt(outsiderToken), principalId: owner.principalId,
      authenticatedWorkspaceIds: [f.id], roles: ['owner'] }).setProtectedHeader({ alg: 'EdDSA', kid: requireString(signingKey.kid) })
      .sign(await importJWK(privateJwk, 'EdDSA'))
    denied(await call('GET', f.route + '/projects', hostile), 403, 'FORBIDDEN', [secret])
    const duplicated = await wire(f.route + '/projects', ['Authorization', 'Bearer ' + f.ownerToken, 'Authorization', 'Bearer ' + outsiderToken])
    expect(duplicated.status).toBe(401)
    expect(duplicated.text).toBe('{"error":{"code":"UNAUTHENTICATED"}}')
  })

  test('unknown body/query fields, forged workspace scope and malformed routes cannot become Actor input', async () => {
    const f = await workspace()
    const input = command(f.id, 'strict payload')
    for (const extra of ['actor', 'principalId', 'authenticatedWorkspaceIds']) {
      denied(await call('POST', f.route + '/commands/project.createShared', f.ownerToken, { ...input, [extra]: owner.principalId }), 400, 'INVALID_PAYLOAD')
      denied(await call('GET', f.route + '/projects?' + extra + '=' + owner.principalId, f.ownerToken), 400, 'INVALID_PAYLOAD')
    }
    denied(await call('POST', f.route + '/commands/project.createShared', f.ownerToken,
      { ...input, workspaceId: randomUUID() }), 403, 'WORKSPACE_MISMATCH')
    denied(await call('GET', f.route + '/projects?workspaceId=' + f.id, f.ownerToken), 400, 'INVALID_PAYLOAD')
    denied(await call('GET', f.route + '/projects?limit=1&limit=2', f.ownerToken), 400, 'INVALID_PAYLOAD')
    denied(await call('GET', f.route + '/projects?limit=101', f.ownerToken), 400, 'INVALID_PAYLOAD')
    denied(await call('GET', f.route + '/projects?cursor=forged', f.ownerToken), 400, 'INVALID_PAYLOAD')
    denied(await call('GET', f.route + '/projects/project%3Abad', f.ownerToken), 400, 'INVALID_PAYLOAD')
    denied(await call('GET', f.route + '/projects/' + randomUUID() + '%2Fprivate', f.ownerToken), 400, 'INVALID_PAYLOAD')
    denied(await call('GET', f.route + '/unknown', f.ownerToken), 404, 'NOT_FOUND')
    denied(await call('POST', f.route + '/projects', f.ownerToken, {}), 405, 'METHOD_NOT_ALLOWED')
    const body = '{"actor":"forged"}'
    expect((await wire(f.route + '/projects', ['Authorization', 'Bearer ' + f.ownerToken,
      'Content-Length', String(Buffer.byteLength(body))], body)).status).toBe(400)
    expect((await wire(f.route + '/projects/../projects', ['Authorization', 'Bearer ' + f.ownerToken])).status).toBe(404)
    const count = await database.unsafe(`SELECT count(*)::integer AS n FROM "${schema}".project WHERE workspace_id=$1`, [f.id])
    expect(count[0].n).toBe(0)
  })

  test('body byte bounds, malformed UTF-8/JSON and content type return concrete safe errors', async () => {
    const f = await workspace()
    const small = await serve({ ...options, maxBodyBytes: 128 })
    denied(await call('POST', f.route + '/commands/project.createShared', f.ownerToken, command(f.id, 'x'.repeat(500)), small), 413, 'BODY_TOO_LARGE')
    for (const content of ['{invalid', '[]']) {
      const response = await wire(f.route + '/commands/project.createShared', ['Authorization', 'Bearer ' + f.ownerToken,
        'Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(content))], content, 'POST')
      expect(response.status).toBe(400)
      expect(response.text).toBe('{"error":{"code":"INVALID_PAYLOAD"}}')
    }
    const plain = await wire(f.route + '/commands/project.createShared', ['Authorization', 'Bearer ' + f.ownerToken,
      'Content-Type', 'text/plain', 'Content-Length', '2'], '{}', 'POST')
    expect(plain.status).toBe(415)
    const invalidUtf8 = await wire(f.route + '/commands/project.createShared', ['Authorization', 'Bearer ' + f.ownerToken,
      'Content-Type', 'application/json', 'Content-Length', '1'], Buffer.from([0xff]), 'POST')
    expect(invalidUtf8).toEqual({ status: 400, text: '{"error":{"code":"INVALID_PAYLOAD"}}' })
    const chunked = await wire(f.route + '/commands/project.createShared', ['Authorization', 'Bearer ' + f.ownerToken,
      'Content-Type', 'application/json', 'Transfer-Encoding', 'chunked'], JSON.stringify(command(f.id, 'x'.repeat(500))), 'POST', small)
    expect(chunked).toEqual({ status: 413, text: '{"error":{"code":"BODY_TOO_LARGE"}}' })
    const timeout = await serve({ ...options, bodyTimeoutMs: 30 })
    expect(await wire(f.route + '/commands/project.createShared', ['Authorization', 'Bearer ' + f.ownerToken,
      'Content-Type', 'application/json', 'Content-Length', '2'], '{', 'POST', timeout))
      .toEqual({ status: 408, text: '{"error":{"code":"REQUEST_TIMEOUT"}}' })
  })

  test('revocation during body receipt is revalidated before the persisted command', async () => {
    const f = await workspace()
    const authenticated = Promise.withResolvers<void>()
    const url = await serve({ ...options, actorResolver: {
      async authenticate(token) { const result = await resolver.authenticate(token); authenticated.resolve(); return result },
      revalidate: bound => resolver.revalidate(bound),
    } })
    const body = JSON.stringify(command(f.id, 'must not commit'))
    const response = wire(f.route + '/commands/project.createShared', ['Authorization', 'Bearer ' + f.ownerToken,
      'Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(body))], body, 'POST', url, async () => {
        await authenticated.promise
        await auth.revokeSession(requireString(decodeJwt(f.ownerToken).sid))
      })
    expect(await response).toEqual({ status: 401, text: '{"error":{"code":"UNAUTHENTICATED"}}' })
    expect((await database.unsafe(`SELECT count(*)::integer AS n FROM "${schema}".project WHERE workspace_id=$1`, [f.id]))[0].n).toBe(0)
  })

  test('session and membership revocation after a real query suppress already-read private data', async () => {
    const f = await workspace()
    const marker = 'PRIVATE_HTTP_OUTBOUND_' + randomUUID()
    await call('POST', f.route + '/commands/project.createShared', f.ownerToken, command(f.id, marker, 'members'))
    const withHook = (hook: (actor: AuthenticatedActor) => Promise<unknown>): SharedProjectAuthority => ({
      createSharedProject: (actor, id, body) => commands.createSharedProject(actor, id, body),
      getProject: (actor, id, body) => commands.getProject(actor, id, body),
      replayEvents: (actor, id, body) => commands.replayEvents(actor, id, body),
      async listProjects(actor, id, body) {
        if (!actor) throw new Error('Authority hook received no authenticated actor')
        const result = await commands.listProjects(actor, id, body)
        await hook(actor)
        return result
      },
    })
    const revoked = await serve({ ...options, authority: withHook(actor => auth.revokeSession(actor.sessionId)) })
    denied(await call('GET', f.route + '/projects', f.ownerToken, undefined, revoked), 401, 'UNAUTHENTICATED', [marker, owner.principalId])
    const membership = await serve({ ...options, authority: withHook(actor =>
      database.unsafe(`UPDATE "${schema}".workspace_member SET deleted_at=clock_timestamp() WHERE workspace_id=$1 AND principal_id=$2`, [f.id, actor.principalId])) })
    denied(await call('GET', f.route + '/projects', f.memberToken, undefined, membership), 403, 'FORBIDDEN', [marker, member.principalId])
    denied(await call('GET', f.route + '/events', f.memberToken), 403, 'FORBIDDEN', [marker])
  })

  test('internal errors and serialization failures never return DB details or private titles', async () => {
    const f = await workspace()
    const marker = 'PRIVATE_HTTP_SERIALIZATION_' + randomUUID()
    await call('POST', f.route + '/commands/project.createShared', f.ownerToken, command(f.id, marker))
    const decorate = (failure: 'throw' | 'cycle'): SharedProjectAuthority => ({
      createSharedProject: (actor, id, body) => commands.createSharedProject(actor, id, body),
      getProject: (actor, id, body) => commands.getProject(actor, id, body),
      replayEvents: (actor, id, body) => commands.replayEvents(actor, id, body),
      async listProjects(actor, id, body) {
        const result = await commands.listProjects(actor, id, body)
        if (failure === 'throw') throw new Error('SQL password=' + password + ' ' + marker)
        Object.assign(result, { unsafeCycle: result })
        return result
      },
    })
    for (const failure of ['throw', 'cycle'] as const) {
      const url = await serve({ ...options, authority: decorate(failure) })
      denied(await call('GET', f.route + '/projects', f.ownerToken, undefined, url), 500, 'INTERNAL_ERROR', [marker, password, schema])
    }
  })

  test('local credentials are explicitly configured and gated by socket peer, not forwarded headers', async () => {
    denied(await call('POST', '/v1/auth/local/token', undefined, { login: owner.login, password: 'wrong' }), 401, 'UNAUTHENTICATED', [password])
    denied(await call('POST', '/v1/auth/local/token', undefined, { login: owner.login, password, principalId: owner.principalId }), 400, 'INVALID_PAYLOAD')
    const disabled = await serve({ authority: commands, actorResolver: resolver })
    denied(await call('POST', '/v1/auth/local/token', undefined, { login: owner.login, password }, disabled), 404, 'NOT_FOUND')
    denied(await call('GET', '/.well-known/jwks.json', undefined, undefined, disabled), 404, 'NOT_FOUND')
    // Negative control changes transport peer metadata on an actual loopback test server.
    const nonlocal = await serve(options, '198.51.100.8')
    const body = JSON.stringify({ login: owner.login, password })
    const response = await wire('/v1/auth/local/token', ['Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(body)),
      'X-Forwarded-For', '127.0.0.1'], body, 'POST', nonlocal)
    expect(response.status).toBe(403)
    expect(response.text).toBe('{"error":{"code":"FORBIDDEN"}}')
    const secret = JSON.parse(await readFile(join(state, 'issuer-ed25519.private.jwk'), 'utf8'))
    expect(() => createWorkspaceHttpHandler({ ...options, publicJwks: { keys: [secret] } })).toThrow('public asymmetric JWKS')
  })
})
