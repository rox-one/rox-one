import { afterAll, beforeAll, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../../apps/workspace-service/src/server.ts'
import { loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity.ts'
import { WsRpcClient } from '../../packages/server-core/src/transport/client.ts'
import { ProjectAuthorityError, requireSharedProjectResult } from '../../apps/electron/src/shared/project-authority.ts'
import type { CreateSharedProject, RoxCommand, SharedProjectResult } from '../../packages/shared/src/workspace-domain/identity/contracts.ts'

// Reuse the already installed architecture validator dependency. ajv-formats resolves its own
// Ajv 8 dependency, rather than the unrelated Ajv 6 at the workspace node_modules root.
type SchemaValidator = ((value: unknown) => boolean) & { errors?: readonly { keyword: string }[] | null }
type SchemaCompiler = { compile(schema: unknown): SchemaValidator }
const require = createRequire(import.meta.url)
const formatsRequire = createRequire(require.resolve('ajv-formats/package.json'))
const ajvModule = formatsRequire('ajv/dist/2020.js') as { default?: unknown }
const Ajv = (ajvModule.default ?? ajvModule) as new (options: Record<string, unknown>) => SchemaCompiler
const formatsModule = require('ajv-formats') as { default?: unknown }
const addFormats = (formatsModule.default ?? formatsModule) as (ajv: SchemaCompiler) => unknown
const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false })
addFormats(ajv)
const sourceRoot = resolve(import.meta.dir, '../..')
const normativePath = join(sourceRoot, 'plans/macro-integration/work-packages.json')
const normative = JSON.parse(await readFile(normativePath, 'utf8')) as { workPackages: { id: string; operations: { name: string; responseSchema: Record<string, unknown> }[] }[] }
const responseSchema = normative.workPackages.find(item => item.id === 'WP-01')?.operations.find(item => item.name === 'project.createShared')?.responseSchema
if (!responseSchema) throw new Error('WP-01 response schema missing')
const validResponse = ajv.compile(responseSchema)
const schema = 'wp01_response_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16)
const workspaceId = crypto.randomUUID()
const workspaceName = 'WP01 response contract workspace'
const issuer = 'https://wp01-response.invalid/' + crypto.randomUUID()
const command: RoxCommand<CreateSharedProject> = {
  commandId: crypto.randomUUID(), schemaVersion: 2, workspaceId, idempotencyKey: crypto.randomUUID(), expectedRevision: '0',
  payload: { name: 'PRIVATE_WP01_RESPONSE_CONTRACT', workspaceName, visibility: 'private' },
}
// Independent command semantic hash: command ID is trace metadata and is absent from this hash.
const expectedHash = createHash('sha256').update(JSON.stringify({ action: 'project.createShared', schemaVersion: 2,
  workspaceId, expectedRevision: '0', payload: { name: command.payload.name, workspaceName, visibility: 'private' } })).digest('hex')
const clients: WsRpcClient[] = []
let database: SQL | undefined
let url = '', token = '', issuerState = '', ownerPrincipalId = '', base = ''
let ownedSchema = false
let service: Awaited<ReturnType<typeof createWorkspaceServer>> | undefined
let original: SharedProjectResult

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PROJECT_RESULT')
  return value as Record<string, unknown>
}
function copyOriginal(): Record<string, unknown> { return structuredClone(original) as unknown as Record<string, unknown> }
function assertWire(value: unknown): SharedProjectResult {
  if (!validResponse(value)) throw new Error('INVALID_PROJECT_RESULT')
  let decoded: SharedProjectResult
  try { decoded = requireSharedProjectResult(value, command.commandId) }
  catch (error) {
    if (error instanceof ProjectAuthorityError && error.code === 'INVALID_PAYLOAD') throw new Error('INVALID_PROJECT_RESULT')
    throw error
  }
  if (!isDeepStrictEqual(value, decoded) || decoded.requestHash !== expectedHash || decoded.entity.workspaceId !== workspaceId
    || decoded.data.ownerPrincipalId !== ownerPrincipalId || decoded.data.name !== command.payload.name || decoded.data.visibility !== 'private'
    || decoded.observedRevision !== decoded.entity.revisionId || decoded.observedRevision !== decoded.data.revision
    || decoded.observedRevision !== decoded.receipt?.observedRevision || decoded.verifiedAt !== decoded.receipt?.verifiedAt
    || decoded.verifiedAt !== decoded.data.createdAt) throw new Error('INVALID_PROJECT_RESULT')
  return decoded
}
function ws() {
  const client = new WsRpcClient(base.replace('http:', 'ws:'), { token, workspaceId, autoReconnect: false, requestTimeout: 5000, connectTimeout: 5000 })
  clients.push(client)
  return client
}
async function http() {
  const response = await fetch(base + '/v1/workspaces/' + workspaceId + '/commands/project.createShared', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  })
  return { status: response.status, body: await response.json() as unknown }
}
async function start() {
  database = new SQL(url, { max: 4 })
  service = await createWorkspaceServer({ database, schema, migrations: await loadWorkspaceBootstrapMigrations(join(sourceRoot, 'apps/workspace-service/migrations')),
    host: '127.0.0.1', port: 0, serverId: 'wp01-response-contract',
    authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience: 'wp01-response-contract', stateDirectory: issuerState, checkoutDirectory: sourceRoot, tokenLifetimeSeconds: 900 } } })
  await service.server.listen(); base = 'http://127.0.0.1:' + service.server.port
}
async function stop() {
  for (const client of clients.splice(0)) client.destroy()
  service?.server.close(); service = undefined
  await database?.close(); database = undefined
}
async function counts() {
  if (!database) throw new Error('Missing actual SQL fixture')
  const rows = await database.unsafe<{ projects: number; receipts: number; events: number }[]>(`SELECT
    (SELECT count(*)::int FROM "${schema}".project) projects,
    (SELECT count(*)::int FROM "${schema}".project_create_receipt) receipts,
    (SELECT count(*)::int FROM "${schema}".project_event WHERE type='project.created') events`)
  return rows[0]
}
async function retained(value: unknown) {
  if (!database) throw new Error('Missing actual SQL fixture')
  await database.unsafe(`UPDATE "${schema}".project_create_receipt SET result=$1::jsonb WHERE workspace_id=$2 AND actor_principal_id=$3 AND idempotency_key=$4`,
    [value, workspaceId, ownerPrincipalId, command.idempotencyKey])
}

beforeAll(async () => {
  url = await loadProtectedWorkspaceDatabaseUrl(process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents/state/rox-compound-workspace/postgres-environment.json'))
  database = new SQL(url, { max: 1 }); await database.unsafe(`CREATE SCHEMA "${schema}"`); ownedSchema = true
  await database.close(); database = undefined
  issuerState = await mkdtemp(join(tmpdir(), 'rox-wp01-response-issuer-'))
  await start()
  if (!service) throw new Error('Missing actual service')
  const login = 'wp01-response-owner-' + crypto.randomUUID(), password = crypto.randomUUID()
  const account = await service.identity.provisionAccount(login, password); ownerPrincipalId = account.principalId
  await service.repository.provisionWorkspace(ownerPrincipalId, workspaceId, workspaceName)
  const loginResponse = await fetch(base + '/v1/auth/local/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) })
  expect(loginResponse.status).toBe(200)
  const loginBody = object(await loginResponse.json()); if (typeof loginBody.token !== 'string') throw new Error('Real issuer did not return token')
  token = loginBody.token
  const response = await http(); expect(response.status).toBe(200); original = assertWire(response.body)
}, 30000)

afterAll(async () => {
  let remainingOwnedSchemas: number | undefined
  for (const client of clients.splice(0)) client.destroy()
  service?.server.close()
  if (!database && ownedSchema) database = new SQL(url, { max: 1 })
  if (database && ownedSchema) {
    await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
    const rows = await database.unsafe<{ count: number }[]>('SELECT count(*)::int AS count FROM pg_namespace WHERE nspname=$1', [schema])
    remainingOwnedSchemas = rows[0]?.count
    expect(remainingOwnedSchemas).toBe(0)
  }
  await database?.close()
  if (issuerState) await rm(issuerState, { recursive: true, force: true })
  console.info('WP01 response-schema cleanup: ' + JSON.stringify({ schema, remainingOwnedSchemas,
    listenerPort: base ? Number(new URL(base).port) : undefined, poolClosed: true, ownedIssuerStateRemoved: true }))
}, 15000)

test('strict amended WP01 schema compiles and real HTTP/WS preserve complete typed canonical result and one receipt', async () => {
  expect(responseSchema.additionalProperties).toBe(false)
  expect((responseSchema.required as string[]).slice().sort()).toEqual(Object.keys(original).sort())
  const response = await http(); expect(response.status).toBe(200)
  expect(assertWire(response.body)).toEqual(original)
  const rpc = await ws().invoke('domain.project.createShared', workspaceId, command)
  expect(assertWire(rpc)).toEqual(original)
  expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
  const rows = await database!.unsafe<{ request_hash: string; command_id: string; project_id: string; result: unknown }[]>(`SELECT request_hash,command_id,project_id::text,result FROM "${schema}".project_create_receipt WHERE workspace_id=$1 AND actor_principal_id=$2 AND idempotency_key=$3`, [workspaceId, ownerPrincipalId, command.idempotencyKey])
  expect(rows).toHaveLength(1)
  expect(rows[0]?.request_hash).toBe(expectedHash); expect(rows[0]?.command_id).toBe(command.commandId)
  expect('project:' + rows[0]?.project_id).toBe(original.entity.entityId)
  expect(rows[0]?.result).toEqual(original)
})

test('complete canonical wire result survives real service/pool restart without schema relaxation', async () => {
  await stop(); await start()
  const response = await http(); expect(response.status).toBe(200)
  expect(assertWire(response.body)).toEqual(original)
  expect(assertWire(await ws().invoke('domain.project.createShared', workspaceId, command))).toEqual(original)
  expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
})

type Corruption = { name: string; schemaRejected: boolean; mutate(value: Record<string, unknown>): void }
const cases: Corruption[] = [
  { name: 'unknown top-level property', schemaRejected: true, mutate: value => { value.secretTitle = 'UNAUTHORIZED' } },
  { name: 'unknown receipt property', schemaRejected: true, mutate: value => { object(value.receipt).token = 'UNAUTHORIZED' } },
  { name: 'unknown Project DTO property', schemaRejected: true, mutate: value => { object(value.data).body = 'UNAUTHORIZED' } },
  { name: 'unknown canonical ref property', schemaRejected: true, mutate: value => { object(value.entity).accountNamespace = 'wrong-account' } },
  { name: 'missing canonical receipt', schemaRejected: true, mutate: value => { delete value.receipt } },
  { name: 'integer Project name', schemaRejected: true, mutate: value => { object(value.data).name = 123 } },
  { name: 'wrong schema version', schemaRejected: true, mutate: value => { object(value.data).schemaVersion = 2 } },
  { name: 'invalid visibility', schemaRejected: true, mutate: value => { object(value.data).visibility = 'public' } },
  { name: 'invalid date-time', schemaRejected: true, mutate: value => { value.verifiedAt = 'not-a-date' } },
  { name: 'invalid UUID', schemaRejected: true, mutate: value => { value.receiptId = 'not-a-uuid' } },
  { name: 'invalid revision type', schemaRejected: true, mutate: value => { value.observedRevision = 1 } },
  { name: 'invalid hash type', schemaRejected: true, mutate: value => { value.requestHash = 123 } },
  { name: 'invalid hash bytes', schemaRejected: true, mutate: value => { value.requestHash = 'g'.repeat(64) } },
  { name: 'false success boolean', schemaRejected: true, mutate: value => { value.ok = false } },
  { name: 'false verified fixture', schemaRejected: true, mutate: value => { value.executionMode = 'fixture' } },
  { name: 'false verified queued command', schemaRejected: true, mutate: value => { value.status = 'queued'; value.lifecycle = 'queued' } },
  { name: 'false receipt verification', schemaRejected: true, mutate: value => { value.verification = 'unverified' } },
  { name: 'wrong receipt provider', schemaRejected: true, mutate: value => { object(value.receipt).provider = 'synthetic' } },
  { name: 'valid-format command hash mismatch', schemaRejected: false, mutate: value => { value.requestHash = '0'.repeat(64) } },
  { name: 'valid-format workspace substitution', schemaRejected: false, mutate: value => { const foreign = crypto.randomUUID(); object(value.entity).workspaceId = foreign; object(object(value.data).entity).workspaceId = foreign } },
  { name: 'valid-format owner substitution', schemaRejected: false, mutate: value => { object(value.data).ownerPrincipalId = crypto.randomUUID() } },
  { name: 'valid-format canonical entity mismatch', schemaRejected: false, mutate: value => { value.entityId = 'project:' + crypto.randomUUID() } },
  { name: 'valid-format receipt command mismatch', schemaRejected: false, mutate: value => { object(value.receipt).requestId = crypto.randomUUID() } },
  { name: 'valid-format receipt remote mismatch', schemaRejected: false, mutate: value => { object(value.receipt).remoteId = 'project:' + crypto.randomUUID() } },
  { name: 'valid-format observed revision mismatch', schemaRejected: false, mutate: value => { object(value.receipt).observedRevision = '999' } },
  { name: 'valid-format receipt timestamp mismatch', schemaRejected: false, mutate: value => { object(value.receipt).verifiedAt = '2000-01-01T00:00:00.000Z' } },
]

for (const corruption of cases) {
  test('full wire contract rejects ' + corruption.name + '; real HTTP/WS deny the corrupted retained receipt', async () => {
    const candidate = copyOriginal(); corruption.mutate(candidate)
    expect(validResponse(candidate), 'schema result: ' + corruption.name).toBe(!corruption.schemaRejected)
    expect(() => assertWire(candidate), 'semantic result: ' + corruption.name).toThrow('INVALID_PROJECT_RESULT')
    try {
      await retained(candidate)
      const response = await http()
      expect(response).toEqual({ status: 503, body: { error: { code: 'PROVIDER_UNAVAILABLE' } } })
      let failure: unknown
      try { await ws().invoke('domain.project.createShared', workspaceId, command) } catch (error) { failure = error }
      expect(failure).toBeInstanceOf(Error)
      expect(object(failure).code).toBe('PROVIDER_UNAVAILABLE')
      expect(JSON.stringify(response.body)).not.toContain(command.payload.name)
      expect(String(failure)).not.toContain(command.payload.name)
      expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
    } finally { await retained(original) }
    const restored = await http(); expect(restored.status).toBe(200); expect(assertWire(restored.body)).toEqual(original)
  })
}

test('negative control restoring the omitted-metadata schema rejects the actual canonical HTTP/WS response', async () => {
  const reverted = structuredClone(responseSchema)
  const properties = object(reverted.properties)
  const canonicalMetadata = ['entityId', 'executionMode', 'lifecycle', 'ok', 'receipt', 'verification']
  for (const name of canonicalMetadata) delete properties[name]
  reverted.required = (reverted.required as string[]).filter(name => !canonicalMetadata.includes(name))
  const missingCanonicalMetadata = ajv.compile(reverted)
  const response = await http(); expect(response.status).toBe(200)
  expect(validResponse(response.body)).toBe(true); expect(missingCanonicalMetadata(response.body)).toBe(false)
  expect(missingCanonicalMetadata.errors?.some(error => error.keyword === 'additionalProperties')).toBe(true)
  const rpc = await ws().invoke('domain.project.createShared', workspaceId, command)
  expect(validResponse(rpc)).toBe(true); expect(missingCanonicalMetadata(rpc)).toBe(false)
  expect(await counts()).toEqual({ projects: 1, receipts: 1, events: 1 })
})
