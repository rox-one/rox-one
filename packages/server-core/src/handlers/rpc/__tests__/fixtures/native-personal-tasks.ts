import assert from 'node:assert/strict'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthority } from '../../../../authority/native-authority'
import { WsRpcServer } from '../../../../transport/server'
import { WsRpcClient } from '../../../../transport/client'
import { personalTasksStore, registerPersonalTasksHandlers } from '../../personal-tasks'
import { registerGamificationHandlers } from '../../gamification'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerDeps } from '../../../handler-deps'
import type { PersonalTask, PersonalTaskPutResult, PersonalTasksSnapshot } from '@rox/core/tasks/personal'

const config = realpathSync(process.env.CRAFT_CONFIG_DIR!), state = join(config, 'authority')
let authority = new NativeAuthority({ stateDir: state })
const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin: ReturnType<NativeAuthority['bootstrapLocalAdministrator']>
try { Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }); admin = authority.bootstrapLocalAdministrator('Synthetic tasks acceptance') }
finally { if (tty) Object.defineProperty(process.stdin, 'isTTY', tty); else Reflect.deleteProperty(process.stdin, 'isTTY') }
const own = join(config, 'own'), foreign = join(config, 'foreign')
mkdirSync(own); mkdirSync(foreign)
authority.registerWorkspace(admin.credential, 'own', own); authority.registerWorkspace(admin.credential, 'foreign', foreign)
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [{ id: 'own', rootPath: own }, { id: 'foreign', rootPath: foreign }] }))
const enroll = (label: string) => {
  const issued = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, label, Date.now() + 60000), label)
  if (!issued) throw new Error('Synthetic enrollment failed')
  return issued
}
const alice = enroll('Alice'), bob = enroll('Bob'), reader = enroll('Reader')
for (const person of [alice, bob]) authority.grantWorkspace(admin.credential, person.principal.subject, 'own', ['read', 'write', 'subscribe'])
authority.grantWorkspace(admin.credential, reader.principal.subject, 'own', ['read', 'subscribe'])
const task: PersonalTask = { id: 'same-id', title: 'Alice task', notes: '', list: 'inbox', tags: [], priority: 'none', evening: false, links: [], order: 0, createdAt: 1 }
personalTasksStore().put({ ...task, title: 'PRIVATE HOST TASK' })
const hostBefore = readFileSync(join(config, 'personal-tasks', task.id + '.json'), 'utf8')
const snapshot = (path: string): unknown => {
  if (!existsSync(path)) return null
  const entry = lstatSync(path)
  return { mtime: entry.mtimeMs, mode: entry.mode, data: entry.isDirectory() ? Object.fromEntries(readdirSync(path).sort().map(name => [name, snapshot(join(path, name))])) : readFileSync(path).toString('base64') }
}
const clients: WsRpcClient[] = []
let server: WsRpcServer
let pause: { entered: () => void; released: Promise<void> } | null = null
const start = async () => {
  server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
    nativeEventChannels: new Set([RPC_CHANNELS.personalTasks.CHANGED]), nativeClientEventChannels: new Set([RPC_CHANNELS.personalTasks.CHANGED]) })
  const original = server.handle.bind(server)
  server.handle = (channel, handler, options) => original(channel, channel === RPC_CHANNELS.personalTasks.PUT ? async (...args) => {
    const waiting = pause; pause = null
    if (waiting) { waiting.entered(); await waiting.released }
    return handler(...args)
  } : handler, options)
  const deps = { nativeData: { authority }, platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } } } as unknown as HandlerDeps
  registerPersonalTasksHandlers(server, deps)
  registerGamificationHandlers(server, deps)
  await server.listen()
}
const connect = (person = alice, workspaceId = 'own') => {
  const client = new WsRpcClient('ws://127.0.0.1:' + server.port, { token: person.credential, workspaceId, mode: 'remote', autoReconnect: false, requestTimeout: 1500, connectTimeout: 1000 })
  clients.push(client); client.connect(); return client
}
const list = async (client: WsRpcClient) => await client.invoke(RPC_CHANNELS.personalTasks.LIST) as PersonalTasksSnapshot
const put = async (client: WsRpcClient, value: PersonalTask, expectedRevision: number | null) => await client.invoke(RPC_CHANNELS.personalTasks.PUT, [{ task: value, expectedRevision }]) as PersonalTaskPutResult
const denied = async (operation: () => Promise<unknown>) => {
  const missingDenial = new Error('Expected authority denial after check ' + checks)
  let failed = false; try { await operation() } catch { failed = true }
  if (!failed) throw missingDenial
}
const stop = async () => { for (const client of clients.splice(0)) client.destroy(); await new Promise(resolve => setTimeout(resolve, 20)); server?.close() }
let checks = 0
const check = (operation: () => void) => { operation(); checks++ }
try {
  await start(); let a = connect(), a2 = connect(), b = connect(bob), r = connect(reader)
  for (const client of [a, a2, b, r]) await list(client)
  const configBefore = snapshot(join(config, 'config.json')), workspaceBefore = snapshot(own), custody = join(state, 'native-personal-tasks')
  const empty = await list(a)
  check(() => assert.deepEqual(empty, { tasks: [], revisions: {}, meta: null, migration: null }))
  check(() => { assert.equal(existsSync(custody), false); assert.deepEqual(snapshot(own), workspaceBefore); assert.deepEqual(snapshot(join(config, 'config.json')), configBefore) })
  const events = [0, 0, 0, 0]
  ;[a, a2, b, r].forEach((client, i) => client.on(RPC_CHANNELS.personalTasks.CHANGED, () => { events[i] = events[i]! + 1 }))
  const created = await put(a, task, null)
  check(() => assert.deepEqual(created, { accepted: [{ task, revision: 1 }], conflicts: [], rejected: [] }))
  assert.equal((await a.invoke(RPC_CHANNELS.gamification.GET) as { xp: number }).xp, 15)
  assert.equal((await b.invoke(RPC_CHANNELS.gamification.GET) as { xp: number }).xp, 0); checks++
  await new Promise(resolve => setTimeout(resolve, 20))
  check(() => assert.deepEqual(events, [1, 1, 0, 0]))
  const same = await put(a, task, 1)
  check(() => assert.equal(same.accepted[0]?.revision, 1))
  assert.equal((await a.invoke(RPC_CHANNELS.gamification.GET) as { xp: number }).xp, 15); checks++
  const edited = { ...task, title: 'Edited task', checklist: [{ id: 'check-1', title: 'Editable detail', done: true }] }
  const results = await Promise.all([put(a, edited, 1), put(a2, { ...task, title: 'Competing edit' }, 1)])
  check(() => { assert.equal(results.reduce((n, result) => n + result.accepted.length, 0), 1); assert.equal(results.reduce((n, result) => n + result.conflicts.length, 0), 1) })
  const canonical = await list(a)
  check(() => { assert.equal(canonical.tasks.length, 1); assert.equal(canonical.revisions[task.id], 2) })
  assert.equal((await list(b)).tasks.length, 0); assert.equal((await list(r)).tasks.length, 0); checks++
  await put(b, { ...task, title: 'Bob task' }, null)
  check(() => assert.notEqual((canonical.tasks[0]!).title, 'Bob task'))
  await denied(() => put(r, task, null)); await denied(() => r.invoke(RPC_CHANNELS.personalTasks.MIGRATE, { bundle: null })); checks++
  const custodyBefore = snapshot(custody)
  await list(a); await list(b); await list(r)
  check(() => assert.deepEqual(snapshot(custody), custodyBefore))
  for (const [path, unsafe, safe] of [[custody, 0o755, 0o700], [join(custody, 'tasks.sqlite'), 0o644, 0o600]] as const) {
    chmodSync(path, unsafe)
    const unsafeBefore = snapshot(custody)
    await denied(() => list(a)); await denied(() => put(a, task, 1))
    assert.deepEqual(snapshot(custody), unsafeBefore); chmodSync(path, safe); checks++
  }
  const invalid = await put(a, { ...task, id: '../foreign', title: 'Path traversal' }, null)
  check(() => assert.equal(invalid.rejected.length, 1))
  const malformed = await put(a, { ...task, title: '', recurrence: { rule: 'daily', interval: 0 } }, null)
  check(() => assert.equal(malformed.rejected.length, 1))
  assert.equal((await r.invoke(RPC_CHANNELS.gamification.GET) as { xp: number }).xp, 0); checks++
  await denied(() => a.invoke(RPC_CHANNELS.personalTasks.PUT, [], { projects: 'spoof', areas: [], headings: [], audit: [] })); checks++
  const meta = { projects: [{ id: 'project-1', name: 'Project', order: 0 }], areas: [], headings: [], audit: [{ at: 2, action: 'edit', taskId: task.id }] }
  await a.invoke(RPC_CHANNELS.personalTasks.PUT, [], meta)
  assert.deepEqual((await list(a)).meta, meta); checks++
  const staleDelete = await a.invoke(RPC_CHANNELS.personalTasks.DELETE, [{ id: task.id, expectedRevision: 1 }]) as { conflicts: unknown[] }
  check(() => assert.equal(staleDelete.conflicts.length, 1))
  await a.invoke(RPC_CHANNELS.personalTasks.DELETE, [{ id: task.id, expectedRevision: 2 }])
  check(() => assert.equal(existsSync(join(own, 'personal-tasks')), false))
  const recreated = await put(a, task, null)
  check(() => assert.equal(recreated.accepted[0]?.revision, 3))
  check(() => { assert.equal(statSync(custody).mode & 0o777, 0o700); assert.equal(statSync(join(custody, 'tasks.sqlite')).mode & 0o777, 0o600); assert.equal(readFileSync(join(config, 'personal-tasks', task.id + '.json'), 'utf8'), hostBefore) })
  await denied(() => connect(alice, 'foreign').invoke(RPC_CHANNELS.personalTasks.LIST)); checks++
  await stop(); authority.close(); authority = new NativeAuthority({ stateDir: state }); await start(); a = connect(); b = connect(bob)
  check(() => assert.equal(readFileSync(join(config, 'personal-tasks', task.id + '.json'), 'utf8'), hostBefore))
  assert.equal((await list(a)).revisions[task.id], 3); assert.equal((await list(b)).tasks[0]?.title, 'Bob task'); checks++
  authority.revokeWorkspaceGrant(admin.credential, alice.principal.subject, 'own')
  authority.grantWorkspace(admin.credential, alice.principal.subject, 'own', ['read', 'subscribe']); a = connect()
  assert.equal((await list(a)).tasks.length, 1); await denied(() => put(a, edited, 3)); checks++
  authority.grantWorkspace(admin.credential, alice.principal.subject, 'own', ['read', 'write', 'subscribe']); a = connect(); await list(a)
  renameSync(own, own + '-original'); mkdirSync(own)
  await denied(() => list(a)); await denied(() => put(a, edited, 3)); checks++
  rmSync(own, { recursive: true }); renameSync(own + '-original', own)
  a = connect(); await list(a)
  let entered!: () => void, release!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve }), released = new Promise<void>(resolve => { release = resolve })
  pause = { entered, released }
  const late = put(a, edited, 3).then(() => false, () => true)
  await reached; authority.revokeWorkspaceGrant(admin.credential, alice.principal.subject, 'own'); release(); assert.equal(await late, true); checks++
  authority.grantWorkspace(admin.credential, alice.principal.subject, 'own', ['read', 'write', 'subscribe']); a = connect()
  assert.equal((await list(a)).revisions[task.id], 3); checks++
  const reached2 = new Promise<void>(resolve => { entered = resolve }), released2 = new Promise<void>(resolve => { release = resolve })
  pause = { entered, released: released2 }
  const disconnected = put(a, edited, 3).then(() => false, () => true)
  await reached2; a.destroy(); await new Promise(resolve => setTimeout(resolve, 20)); release(); assert.equal(await disconnected, true); await new Promise(resolve => setTimeout(resolve, 20)); a = connect(); assert.equal((await list(a)).revisions[task.id], 3); checks++
  const database = join(custody, 'tasks.sqlite'), saved = database + '-saved', privateForeign = join(config, 'private-foreign')
  renameSync(database, saved); writeFileSync(privateForeign, 'FOREIGN BYTES'); symlinkSync(privateForeign, database)
  await denied(() => list(a)); await denied(() => put(a, edited, 3)); check(() => assert.equal(readFileSync(privateForeign, 'utf8'), 'FOREIGN BYTES'))
  rmSync(database); renameSync(saved, database)
  console.log(JSON.stringify({ checks, passed: true, requests: 'actual authenticated WS, no provider calls' }))
} finally { await stop(); authority.close() }
process.exit(0)
