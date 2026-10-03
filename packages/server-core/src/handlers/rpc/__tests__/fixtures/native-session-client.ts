/** Real authority/WS/handlers; the deterministic manager avoids provider calls. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthority } from '../../../../authority/native-authority'
import { WsRpcServer } from '../../../../transport/server'
import { WsRpcClient } from '../../../../transport/client'
import { registerSessionsHandlers } from '../../sessions'
import { registerSourcesHandlers } from '../../sources'
import { registerWorkspaceCoreHandlers } from '../../workspace'
import { registerServerHandlers } from '../../server'
import { projectNativeWorkspaceEvent } from '../../native-session-scope'
import { RPC_CHANNELS, type Session, type SessionEvent } from '@craft-agent/shared/protocol'
import type { AnnotationV1 } from '@craft-agent/core/types'
import type { RequestContext } from '../../../../transport/types'

const directory = realpathSync(process.env.ROX_CONFIG_DIR!)
const roots = ['workspace-a', 'workspace-b'].map(id => {
  const rootPath = join(directory, id); mkdirSync(rootPath)
  writeFileSync(join(rootPath, 'config.json'), JSON.stringify({ id, name: id, slug: id, createdAt: Date.now(), defaults: { defaultLlmConnection: 'workspace-rox' } }))
  return { id, name: id, slug: id, rootPath, createdAt: Date.now(), kind: 'personal' as const,
    remoteServer: { token: 'host-private-remote-token', url: 'wss://host.test', remoteWorkspaceId: 'foreign' } }
})
const saveRegistry = () => writeFileSync(join(directory, 'config.json'), JSON.stringify({ workspaces: roots, activeWorkspaceId: roots[0]!.id, llmConnections: [] }))
saveRegistry()
const sourcePath = join(roots[0]!.rootPath, 'sources', 'fixture'); mkdirSync(sourcePath, { recursive: true })
writeFileSync(join(sourcePath, 'config.json'), JSON.stringify({ id: 'source-fixture', slug: 'fixture', name: 'Fixture search', type: 'api', provider: 'search', enabled: true,
  api: { baseUrl: 'https://provider.test', authType: 'header', headers: { Authorization: 'host-private-provider-secret' } }, local: { path: '/host/private/source' }, connectionError: '/host/private/source' }))
const sessions: Session[] = roots.map((workspace, i) => ({ id: `session-${i}`, workspaceId: workspace.id, workspaceName: workspace.name,
  lastMessageAt: Date.now(), messages: [{ id: `user-${i}`, role: 'user', content: `own conversation ${i}`, timestamp: 1,
    attachments: [{ id: 'attachment', type: 'text', name: 'private', mimeType: 'text/plain', size: 1, storedPath: '/host/private/attachment' }] },
    { id: `tool-${i}`, role: 'tool', content: 'host-private-tool-output', timestamp: 2, toolInput: { secret: 'host-private-tool-secret' } }],
  isProcessing: false, sessionFolderPath: '/host/private/session', workingDirectory: workspace.rootPath, llmConnection: 'workspace-rox' }))
const canonical = join(directory, 'session-fixture.json')
const persist = () => writeFileSync(canonical, JSON.stringify(sessions))
persist()
let writes = 0, created = 0
const manager = {
  waitForInit: async () => {}, getSessions: (id?: string) => sessions.filter(session => !id || session.workspaceId === id),
  async getSession(id: string) { return sessions.find(session => session.id === id) ?? null },
  getSessionWorkingDirectory: (id: string) => sessions.find(session => session.id === id)?.workingDirectory,
  getWorkspaces: () => roots, getWorkspacesInfo: () => roots,
  async createSession(workspaceId: string, options: Record<string, unknown>) {
    writes++; created++
    const session = { ...sessions[0]!, id: `new-${created}`, workspaceId, messages: [], ...options } as Session
    sessions.push(session); persist(); return session
  },
  addMessageAnnotation(id: string, messageId: string, annotation: AnnotationV1) {
    writes++; const message = sessions.find(session => session.id === id)!.messages.find(message => message.id === messageId)!
    message.annotations = [...(message.annotations ?? []), annotation]; persist()
    server.push(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'workspace-a' }, { type: 'message_annotations_updated', sessionId: id, messageId, annotations: message.annotations })
  },
  removeMessageAnnotation(id: string, messageId: string, annotationId: string) {
    writes++; const message = sessions.find(session => session.id === id)!.messages.find(message => message.id === messageId)!
    message.annotations = message.annotations?.filter(annotation => annotation.id !== annotationId); persist()
  },
  updateMessageAnnotation(id: string, messageId: string, annotationId: string, patch: Partial<AnnotationV1>) {
    writes++; const message = sessions.find(session => session.id === id)!.messages.find(message => message.id === messageId)!
    message.annotations = message.annotations?.map(annotation => annotation.id === annotationId ? { ...annotation, ...patch } : annotation); persist()
  },
  async sendMessage(id: string, text: string, _a: unknown, _sa: unknown, _o: unknown, _u: unknown, _v: unknown, ack: (id: string) => void) {
    writes++; const session = sessions.find(session => session.id === id)!
    const message = { id: `sent-${writes}`, role: 'user' as const, content: text, timestamp: 3 }; session.messages.push(message); persist(); ack(message.id)
    for (const event of [{ type: 'user_message', sessionId: id, message, status: 'accepted' }, { type: 'text_delta', sessionId: id, delta: 'synthetic reply' }, { type: 'complete', sessionId: id }]) {
      server.push(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: session.workspaceId }, event)
    }
  },
  cancelProcessing: async () => { writes++ },
}
const authority = new NativeAuthority({ stateDir: join(directory, 'authority') })
const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin
try { Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true }); admin = authority.bootstrapLocalAdministrator('fixture operator') }
finally { if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor); else Reflect.deleteProperty(process.stdin, 'isTTY') }
for (const workspace of roots) authority.registerWorkspace(admin.credential, workspace.id, workspace.rootPath)
const enroll = (label: string) => authority.redeemEnrollment(authority.issueEnrollment(admin.credential, label, Date.now() + 60_000), label)!
const writer = enroll('writer'), reader = enroll('reader'), outsider = enroll('outsider')
authority.grantWorkspace(admin.credential, writer.principal.subject, 'workspace-a', ['read', 'write', 'subscribe'])
authority.grantWorkspace(admin.credential, writer.principal.subject, 'workspace-b', ['read', 'write', 'subscribe'])
authority.grantWorkspace(admin.credential, reader.principal.subject, 'workspace-a', ['read', 'subscribe'])
authority.grantWorkspace(admin.credential, outsider.principal.subject, 'workspace-b', ['read', 'write', 'subscribe'])
const server = new WsRpcServer({ port: 0, requireAuth: true, nativeAuthority: authority, validateToken: async () => true,
  nativeEventChannels: new Set([RPC_CHANNELS.sessions.EVENT, RPC_CHANNELS.voice.JOB, RPC_CHANNELS.identity.CHANGED]),
  nativeClientEventChannels: new Set([RPC_CHANNELS.voice.JOB, RPC_CHANNELS.identity.CHANGED]),
  projectNativeEvent: (channel, args, id) => projectNativeWorkspaceEvent(channel, args, id, (sid, wid) => sessions.some(session => session.id === sid && session.workspaceId === wid)) })
const deps = { sessionManager: manager, nativeData: { authority }, platform: { logger: { info() {}, warn() {}, debug() {}, error() {} } } } as never
registerSessionsHandlers(server, deps); registerSourcesHandlers(server, deps); registerWorkspaceCoreHandlers(server, deps)
registerServerHandlers(server, deps, { serverId: 'fixture', startedAt: Date.now(), getConnectedClientCount: () => server.getConnectedClientCount() })
server.handle('fixture:client', context => context.clientId, { nativeAction: 'read' })
const clients: WsRpcClient[] = []
const connect = (issued: typeof writer, workspaceId = 'workspace-a') => {
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token: issued.credential, workspaceId, mode: 'remote', autoReconnect: false, requestTimeout: 1000, connectTimeout: 1000 })
  clients.push(client); client.connect(); return client
}
const denied = async (fn: () => Promise<unknown>) => { let error: unknown; try { await fn() } catch (caught) { error = caught }; assert(error, 'expected denial'); assert(!String(error).includes('host-private')) }
const barrier = (client: WsRpcClient) => client.invoke(RPC_CHANNELS.sessions.GET)
try {
  await server.listen(); const a = connect(writer), b = connect(reader), c = connect(outsider, 'workspace-b')
  const eventsA: SessionEvent[] = [], eventsB: SessionEvent[] = [], eventsC: SessionEvent[] = []
  a.on(RPC_CHANNELS.sessions.EVENT, event => eventsA.push(event)); b.on(RPC_CHANNELS.sessions.EVENT, event => eventsB.push(event)); c.on(RPC_CHANNELS.sessions.EVENT, event => eventsC.push(event))
  await Promise.all([barrier(a), barrier(b), barrier(c)])
  const mode = process.argv[2]
  if (mode === 'flow') {
    const listed = await barrier(a); assert.equal(listed.length, 1); assert.equal(listed[0].workspaceId, 'workspace-a'); assert.equal(listed[0].sessionFolderPath, undefined)
    const own = await a.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, 'session-0'); assert.equal(own.messages.length, 1); assert.equal(own.messages[0].attachments, undefined)
    await denied(() => a.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, 'session-1'))
    const initialWrites = writes
    await denied(() => b.invoke(RPC_CHANNELS.sessions.CREATE, 'workspace-a', {})); await denied(() => a.invoke(RPC_CHANNELS.sessions.CREATE, 'workspace-b', {}))
    await denied(() => a.invoke(RPC_CHANNELS.sessions.CREATE, 'workspace-a', { branchFromSessionId: 'session-1', branchFromMessageId: 'user-1' }))
    await denied(() => a.invoke(RPC_CHANNELS.sessions.CREATE, 'workspace-a', { llmConnection: 'foreign-credential' }))
    await denied(() => a.invoke(RPC_CHANNELS.sessions.COMMAND, 'session-0', { type: 'copyPath' }))
    await denied(() => a.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-1', 'forged'))
    await denied(() => a.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-0', 'attachment', [], [{ storedPath: '/host/private' }]))
    assert.equal(writes, initialWrites)
    const child = await a.invoke(RPC_CHANNELS.sessions.CREATE, 'workspace-a', { branchFromSessionId: 'session-0', branchFromMessageId: 'user-0', llmConnection: 'workspace-rox' }); assert.equal(child.branchFromSessionId, 'session-0'); assert.equal(child.workingDirectory, undefined)
    const annotation = { id: 'like', schemaVersion: 1, createdAt: 1, body: [{ type: 'tag', value: '❤️' }], target: { source: { sessionId: 'session-0', messageId: 'user-0' }, selectors: [] }, createdBy: { id: outsider.principal.subject }, meta: { kind: 'reaction', emoji: '❤️', vote: 'like' } }
    await a.invoke(RPC_CHANNELS.sessions.COMMAND, 'session-0', { type: 'addAnnotation', messageId: 'user-0', annotation }); await barrier(b)
    assert.equal(sessions[0]!.messages[0]!.annotations![0]!.createdBy!.id, writer.principal.subject)
    assert(eventsA.some(e => e.type === 'message_annotations_updated')); assert(eventsB.some(e => e.type === 'message_annotations_updated')); assert.equal(eventsC.length, 0)
    await denied(() => b.invoke(RPC_CHANNELS.sessions.COMMAND, 'session-0', { type: 'removeAnnotation', messageId: 'user-0', annotationId: 'like' }))
    await a.invoke(RPC_CHANNELS.sessions.COMMAND, 'session-0', { type: 'updateAnnotation', messageId: 'user-0', annotationId: 'like', patch: { status: 'resolved', createdBy: { id: outsider.principal.subject }, meta: { password: 'host-private-forgery' } } })
    const liked = sessions[0]!.messages[0]!.annotations![0]!; assert.equal(liked.status, 'resolved'); assert.equal(liked.body[0]!.type, 'tag'); assert.equal(liked.createdBy!.id, writer.principal.subject)
    await a.invoke(RPC_CHANNELS.sessions.COMMAND, 'session-0', { type: 'removeAnnotation', messageId: 'user-0', annotationId: 'like' }); assert.equal(sessions[0]!.messages[0]!.annotations!.length, 0)
    const sent = await a.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-0', 'new own message'); assert.equal(sent.accepted, true); await barrier(a)
    assert(eventsA.some(e => e.type === 'user_message')); assert(eventsA.some(e => e.type === 'text_delta')); assert(eventsA.some(e => e.type === 'complete'))
    await a.invoke(RPC_CHANNELS.sessions.CANCEL, 'session-0'); await denied(() => b.invoke(RPC_CHANNELS.sessions.CANCEL, 'session-0'))
    assert(readFileSync(canonical, 'utf8').includes('new own message'))
  } else if (mode === 'projections') {
    const workspace = await a.invoke(RPC_CHANNELS.workspaces.GET); assert.equal(workspace.length, 1); assert.equal(workspace[0].rootPath, ''); assert.equal(workspace[0].remoteServer, undefined)
    const info = await a.invoke(RPC_CHANNELS.server.GET_WORKSPACES); assert.equal(info.length, 1); assert.equal(info[0].rootPath, undefined); assert.equal(info[0].remoteServer, undefined)
    const source = await a.invoke(RPC_CHANNELS.sources.GET, 'workspace-a'); const fixtureSource = source.find((entry: { config: { slug: string } }) => entry.config.slug === 'fixture')
    assert(fixtureSource); assert.equal(fixtureSource.config.api, undefined); assert.equal(fixtureSource.folderPath, '')
    await denied(() => a.invoke(RPC_CHANNELS.sources.GET, 'workspace-b'))
    server.push(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'workspace-a' }, { type: 'text_delta', sessionId: 'session-1', delta: 'foreign text' })
    server.push(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'workspace-a' }, { type: 'tool_result', sessionId: 'session-0', result: 'host-private-secret' })
    server.push(RPC_CHANNELS.sessions.EVENT, { to: 'all' }, { type: 'text_delta', sessionId: 'session-0', delta: 'global text' })
    server.push(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'workspace-a' }, { type: 'error', sessionId: 'session-0', error: 'host-private-provider-secret' }); await barrier(a)
    assert.deepEqual(eventsA, [{ type: 'error', sessionId: 'session-0', error: 'Session request failed' }]); assert.equal(eventsC.length, 0)
    const voiceA: unknown[] = [], voiceB: unknown[] = []; a.on(RPC_CHANNELS.voice.JOB, event => voiceA.push(event)); b.on(RPC_CHANNELS.voice.JOB, event => voiceB.push(event))
    const ai = await a.invoke('fixture:client'); server.push(RPC_CHANNELS.voice.JOB, { to: 'workspace', workspaceId: 'workspace-a' }, { text: 'wrong-device' }); server.push(RPC_CHANNELS.voice.JOB, { to: 'client', clientId: ai }, { text: 'own-device' }); await barrier(a)
    assert.equal(voiceA.length, 1); assert.equal(voiceB.length, 0)
    assert(!JSON.stringify([workspace, info, source, eventsA]).includes('host-private'))
    const originalRoot = roots[0]!.rootPath; roots[0]!.rootPath = roots[1]!.rootPath; saveRegistry()
    await denied(() => a.invoke(RPC_CHANNELS.sources.GET, 'workspace-a')); await denied(() => a.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, 'session-0'))
    roots[0]!.rootPath = originalRoot; saveRegistry()
  } else if (mode === 'lifecycle') {
    let captured: RequestContext | undefined
    server.handle('fixture:capture', context => { captured = context; return true }, { nativeAction: 'write' }); await a.invoke('fixture:capture')
    assert(server.isRequestContextCurrent(captured!, 'read')); assert(server.isRequestContextCurrent(captured!, 'write')); assert(!server.isRequestContextCurrent({ ...captured! }, 'write'))
    const old = captured!
    authority.revokeWorkspaceGrant(admin.credential, writer.principal.subject, 'workspace-a'); authority.grantWorkspace(admin.credential, writer.principal.subject, 'workspace-a', ['read', 'write', 'subscribe'])
    assert(!server.isRequestContextCurrent(old, 'write'))
    await a.invoke('fixture:capture'); const current = captured!, id = await a.invoke('fixture:client')
    server.updateClientWorkspace(id, 'workspace-b'); assert(!server.isRequestContextCurrent(current, 'write')); await denied(() => a.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, 'session-0'))
    await a.invoke('fixture:capture'); let disconnected = false; const dispose = server.onClientDisconnect(clientId => { if (clientId === id) disconnected = true })
    const final = captured!; a.destroy(); await new Promise(resolve => setTimeout(resolve, 20)); assert(!server.isRequestContextCurrent(final, 'write')); assert(disconnected); dispose()
    const d = connect(writer); await barrier(d)
    let timed: RequestContext | undefined, finish: (() => void) | undefined
    server.handle('fixture:timeout', async context => { timed = context; await new Promise<void>(resolve => { finish = resolve }); if (server.isRequestContextCurrent(context)) writes++; return 'host-private-late' }, { nativeAction: 'write', timeoutMs: 15 })
    const before = writes; await denied(() => d.invoke('fixture:timeout')); assert(!server.isRequestContextCurrent(timed!, 'write')); finish!(); await barrier(d); assert.equal(writes, before)
    assert.throws(() => server.handle('invalid:timeout', () => {}, { timeoutMs: 240001 })); assert.throws(() => server.handle('invalid:negative', () => {}, { timeoutMs: -1 }))
    authority.revokeWorkspaceGrant(admin.credential, writer.principal.subject, 'workspace-a'); await denied(() => d.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-0', 'revoked')); assert.equal(writes, before)
    const ids = new Set<string>(); server.onClientDisconnect(clientId => ids.add(clientId)); const bid = await b.invoke('fixture:client'); server.close(); assert(ids.has(bid))
  } else throw Error('Unknown fixture case')
  console.log(`native session ${mode} passed`)
} finally { for (const client of clients) client.destroy(); await new Promise(resolve => setTimeout(resolve, 20)); server.close(); authority.close() }
