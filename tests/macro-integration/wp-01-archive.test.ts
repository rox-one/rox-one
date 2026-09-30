import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Parser } from 'tar'
import { archiveInventory } from '../../scripts/compliance/generate-sbom'
import { loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { DOMAIN_PROJECT_RPC } from '../../packages/shared/src/workspace-domain/identity/contracts'

// Explicit cold gate: the root supplies the final archive. This test NEVER
// builds or installs. Only the test driver imports checkout helpers; the child
// runs extracted bytes with absolute Bun, no install/env-file, isolated HOME,
// an empty PATH/NODE_PATH and no node_modules anywhere in its ancestor chain.
const CHECKOUT = resolve(import.meta.dir, '../..')
const MEMBERS = ['dist/index.js', 'migrations/01-domain-contract.sql', 'migrations/01-local-auth-bootstrap.sql',
  'LICENSE', 'NOTICE', 'notices/THIRD-PARTY-NOTICES.txt'] as const
const PROTECTED_DATABASE = process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents/state/rox-compound-workspace/postgres-environment.json')
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const enabled = process.env.ROX_WP01_ARCHIVE_E2E === '1'
const archivePath = process.env.ROX_WP01_ARCHIVE_PATH
const evidence = process.env.ROX_WP01_ARCHIVE_EVIDENCE_DIR ?? join(homedir(), 'Pictures/Shots/Agents', 'rox-wp01-archive-' + Date.now())
const secrets: string[] = []
const redact = (text: string) => secrets.reduce((value, secret) => value.split(secret).join('[redacted]'), text)
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted JWT]')
const cases: Record<string, unknown>[] = []
let archiveBytes: Buffer
let expected: Record<string, string>
let inputRevision = ''
let driverSha256: Record<string, string>
const DRIVER_SOURCES = ['tests/macro-integration/wp-01-archive.test.ts', 'scripts/compliance/generate-sbom.ts',
  'packages/server-core/src/transport/client.ts', 'apps/workspace-service/src/auth/postgres-identity.ts']

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected response record')
  return Object.fromEntries(Object.entries(value))
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Expected nonempty response string')
  return value
}
function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing cold fixture value')
  return value
}
function sourcePath(member: string): string {
  return join(CHECKOUT, member.startsWith('dist/') || member.startsWith('migrations/') ? 'apps/workspace-service' : '', member)
}
async function currentHashes(): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(MEMBERS.map(async member => [member, hash(await readFile(sourcePath(member)))])))
}
async function driverHashes(): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(DRIVER_SOURCES.map(async path => [path, hash(await readFile(join(CHECKOUT, path)))])))
}
function approvedBodies(bytes: Buffer): Map<string, Buffer> {
  const inventory = archiveInventory(bytes)
  if (JSON.stringify(inventory.map(item => item.path).sort()) !== JSON.stringify([...MEMBERS].sort())) {
    throw new Error('ARCHIVE_MEMBER_SET_MISMATCH')
  }
  for (const item of inventory) {
    if (item.sha256 !== expected[item.path]) throw new Error('ARCHIVE_MEMBER_HASH_MISMATCH:' + item.path)
  }
  const payload = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }) : bytes
  const bodies = new Map<string, Buffer>()
  const parser = new Parser({ strict: true, onReadEntry: entry => {
    const path = entry.path.replace(/^\.\//, '').replace(/\/$/, '')
    if (entry.type === 'Directory') { entry.resume(); return }
    if (entry.type !== 'File' || entry.linkpath || !MEMBERS.some(member => member === path)) throw new Error('ARCHIVE_ENTRY_UNSAFE')
    const chunks: Buffer[] = []
    entry.on('data', (chunk: Buffer) => chunks.push(chunk))
    entry.on('end', () => bodies.set(path, Buffer.concat(chunks)))
    entry.resume()
  } })
  parser.on('error', () => { throw new Error('ARCHIVE_PARSE_FAILED') })
  parser.end(payload)
  if (bodies.size !== MEMBERS.length) throw new Error('ARCHIVE_BODY_SET_MISMATCH')
  for (const member of MEMBERS) if (hash(present(bodies.get(member))) !== expected[member]) throw new Error('ARCHIVE_BODY_HASH_MISMATCH')
  return bodies
}
async function assertNoNodeModules(directory: string): Promise<void> {
  let ancestor = await realpath(directory)
  while (true) {
    let exists = false
    try { await lstat(join(ancestor, 'node_modules')); exists = true }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (exists) throw new Error('COLD_NODE_MODULES_FALLBACK_PRESENT')
    const parent = dirname(ancestor)
    if (parent === ancestor) return
    ancestor = parent
  }
}
async function unpack(bytes: Buffer, directory: string): Promise<string> {
  // Validate final bytes before creating payload files. Fixed allowlisted
  // paths are then written manually; tar never creates links or directories.
  const bodies = approvedBodies(bytes)
  const payload = join(directory, 'payload')
  await mkdir(payload, { mode: 0o700 })
  for (const member of MEMBERS) {
    const path = join(payload, member)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, present(bodies.get(member)), { flag: 'wx', mode: 0o644 })
    expect((await lstat(path)).isFile()).toBe(true)
    expect((await lstat(path)).isSymbolicLink()).toBe(false)
    expect(hash(await readFile(path))).toBe(expected[member])
  }
  await assertNoNodeModules(payload)
  return payload
}
async function ownedDirectory(): Promise<string> {
  return await realpath(await mkdtemp(join(tmpdir(), 'rox-wp01-archive-')))
}
async function removeOwned(directory: string): Promise<void> {
  const base = await realpath(tmpdir())
  if (!directory.startsWith(base + '/rox-wp01-archive-')) throw new Error('Owned cleanup scope mismatch')
  await rm(directory, { recursive: true, force: true })
}
interface ChildResult { exitCode: number; stdout: string; stderr: string }
function environment(directory: string): Record<string, string> {
  return { HOME: join(directory, 'private/home'), TMPDIR: directory, PATH: '', NODE_PATH: '', LANG: 'C.UTF-8', NODE_ENV: 'production',
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(directory, 'private/transpiler-cache') }
}
async function command(payload: string, directory: string, args: readonly string[], input?: string): Promise<ChildResult> {
  const child = Bun.spawn([process.execPath, '--no-install', '--no-env-file', join(payload, 'dist/index.js'), ...args],
    { cwd: payload, env: environment(directory), stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text()
  if (input !== undefined) child.stdin.write(input)
  child.stdin.end()
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000)
  try { return { exitCode: await child.exited, stdout: await stdout, stderr: await stderr } }
  finally { clearTimeout(timeout) }
}
interface Running {
  port: number; pid: number; stop(): Promise<void>; terminate(): Promise<void>; readback(): { stdout: string; stderr: string }
}
async function start(payload: string, directory: string, config: string): Promise<Running> {
  await assertNoNodeModules(payload)
  const child = Bun.spawn([process.execPath, '--no-install', '--no-env-file', join(payload, 'dist/index.js'), 'serve', '--config', config],
    { cwd: payload, env: environment(directory), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  let stdout = '', stderr = ''
  async function consume(stream: ReadableStream<Uint8Array>, receive: (value: string) => void) {
    const reader = stream.getReader(), decoder = new TextDecoder()
    for (;;) { const next = await reader.read(); if (next.done) return; receive(decoder.decode(next.value, { stream: true })) }
  }
  const outputs = [consume(child.stdout, value => { stdout += value }), consume(child.stderr, value => { stderr += value })]
  async function terminate() {
    if (child.exitCode === null) child.kill('SIGKILL')
    await child.exited; await Promise.all(outputs)
  }
  const deadline = Date.now() + 15000
  try {
    while (Date.now() < deadline) {
      for (const line of stdout.split('\n').filter(Boolean)) {
        const value = record(JSON.parse(line))
        if (value.event === 'listening' && typeof value.port === 'number' && value.protocol === 'http') {
          let stopped = false
          return { port: value.port, pid: child.pid, terminate, readback: () => ({ stdout, stderr }), stop: async () => {
            if (stopped) return
            if (child.exitCode === null) child.kill('SIGTERM')
            const timer = setTimeout(() => child.kill('SIGKILL'), 15000)
            try { expect(await child.exited).toBe(0); await Promise.all(outputs); expect(stdout).toContain('"event":"stopped"'); stopped = true }
            finally { clearTimeout(timer) }
          } }
        }
      }
      if (child.exitCode !== null) throw new Error('Cold bundle exited before listener; diagnostic: ' + redact(stderr))
      await Bun.sleep(20)
    }
    throw new Error('Cold bundle listener timeout')
  } catch (error) { await terminate(); throw error }
}
async function connect(token: string, workspaceId: string, port: number): Promise<WsRpcClient> {
  const client = new WsRpcClient('ws://127.0.0.1:' + port, { token, workspaceId, mode: 'remote', autoReconnect: false,
    connectTimeout: 3000, requestTimeout: 5000 })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('Cold real WS handshake timeout')) }, 5000)
      const off = client.onConnectionStateChanged(state => {
        if (state.status === 'connected') { clearTimeout(timer); off(); resolve() }
        else if (state.status === 'failed' || state.status === 'disconnected') { clearTimeout(timer); off(); reject(new Error('Cold real WS handshake denied')) }
      })
      client.connect()
    })
    return client
  } catch (error) { client.destroy(); throw error }
}
async function repack(directory: string, bodies: Map<string, Buffer>, omitted?: string): Promise<Buffer> {
  const contents = join(directory, 'candidate-source')
  await mkdir(contents, { recursive: true, mode: 0o700 })
  const members = MEMBERS.filter(member => member !== omitted)
  for (const member of members) { const path = join(contents, member); await mkdir(dirname(path), { recursive: true }); await writeFile(path, present(bodies.get(member))) }
  const path = join(directory, 'candidate.tgz')
  const tar = Bun.spawn(['/usr/bin/tar', '-czf', path, '-C', contents, ...members],
    { env: { COPYFILE_DISABLE: '1', LANG: 'C' }, stdout: 'pipe', stderr: 'pipe' })
  const stdout = new Response(tar.stdout).text(), stderr = new Response(tar.stderr).text()
  expect(await tar.exited).toBe(0); await Promise.all([stdout, stderr])
  return await readFile(path)
}
async function withCase(name: string, run: (directory: string, observation: Record<string, unknown>) => Promise<void>): Promise<void> {
  const directory = await ownedDirectory(), observation: Record<string, unknown> = { name, directory, startedAt: new Date().toISOString() }
  cases.push(observation)
  try { await run(directory, observation); observation.status = 'PASS' }
  catch (error) { observation.status = 'FAIL'; observation.error = redact(error instanceof Error ? error.message : String(error)); throw new Error(String(observation.error)) }
  finally { observation.finishedAt = new Date().toISOString(); await removeOwned(directory); observation.ownedDirectoryRemoved = true }
}

describe.skipIf(!enabled)('WP01 cold final archive, actual executable and protected PostgreSQL', () => {
  beforeAll(async () => {
    if (!archivePath || !isAbsolute(archivePath)) throw new Error('Explicit absolute ROX_WP01_ARCHIVE_PATH required')
    expect(isAbsolute(process.execPath)).toBe(true)
    await mkdir(evidence, { recursive: true })
    archiveBytes = await readFile(archivePath)
    expected = await currentHashes()
    driverSha256 = await driverHashes()
    const declared = process.env.ROX_WP01_ARCHIVE_EXPECTED_SHA256
    if (declared !== undefined) expect(hash(archiveBytes)).toBe(declared)
    const git = Bun.spawn(['/usr/bin/git', 'rev-parse', 'HEAD'], { cwd: CHECKOUT, stdout: 'pipe', stderr: 'pipe' })
    inputRevision = (await new Response(git.stdout).text()).trim(); await new Response(git.stderr).text(); expect(await git.exited).toBe(0)
    approvedBodies(archiveBytes)
    console.log('WP01 cold archive evidence: ' + evidence)
  }, 15000)
  afterAll(async () => {
    if (!archiveBytes || !expected) return
    const driverUnchanged = JSON.stringify(await driverHashes()) === JSON.stringify(driverSha256)
    const artifactUnchanged = JSON.stringify(await currentHashes()) === JSON.stringify(expected)
      && hash(await readFile(present(archivePath))) === hash(archiveBytes)
    const result = { at: new Date().toISOString(), status: cases.length === 3 && cases.every(item => item.status === 'PASS') ? 'PASS_COLD_ARCHIVE_FUNCTIONAL' : 'FAIL',
      inputRevision, archivePath, archiveSha256: hash(archiveBytes), expectedMemberSha256: expected, bunExecutable: process.execPath,
      driverSha256, driverUnchanged, artifactUnchanged, sourceBuildOrInstallExecuted: false, legalReleaseCleared: false, fullFeatureDoDComplete: false, cases }
    if (!driverUnchanged || !artifactUnchanged) result.status = 'FAIL'
    await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2))
    expect(driverUnchanged).toBe(true); expect(artifactUnchanged).toBe(true)
  })

  test('exact six-member archive runs cold; real two users, HTTP/WS private403, original receipt/counts/issuer survive restart', async () => {
    await withCase('actual-cold-two-user-restart', async (directory, observation) => {
      const payload = await unpack(archiveBytes, directory)
      await mkdir(join(directory, 'private/home'), { recursive: true, mode: 0o700 })
      const url = await loadProtectedWorkspaceDatabaseUrl(PROTECTED_DATABASE); secrets.push(url)
      const database = new SQL(url)
      const schema = 'wp01_archive_' + randomBytes(6).toString('hex')
      const password = 'owned-cold-synthetic-password-' + randomUUID(); secrets.push(password)
      const configPath = join(directory, 'private/service.json')
      const workspaceId = randomUUID(), workspaceName = 'Настоящий cold workspace'
      let schemaCreated = false
      let running: Running | undefined
      const clients: WsRpcClient[] = [], transcripts: string[] = []
      async function counts() {
        const rows = await database.unsafe(`SELECT (SELECT count(*)::integer FROM "${schema}".project) AS projects,
          (SELECT count(*)::integer FROM "${schema}".project_create_receipt) AS receipts,
          (SELECT count(*)::integer FROM "${schema}".project_event WHERE type='project.created') AS events`)
        return present(rows[0])
      }
      async function provision(label: string) {
        const login = label + '-' + randomUUID() + '@example.invalid'; secrets.push(login)
        const result = await command(payload, directory, ['bootstrap-account', '--config', configPath], JSON.stringify({ login, password }))
        transcripts.push(result.stdout, result.stderr)
        expect(result.exitCode).toBe(0); expect(result.stderr).toBe('')
        const body = record(JSON.parse(result.stdout)); expect(body.event).toBe('account_provisioned')
        expect(Object.keys(body).sort()).toEqual(['event', 'principalId', 'subject'])
        return { login, principalId: text(body.principalId) }
      }
      async function http(path: string, token?: string, body?: unknown) {
        const response = await fetch('http://127.0.0.1:' + present(running).port + path, { method: body === undefined ? 'GET' : 'POST',
          headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) })
        const raw = await response.text(); return { status: response.status, raw, body: JSON.parse(raw) as unknown }
      }
      try {
        await database.unsafe(`CREATE SCHEMA "${schema}"`); schemaCreated = true
        await writeFile(configPath, JSON.stringify({ schemaVersion: 1, database: { url }, schema, serverId: 'cold-' + schema,
          listen: { host: '127.0.0.1', port: 0 }, authentication: { mode: 'local-bootstrap', issuer: 'urn:rox:cold:' + randomUUID(),
            audience: 'rox-cold-archive', algorithms: ['EdDSA'], stateDirectory: join(directory, 'private/issuer'),
            checkoutDirectory: payload, tokenLifetimeSeconds: 300 }, shutdownTimeoutSeconds: 10 }), { mode: 0o600 })
        expect((await lstat(configPath)).mode & 0o777).toBe(0o600)
        const owner = await provision('A'), other = await provision('B')
        expect(owner.principalId).not.toBe(other.principalId)
        const provisioned = await command(payload, directory, ['bootstrap-workspace', '--config', configPath],
          JSON.stringify({ ownerPrincipalId: owner.principalId, workspaceId, name: workspaceName }))
        transcripts.push(provisioned.stdout, provisioned.stderr); expect(provisioned.exitCode).toBe(0); expect(provisioned.stderr).toBe('')
        expect(record(JSON.parse(provisioned.stdout))).toEqual({ event: 'workspace_provisioned', workspaceId, ownerPrincipalId: owner.principalId })
        await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceId, other.principalId])
        expect(await counts()).toEqual({ projects: 0, receipts: 0, events: 0 })
        running = await start(payload, directory, configPath)
        const ownerLogin = await http('/v1/auth/local/token', undefined, { login: owner.login, password })
        const otherLogin = await http('/v1/auth/local/token', undefined, { login: other.login, password })
        expect(ownerLogin.status).toBe(200); expect(otherLogin.status).toBe(200)
        const ownerToken = text(record(ownerLogin.body).token), otherToken = text(record(otherLogin.body).token); secrets.push(ownerToken, otherToken)
        const jwks = await http('/.well-known/jwks.json'); expect(jwks.status).toBe(200)
        expect(jwks.raw.includes('"d":')).toBe(false)
        const ownerClient = await connect(ownerToken, workspaceId, running.port), otherClient = await connect(otherToken, workspaceId, running.port)
        clients.push(ownerClient, otherClient)
        const input = { commandId: randomUUID(), schemaVersion: 2, workspaceId, idempotencyKey: randomUUID(), expectedRevision: '0',
          payload: { name: 'ПРИВАТНЫЙ_COLD_' + randomUUID(), workspaceName, visibility: 'private' } }
        const receipt = record(await ownerClient.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, workspaceId, input))
        expect(receipt.status).toBe('applied'); expect(receipt.commandId).toBe(input.commandId); expect(receipt.receiptId).toBeTruthy()
        const entity = record(receipt.entity), entityId = text(entity.entityId)
        expect(entity.workspaceId).toBe(workspaceId); expect(entityId).toMatch(/^project:[0-9a-f-]{36}$/)
        expect(record(receipt.data).name).toBe(input.payload.name)
        const base = '/v1/workspaces/' + workspaceId
        const read = await http(base + '/projects/' + encodeURIComponent(entityId), ownerToken)
        expect(read.status).toBe(200); expect(read.body).toEqual(receipt.data)
        const denied = await http(base + '/projects/' + encodeURIComponent(entityId), otherToken)
        expect(denied.status).toBe(403); expect(denied.body).toEqual({ error: { code: 'FORBIDDEN' } })
        expect(denied.raw.includes(input.payload.name)).toBe(false)
        const deniedWs = await otherClient.invoke(DOMAIN_PROJECT_RPC.GET, workspaceId, { entityId })
          .then(() => ({ rejected: false, code: '' }), error => ({ rejected: true, code: typeof error?.code === 'string' ? error.code : '' }))
        expect(deniedWs).toEqual({ rejected: true, code: 'FORBIDDEN' })
        const hiddenList = record(await otherClient.invoke(DOMAIN_PROJECT_RPC.LIST, workspaceId, {}))
        expect(hiddenList.items).toEqual([]); expect(JSON.stringify(hiddenList).includes(input.payload.name)).toBe(false)
        expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
        const eventPage = record((await http(base + '/events?limit=1', ownerToken)).body), cursor = text(eventPage.nextCursor)
        ownerClient.destroy(); otherClient.destroy()
        await running.stop(); transcripts.push(running.readback().stdout, running.readback().stderr)
        const firstPid = running.pid
        running = await start(payload, directory, configPath); expect(running.pid).not.toBe(firstPid)
        expect((await http('/.well-known/jwks.json')).body).toEqual(jwks.body)
        const replay = await http(base + '/commands/project.createShared', ownerToken, input)
        expect(replay.status).toBe(200); expect(replay.body).toEqual(receipt)
        const restartedWs = await connect(ownerToken, workspaceId, running.port); clients.push(restartedWs)
        expect(await restartedWs.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, workspaceId, input)).toEqual(receipt)
        expect((await http(base + '/projects/' + encodeURIComponent(entityId), ownerToken)).body).toEqual(read.body)
        const deniedAfterRestart = await http(base + '/projects/' + encodeURIComponent(entityId), otherToken)
        expect(deniedAfterRestart.status).toBe(403); expect(deniedAfterRestart.raw.includes(input.payload.name)).toBe(false)
        const events = await http(base + '/events?cursor=' + cursor, ownerToken)
        expect(events.status).toBe(200); expect(record(events.body).events).toHaveLength(1); expect(events.raw.includes(input.payload.name)).toBe(false)
        expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
        const stored = await database.unsafe(`SELECT command_id,idempotency_key,result FROM "${schema}".project_create_receipt`)
        expect(stored).toHaveLength(1); expect(stored[0]?.command_id).toBe(input.commandId); expect(stored[0]?.idempotency_key).toBe(input.idempotencyKey)
        const credentials = await database.unsafe(`SELECT password_hash FROM "${schema}".bootstrap_auth_credential`)
        expect(credentials).toHaveLength(2); expect(credentials.every(row => typeof row.password_hash === 'string' && row.password_hash.startsWith('$argon2id$') && !row.password_hash.includes(password))).toBe(true)
        restartedWs.destroy(); await running.stop(); transcripts.push(running.readback().stdout, running.readback().stderr)
        const output = transcripts.join('\n'); for (const secret of secrets) expect(output.includes(secret)).toBe(false)
        await assertNoNodeModules(payload)
        expect(await currentHashes()).toEqual(expected)
        observation.proof = { absoluteBun: process.execPath, childFlags: ['--no-install', '--no-env-file'],
          isolatedCwd: payload, emptyPathAndNodePath: true, noNodeModulesAncestor: true, sixMemberSha256: expected,
          accounts: [owner.principalId, other.principalId], canonicalEntity: entity, commandId: input.commandId,
          idempotencyKey: input.idempotencyKey, receiptSha256: hash(JSON.stringify(receipt)), jwksSha256: hash(JSON.stringify(jwks.body)),
          originalReceiptAfterRealProcessRestart: true, counts: await counts(), privateHttpStatus: 403, privateWsCode: deniedWs.code,
          argon2idCredentialCount: credentials.length, childPids: [firstPid, running.pid], sourceBuildUnchanged: true }
        await writeFile(join(evidence, 'cold-subprocess.sanitized.log'), redact(output))
      } finally {
        for (const client of clients) client.destroy()
        if (running) await running.terminate()
        try { if (schemaCreated) await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`) }
        finally { await database.close() }
        observation.ownedSchemaDropped = true
      }
    })
  }, 60000)

  test('tampered real bundle archive is denied before cold launch; direct negative control executes changed bytes', async () => {
    await withCase('tampered-bundle-denied', async (directory, observation) => {
      const bodies = approvedBodies(archiveBytes)
      bodies.set('dist/index.js', Buffer.from("await Bun.write('unreviewed-bundle-executed.txt','actual altered executable ran'); process.exit(89);\n"))
      const candidate = await repack(directory, bodies)
      await expect(unpack(candidate, directory)).rejects.toThrow('ARCHIVE_MEMBER_HASH_MISMATCH:dist/index.js')
      let payloadExists = false
      try { await lstat(join(directory, 'payload')); payloadExists = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      expect(payloadExists).toBe(false)
      // Executing this actual changed file outside the gate proves that a
      // missing byte check would run arbitrary altered archive code.
      const source = join(directory, 'candidate-source')
      const control = await command(source, directory, [])
      expect(control.exitCode).toBe(89); expect(await readFile(join(source, 'unreviewed-bundle-executed.txt'), 'utf8')).toBe('actual altered executable ran')
      observation.proof = { candidateSha256: hash(candidate), deniedBeforePayloadCreation: true,
        actualBypassExit: control.exitCode, actualChangedExecutableRanInOwnedNegativeControl: true }
    })
  }, 20000)

  test('missing migration archive is denied; actual cold runtime cannot fall back to checkout migrations', async () => {
    await withCase('missing-migration-denied', async (directory, observation) => {
      const missing = 'migrations/01-local-auth-bootstrap.sql', bodies = approvedBodies(archiveBytes)
      const candidate = await repack(directory, bodies, missing)
      await expect(unpack(candidate, directory)).rejects.toThrow('ARCHIVE_MEMBER_SET_MISMATCH')
      let payloadExists = false
      try { await lstat(join(directory, 'payload')); payloadExists = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      expect(payloadExists).toBe(false)
      await mkdir(join(directory, 'private/home'), { recursive: true, mode: 0o700 })
      const configPath = join(directory, 'private/missing-migration.json')
      // Use a reachable genuine DB. An accidental checkout-migration fallback
      // would migrate this schema/open a listener and fail the negative gate;
      // an unreachable address could hide that defect behind STARTUP_FAILED.
      const url = await loadProtectedWorkspaceDatabaseUrl(PROTECTED_DATABASE); secrets.push(url)
      const database = new SQL(url), schema = 'wp01_archive_negative_' + randomBytes(6).toString('hex')
      let schemaCreated = false
      try {
        await database.unsafe(`CREATE SCHEMA "${schema}"`); schemaCreated = true
        expect((await database`SELECT 1 AS reachable`)[0]?.reachable).toBe(1)
        await writeFile(configPath, JSON.stringify({ schemaVersion: 1, database: { url }, schema, serverId: 'cold-negative',
          listen: { host: '127.0.0.1', port: 0 }, authentication: { mode: 'local-bootstrap', issuer: 'urn:rox:cold:negative', audience: 'cold-negative',
            algorithms: ['EdDSA'], stateDirectory: join(directory, 'private/issuer'), checkoutDirectory: join(directory, 'candidate-source'), tokenLifetimeSeconds: 300 } }), { mode: 0o600 })
        await assertNoNodeModules(join(directory, 'candidate-source'))
        const control = await command(join(directory, 'candidate-source'), directory, ['serve', '--config', configPath])
        expect(control.exitCode).toBe(1); expect(control.stdout).toBe(''); expect(control.stderr).toBe('{"error":{"code":"STARTUP_FAILED"}}\n')
        expect((control.stdout + control.stderr).includes(url)).toBe(false)
        const tables = await database`SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema=${schema}`
        expect(tables[0]?.count).toBe(0)
        observation.proof = { candidateSha256: hash(candidate), missingMember: missing, deniedBeforePayloadCreation: true,
          actualRuntimeExitWithoutMigration: control.exitCode, actualRuntimeDiagnostic: control.stderr.trim(),
          reachableRealPostgres: true, actualSchemaTables: tables[0]?.count, noCheckoutMigrationFallback: true }
      } finally {
        try { if (schemaCreated) await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`) }
        finally { await database.close() }
        observation.ownedSchemaDropped = true
      }
    })
  }, 20000)
})
