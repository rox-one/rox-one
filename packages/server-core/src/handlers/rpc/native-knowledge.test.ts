import { afterEach, expect, test } from 'bun:test'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { NativeAuthority, type NativeIssuedCredential } from '../../authority/native-authority.ts'
import { NativeJournal } from '../../authority/native-journal.ts'
import { CollaborationSyncService } from '../../collaboration/sync-service.ts'
import { WsRpcServer } from '../../transport/server.ts'
import { PROTOCOL_VERSION, RPC_CHANNELS, type MessageEnvelope } from '@rox/shared/protocol'
import { deserializeEnvelope } from '../../transport/codec.ts'
import { registerNativeDataHandlers } from './native-data.ts'
import { registerKnowledgeHandlers, __setSkipKnowledgeWatchAutoStart } from './knowledge.ts'
import { nativeNotesKnowledgeAccess } from './notes.ts'
import { NativeNotesKnowledgeProvider } from '../../knowledge/native-notes-provider.ts'
import type { RequestContext } from '../../transport/index.ts'
import { clearKnowledgeToolRuntime, getKnowledgeToolRuntime } from '@rox/session-tools-core'
import type { HandlerDeps } from '../handler-deps.ts'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
interface TestConnection {
  socket: WebSocket
  messages: MessageEnvelope[]
}

async function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'native-data-rpc-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const stateDir = join(dir, 'state')
  const authority = new NativeAuthority({ stateDir })
  cleanups.push(() => authority.close())
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  let admin: NativeIssuedCredential
  try {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    admin = authority.bootstrapLocalAdministrator('test operator')
  } finally {
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty)
    else Reflect.deleteProperty(process.stdin, 'isTTY')
  }
  const root = join(dir, 'workspace')
  mkdirSync(root)
  const workspace = authority.registerWorkspace(admin.credential, 'workspace-a', root)
  const issued = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'test device', Date.now() + 60_000), 'test device')
  if (!issued) throw new Error('expected enrolled principal')
  authority.grantWorkspace(admin.credential, issued.principal.subject, workspace.id, ['read', 'write', 'delete'])
  const journal = new NativeJournal({
    stateDir,
    authorize: (principal, workspaceId, action, nativeRoot) => authority.authorize(principal, workspaceId, action, nativeRoot),
    permissionFence: (principal, workspaceId, action) => authority.permissionFence(principal, workspaceId, action),
    authorizePreparedRecovery: (principal, workspaceId, action, fence, nativeRoot) => authority.authorizePreparedRecovery(principal, workspaceId, action, fence, nativeRoot),
  })
  cleanups.push(() => journal.close())
  const sync = new CollaborationSyncService(authority, journal)
  const server = new WsRpcServer({
    host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
    validateToken: async () => true,
  })
  const deps = { nativeData: { authority, journal, sync }, platform: {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  } } as unknown as HandlerDeps
  registerNativeDataHandlers(server, deps)
  __setSkipKnowledgeWatchAutoStart(true)
  registerKnowledgeHandlers(server, deps)
  cleanups.push(() => { clearKnowledgeToolRuntime(); __setSkipKnowledgeWatchAutoStart(false) })
  cleanups.push(() => server.close())
  await server.listen()
  return { authority, admin, issued, server, root, dir, sync, deps, url: `ws://127.0.0.1:${server.port}`, workspaceId: workspace.id }
}

async function connect(url: string, credential: string): Promise<TestConnection> {
  const socket = new WebSocket(url)
  cleanups.push(() => socket.terminate())
  const messages: MessageEnvelope[] = []
  socket.on('message', data => messages.push(deserializeEnvelope(data.toString())))
  await once(socket, 'open')
  socket.send(JSON.stringify({ id: 'handshake', type: 'handshake', protocolVersion: PROTOCOL_VERSION, workspaceId: 'workspace-a', token: credential }))
  await waitMessage(socket, messages, message => message.id === 'handshake')
  return { socket, messages }
}

function waitMessage(socket: WebSocket, messages: MessageEnvelope[], matches: (message: MessageEnvelope) => boolean) {
  const existing = messages.find(matches)
  if (existing) return Promise.resolve(existing)
  const { promise, resolve } = Promise.withResolvers<MessageEnvelope>()
  const listener = (data: WebSocket.RawData) => {
    const message = deserializeEnvelope(data.toString())
    if (!matches(message)) return
    socket.off('message', listener)
    resolve(message)
  }
  socket.on('message', listener)
  return promise
}

async function invoke(connection: TestConnection, channel: string, ...args: unknown[]) {
  const id = crypto.randomUUID()
  connection.socket.send(JSON.stringify({ id, type: 'request', channel, args }))
  return waitMessage(connection.socket, connection.messages, message => message.id === id)
}


test('authenticated native Knowledge search/read/context/backlinks use only committed Notes', async () => {
  const f = await fixture()
  f.sync.commit(f.authority.authenticate(f.issued.credential)!, f.workspaceId, { kind: 'notes', nativeId: 'note-a', operationId: 'create-a',
    expectedRevision: null, schemaVersion: 1, changes: [{ path: 'notes/projects/alpha.md', content: '---\ntitle: Alpha\ntags: [project]\nstatus: ready\n---\n\nCanonical needle content.' }] })
  f.sync.commit(f.authority.authenticate(f.issued.credential)!, f.workspaceId, { kind: 'notes', nativeId: 'note-b', operationId: 'create-b',
    expectedRevision: null, schemaVersion: 1, changes: [{ path: 'notes/beta.md', content: '# Beta\nSee [[projects/alpha|Alpha]].' }] })
  // A foreign loose Markdown file is never adopted by the read projection.
  writeFileSync(join(f.root, 'notes', 'untracked.md'), 'needle UNTRACKED SECRET')
  const client = await connect(f.url, f.issued.credential)
  const connectionId = `local-markdown:${f.workspaceId}`
  const listed = await invoke(client, RPC_CHANNELS.knowledge.LIST_CONNECTIONS)
  expect(listed.error).toBeUndefined()
  expect(listed.result).toMatchObject([{ id: connectionId, provider: 'local-markdown' }])
  const search = await invoke(client, RPC_CHANNELS.knowledge.SEARCH, { connectionId,
    input: { query: 'needle', pathPrefix: 'projects', attributes: { status: 'ready' }, limit: 1 } })
  expect(search.error).toBeUndefined()
  const page = search.result as { items: Array<{ ref: object; title: string; snippet: string }> }
  expect(page.items).toHaveLength(1)
  expect(page.items[0]!.title).toBe('Alpha')
  expect(page.items[0]!.snippet).not.toContain('UNTRACKED')
  const ref = page.items[0]!.ref
  const read = await invoke(client, RPC_CHANNELS.knowledge.GET, { connectionId, ref })
  expect(read.error).toBeUndefined()
  expect(read.result).toMatchObject({ title: 'Alpha', path: '/projects/alpha', markdown: expect.stringContaining('Canonical needle') })
  const context = await invoke(client, RPC_CHANNELS.knowledge.GET_CONTEXT, { connectionId, ref, mode: 'snapshot' })
  expect(context.error).toBeUndefined()
  expect(context.result).toMatchObject({ backlinks: [{ ref: { provider: 'local-markdown', id: 'beta' }, title: 'beta' }] })
  const backlinks = await invoke(client, RPC_CHANNELS.knowledge.GET_BACKLINKS, { connectionId, ref })
  expect(backlinks.error).toBeUndefined()
  expect(backlinks.result).toHaveLength(1)
  const wrongWorkspace = await invoke(client, RPC_CHANNELS.knowledge.SEARCH, { connectionId: 'local-markdown:another', input: { query: 'needle' } })
  expect(wrongWorkspace.error).toBeDefined()
  const external = await invoke(client, RPC_CHANNELS.knowledge.SEARCH, { connectionId: 'some-global-siyuan', input: { query: 'needle' } })
  expect(external.error).toBeDefined()
  expect(readFileSync(join(f.root, 'notes', 'projects', 'alpha.md'), 'utf8')).toContain('Canonical needle')
  await expect(getKnowledgeToolRuntime()!.search({ connectionId, input: { query: 'needle' } }))
    .rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
})

test('revoked grant invalidates an already-captured native Knowledge reader', async () => {
  const f = await fixture()
  const principal = f.authority.authenticate(f.issued.credential)!
  const ctx = { principal, workspaceId: f.workspaceId } as RequestContext
  const provider = new NativeNotesKnowledgeProvider(nativeNotesKnowledgeAccess(f.deps, ctx))
  expect((await provider.search({ query: 'absent' })).items).toEqual([])
  f.authority.revokeWorkspaceGrant(f.admin.credential, principal.subject, f.workspaceId)
  await expect(provider.search({ query: 'absent' })).rejects.toThrow()
  await expect(provider.capabilities()).rejects.toThrow()
})

test('missing or forged principal never creates a native Knowledge reader', async () => {
  const f = await fixture()
  expect(() => nativeNotesKnowledgeAccess(f.deps, { workspaceId: f.workspaceId } as RequestContext)).toThrow()
  expect(() => nativeNotesKnowledgeAccess(f.deps, { workspaceId: f.workspaceId,
    principal: { ...f.issued.principal } } as RequestContext)).toThrow()
  const principal = f.authority.authenticate(f.issued.credential)!
  expect(() => nativeNotesKnowledgeAccess(f.deps, { workspaceId: 'unregistered', principal } as RequestContext)).toThrow()
})

test('permission change during async projection discards the result and writes remain unsupported', async () => {
  const f = await fixture()
  const principal = f.authority.authenticate(f.issued.credential)!
  const access = nativeNotesKnowledgeAccess(f.deps, { principal, workspaceId: f.workspaceId } as RequestContext)
  const provider = new NativeNotesKnowledgeProvider(access)
  const capabilities = await provider.capabilities()
  expect(capabilities.mutations.createDocument).toBe(false)
  expect(capabilities.features.watch).toBe(false)
  await expect(provider.proposeMutation()).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  const changing = new NativeNotesKnowledgeProvider({ ...access, async list() {
    const documents = await access.list()
    f.authority.revokeWorkspaceGrant(f.admin.credential, principal.subject, f.workspaceId)
    return documents
  } })
  await expect(changing.search({ query: 'needle' })).rejects.toThrow()
})
