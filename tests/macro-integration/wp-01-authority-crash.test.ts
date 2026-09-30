import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../../apps/workspace-service/src/server'
import { loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity'
import { authenticateProjectAuthority } from '../../apps/electron/src/main/project-authority'
import type { AuthorityJournalCheckpoint } from '../../apps/electron/src/main/project-authority-journal'

const schema = 'wp01_crash_' + randomBytes(6).toString('hex')
const issuer = 'urn:rox:authority-crash:' + randomUUID()
const audience = 'rox-authority-crash'
const password = 'actual-test-password-' + randomUUID()
const loginA = randomUUID() + '@example.org'; const loginB = randomUUID() + '@example.org'
const workspaceA = randomUUID(); const workspaceB = randomUUID()
let database: SQL | undefined
let service: Awaited<ReturnType<typeof createWorkspaceServer>> | undefined
let directory: string | undefined
let childBin: string | undefined
let signedA: Awaited<ReturnType<typeof authenticateProjectAuthority>> | undefined
let signedB: Awaited<ReturnType<typeof authenticateProjectAuthority>> | undefined
let probes: Record<string, { entityId: string; marker: string }> = {}
function required<T>(value: T | undefined): T { if (value === undefined) throw new Error('Missing crash fixture'); return value }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected sanitized child result')
  return value as Record<string, unknown>
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function credential(signed: Awaited<ReturnType<typeof authenticateProjectAuthority>>) {
  return { value: signed.credential.token, tokenType: 'Bearer', expiresAt: signed.credential.expiresAt }
}
function launch(input: Record<string, unknown>) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'wp-01-authority-crash-child.ts')], {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', cwd: process.cwd(),
    env: { ...process.env, PATH: required(childBin), ROX_CONFIG_DIR: String(input.directory), CRAFT_CONFIG_DIR: String(input.directory), CRAFT_DEBUG: 'false' },
  })
  child.stdin.write(JSON.stringify(input)); child.stdin.end()
  return child
}
async function run(input: Record<string, unknown>, expectedExit = 0): Promise<Record<string, unknown>> {
  const child = launch(input)
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  // Never print token/password-bearing input or credential bytes on a failure.
  if (stderr) {
    let safe = stderr
    const secrets = Array.isArray(input.secretsToCheck) ? input.secretsToCheck : []
    for (const secret of secrets) if (typeof secret === 'string') safe = safe.replaceAll(secret, '[redacted]')
    safe = safe.replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]')
    console.error('Sanitized child diagnostic:', safe)
  }
  expect(stderr.length === 0).toBe(true)
  expect(exit).toBe(expectedExit)
  const lines = stdout.trim().split('\n')
  const last = lines.at(-1)
  if (!last) throw new Error('No sanitized crash child result')
  return record(JSON.parse(last))
}
async function killed(input: Record<string, unknown>, stopAt: AuthorityJournalCheckpoint): Promise<Record<string, unknown>> {
  const child = launch({ ...input, stopAt })
  const reader = child.stdout.getReader()
  let output = ''
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    while (!output.includes('\n')) {
      const part = await reader.read()
      if (part.done) throw new Error('Crash child exited before requested boundary')
      output += new TextDecoder().decode(part.value)
      if (output.length > 1024) throw new Error('Unexpected crash child output')
    }
    const first = record(JSON.parse(output.trim()))
    expect(first.type).toBe('checkpoint'); expect(first.point).toBe(stopAt)
    child.kill('SIGKILL')
    expect((await child.exited) !== 0).toBe(true)
    expect((await new Response(child.stderr).text()).length === 0).toBe(true)
    return first
  } finally { clearTimeout(timeout); reader.releaseLock(); child.kill('SIGKILL') }
}
async function fixture() {
  const localWorkspaceId = randomUUID()
  const path = join(required(directory), localWorkspaceId)
  const signed = required(signedA)
  const shared = { directory: path, localWorkspaceId, probes,
    loginInput: { serviceUrl: required(signedB).configuration.url.replace(/^ws/, 'http'), workspaceId: workspaceB,
      workspaceName: 'Crash workspace B', login: loginB, password },
    secretsToCheck: [required(signedA).credential.token, required(signedB).credential.token, password] }
  expect((await run({ ...shared, mode: 'seed', configuration: signed.configuration, credential: credential(signed) })).ok).toBe(true)
  return shared
}
async function assertPair(input: Record<string, unknown>, expected: 'old' | 'new' | 'none'): Promise<void> {
  const result = await run({ ...input, mode: 'recover' })
  expect(result.ok).toBe(true); expect(result.journalPresent).toBe(false); expect(result.leaks).toBe(false)
  if (expected === 'none') {
    expect(result.configuration).toBeNull(); expect(result.credentialFingerprint).toBeNull(); expect(result.authorizedStatus).toBeNull()
  } else {
    const signed = required(expected === 'old' ? signedA : signedB)
    expect(result.configuration).toEqual(signed.configuration)
    expect(result.credentialFingerprint).toBe(expected === 'old' ? hash(signed.credential.token) : input.newCredentialFingerprint)
    expect(result.authorizedStatus).toBe(200); expect(result.privateMarkerVisible).toBe(true)
  }
  // Recovery is idempotent across a second independently spawned process.
  const repeated = await run({ ...input, mode: 'recover' })
  expect(repeated).toEqual(result)
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rox-authority-crash-'))
  childBin = join(directory, 'bin'); await mkdir(childBin, { mode: 0o700 })
  await symlink(process.execPath, join(childBin, 'bun'))
  // Actual backend subprocess cannot find OS keychain CLIs; no executable shim and no global keychain access.
  database = new SQL(await loadProtectedWorkspaceDatabaseUrl(process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json')))
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  service = await createWorkspaceServer({ database, schema,
    migrations: await loadWorkspaceBootstrapMigrations(join(import.meta.dir, '../../apps/workspace-service/migrations')),
    authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience,
      stateDirectory: join(directory, 'issuer'), checkoutDirectory: process.cwd() } }, host: '127.0.0.1', port: 0,
    serverId: 'crash-recovery-' + randomUUID() })
  await service.server.listen()
  const accountA = await service.identity.provisionAccount(loginA, password)
  const accountB = await service.identity.provisionAccount(loginB, password)
  await service.repository.provisionWorkspace(accountA.principalId, workspaceA, 'Crash workspace A')
  await service.repository.provisionWorkspace(accountB.principalId, workspaceB, 'Crash workspace B')
  const origin = 'http://127.0.0.1:' + service.server.port
  signedA = await authenticateProjectAuthority({ serviceUrl: origin, workspaceId: workspaceA, workspaceName: 'Crash workspace A', login: loginA, password })
  signedB = await authenticateProjectAuthority({ serviceUrl: origin, workspaceId: workspaceB, workspaceName: 'Crash workspace B', login: loginB, password })
  for (const signed of [signedA, signedB]) {
    const marker = 'PRIVATE_CRASH_' + randomUUID()
    const verified = await service.actorResolver.authenticate(signed.credential.token)
    const created = await service.authority.createSharedProject(verified.actor, signed.configuration.workspaceId,
      { commandId: randomUUID(), idempotencyKey: randomUUID(), schemaVersion: 2, workspaceId: signed.configuration.workspaceId,
        expectedRevision: '0', payload: { name: marker, workspaceName: signed.configuration.workspaceName, visibility: 'private' } })
    probes[signed.configuration.workspaceId] = { entityId: created.entity.entityId, marker }
  }
}, 30000)

afterAll(async () => {
  service?.server.close()
  if (database) { await database.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await database.close() }
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('actual process-kill recovery with canonical encrypted credential/config stores', () => {
  for (const [point, expected] of [['prepared', 'old'], ['credential_written', 'old'], ['configuration_written', 'new'], ['journal_removed', 'new']] as const) {
    test('replacement recovers ' + expected + ' pair after SIGKILL at ' + point, async () => {
      const input = await fixture(); const signed = required(signedB)
      const checkpoint = await killed({ ...input, mode: 'replace', configuration: signed.configuration, credential: credential(signed) }, point)
      const enriched = { ...input, newCredentialFingerprint: checkpoint.targetCredentialFingerprint }
      await assertPair(enriched, expected)
      const key = await stat(join(String(input.directory), 'credentials.key'))
      expect(key.mode & 0o777).toBe(0o600)
    })
  }
  for (const point of ['prepared', 'disconnect_credential_deleted', 'disconnect_configuration_deleted'] as const) {
    test('disconnect never resurrects prior credentials after SIGKILL at ' + point, async () => {
      const input = await fixture()
      await killed({ ...input, mode: 'disconnect' }, point)
      await assertPair(input, 'none')
    })
  }
  test('recovery itself can be killed between rollback stores and retry still restores the original pair', async () => {
    const input = await fixture(); const signed = required(signedB)
    await killed({ ...input, mode: 'replace', configuration: signed.configuration, credential: credential(signed) }, 'credential_written')
    await killed({ ...input, mode: 'recover' }, 'rollback_credential_written')
    await assertPair(input, 'old')
  })
  test('concurrent unrelated config metadata survives an incomplete replacement and recovery', async () => {
    const input = await fixture(); const signed = required(signedB)
    await killed({ ...input, mode: 'replace', configuration: signed.configuration, credential: credential(signed) }, 'credential_written')
    const path = join(String(input.directory), 'config.json')
    const config = record(JSON.parse(await readFile(path, 'utf8')))
    config.notificationsEnabled = true
    await writeFile(path, JSON.stringify(config))
    await assertPair(input, 'old')
    expect((await run({ ...input, mode: 'inspect' })).notificationsEnabled).toBe(true)
  })
  test('late invalidation rolls back its credential and a subsequent explicit disconnect removes both stores', async () => {
    const input = await fixture(); const signed = required(signedB)
    expect((await run({ ...input, mode: 'replace', configuration: signed.configuration, credential: credential(signed), invalidateAt: 'credential_written' }, 1)).code).toBe('WORKSPACE_MISMATCH')
    await assertPair(input, 'old')
    expect((await run({ ...input, mode: 'supersede', configuration: signed.configuration, credential: credential(signed), invalidateAt: 'prepared' })).ok).toBe(true)
    await assertPair(input, 'none')
  })
  test('real wrong-password HTTP authentication leaves the exact durable files and creates no journal', async () => {
    const input = await fixture()
    const config = join(String(input.directory), 'config.json'); const encrypted = join(String(input.directory), 'credentials.enc')
    const beforeConfig = hash((await readFile(config)).toString('base64')); const beforeEncrypted = hash((await readFile(encrypted)).toString('base64'))
    const result = await run({ ...input, mode: 'authenticate', loginInput: { serviceUrl: required(signedA).configuration.url.replace(/^ws/, 'http'),
      workspaceId: workspaceA, workspaceName: 'Crash workspace A', login: loginA, password: 'wrong' } }, 1)
    expect(result.code).toBe('UNAUTHENTICATED')
    expect(hash((await readFile(config)).toString('base64'))).toBe(beforeConfig)
    expect(hash((await readFile(encrypted)).toString('base64'))).toBe(beforeEncrypted)
    await assertPair(input, 'old')
  })
  test('corrupt encrypted storage fails closed instead of being treated as absent or overwritten', async () => {
    const input = await fixture(); const signed = required(signedB)
    await killed({ ...input, mode: 'replace', configuration: signed.configuration, credential: credential(signed) }, 'credential_written')
    const path = join(String(input.directory), 'credentials.enc')
    await writeFile(path, Buffer.from('invalid encrypted header'))
    const before = hash((await readFile(path)).toString('base64'))
    expect((await run({ ...input, mode: 'recover' }, 1)).code).toBe('CAPABILITY_UNAVAILABLE')
    const names = await readdir(String(input.directory))
    const quarantined = names.find(name => name.startsWith('credentials.enc.quarantine.'))
    if (!quarantined) throw new Error('Missing actual protected quarantine evidence')
    expect(hash((await readFile(join(String(input.directory), quarantined))).toString('base64'))).toBe(before)
    // A second restart must retain repair-required state instead of silently accepting an empty store.
    expect((await run({ ...input, mode: 'recover' }, 1)).code).toBe('CAPABILITY_UNAVAILABLE')
  })
  test('unexpected authority metadata conflicts fail closed and preserve the encrypted journal for explicit repair', async () => {
    const input = await fixture(); const signed = required(signedB)
    await killed({ ...input, mode: 'replace', configuration: signed.configuration, credential: credential(signed) }, 'credential_written')
    const path = join(String(input.directory), 'config.json'); const config = record(JSON.parse(await readFile(path, 'utf8')))
    if (!Array.isArray(config.workspaces)) throw new Error('Missing real config workspace')
    const workspace = record(config.workspaces[0]); workspace.projectAuthority = { ...signed.configuration, workspaceName: 'Unexpected third authority metadata' }
    await writeFile(path, JSON.stringify(config))
    expect((await run({ ...input, mode: 'recover' }, 1)).code).toBe('CAPABILITY_UNAVAILABLE')
    expect((await run({ ...input, mode: 'inspect' })).journalPresent).toBe(true)
  })
  test('target resolution performs durable recovery before reading either half of the authority pair', async () => {
    const input = await fixture()
    await killed({ ...input, mode: 'replace' }, 'credential_written')
    const resolved = await run({ ...input, mode: 'recover-target' })
    expect(resolved.ok).toBe(true); expect(resolved.configuration).toEqual(required(signedA).configuration)
    expect(resolved.credentialFingerprint).toBe(hash(required(signedA).credential.token))
    expect(resolved.authorizedStatus).toBe(200); expect(resolved.privateMarkerVisible).toBe(true)
    expect(resolved.journalPresent).toBe(false); expect(resolved.leaks).toBe(false)
    await assertPair(input, 'old')
  })
  test('failed rollback blocks configuration and private target resolution until strict recovery plus explicit disconnect succeeds', async () => {
    const input = await fixture()
    const result = await run({ ...input, mode: 'blocked-rollback' })
    expect(result.blockedConfiguration).toBe(true); expect(result.blockedTarget).toBe(true)
    expect(result.mutation).toEqual({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', status: 503 } })
    expect(result.configurationCode).toBe('CAPABILITY_UNAVAILABLE'); expect(result.targetCode).toBe('CAPABILITY_UNAVAILABLE')
    expect(result.journalRetained).toBe(true); expect(result.repaired).toEqual({ ok: true })
    expect(result.configuration).toBeNull(); expect(result.target).toBeNull()
    expect(result.credentialAbsent).toBe(true); expect(result.journalAbsent).toBe(true)
    await assertPair(input, 'none')
  })

})
