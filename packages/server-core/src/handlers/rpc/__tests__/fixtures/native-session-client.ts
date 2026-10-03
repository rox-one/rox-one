/** Real authority/WS/handlers; the deterministic manager avoids provider calls. */
import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthority } from '../../../../authority/native-authority'
import { WsRpcServer } from '../../../../transport/server'
import { WsRpcClient } from '../../../../transport/client'
import { registerSessionsHandlers } from '../../sessions'
import { registerSourcesHandlers } from '../../sources'
import { registerWorkspaceCoreHandlers } from '../../workspace'
import { registerServerHandlers } from '../../server'
import { registerToolchainHandlers } from '../../toolchain'
import { registerGamificationHandlers } from '../../gamification'
import { registerSettingsHandlers } from '../../settings'
import { publicRuntimeSummary, readNativeRuntimeConnection } from '../../native-model-catalog'
import { registerLlmConnectionsHandlers } from '../../llm-connections'
import { registerStatusesHandlers } from '../../statuses'
import { registerLabelsHandlers } from '../../labels'
import { registerProjectsHandlers } from '../../projects'
import { getDefaultStatusConfig } from '@rox/shared/statuses'
import { getToolchainManager } from '@rox/shared/toolchain-runtime'
import { getDefaultGamificationState, saveGamificationState } from '@rox/shared/gamification'
import { projectNativeRegisteredWorkspaceEvent } from '../../native-session-scope'
import { RPC_CHANNELS, type Session, type SessionEvent } from '@rox/shared/protocol'
import type { AnnotationV1 } from '@rox/core/types'
import type { RequestContext } from '../../../../transport/types'
import type { SessionCompletionEvent } from '../../../../sessions/SessionManager'
import type { ToolStatus } from '@rox/shared/toolchain'
import type { LoadedSource } from '@rox/shared/sources'

const directory = realpathSync(process.env.ROX_CONFIG_DIR!)
const roots = ['workspace-a', 'workspace-b'].map(id => {
  const rootPath = join(directory, id); mkdirSync(rootPath)
  writeFileSync(join(rootPath, 'config.json'), JSON.stringify({ id, name: id, slug: id, createdAt: Date.now(), defaults: { defaultLlmConnection: 'workspace-rox' } }))
  return { id, name: id, slug: id, rootPath, createdAt: Date.now(), kind: 'personal' as const,
    remoteServer: { token: 'host-private-remote-token', url: 'wss://host.test', remoteWorkspaceId: 'foreign' } }
})
const saveRegistry = () => writeFileSync(join(directory, 'config.json'), JSON.stringify({ workspaces: roots, activeWorkspaceId: roots[0]!.id, llmConnections: [
  { slug: 'workspace-rox', name: 'PRIVATE HOST ACCOUNT', providerType: 'omp', authType: 'none', createdAt: 1 },
  { slug: 'private-provider', name: 'OTHER PRIVATE HOST ACCOUNT', providerType: 'anthropic', authType: 'api_key', models: ['private-model'], createdAt: 1 },
  { slug: 'private-omp', name: 'CUSTOM PRIVATE OMP', providerType: 'omp', authType: 'none', defaultModel: 'anthropic/claude-sonnet-4-5', models: [{ id: 'anthropic/claude-sonnet-4-5', name: 'Sonnet' }], createdAt: 1 },
] }))
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
let writes = 0, created = 0, autoComplete = true
const completionListeners = new Set<(event: SessionCompletionEvent) => void>()
const lastCompletion = new Map<string, SessionCompletionEvent>()
const emitCompletion = (event: SessionCompletionEvent) => { for (const listener of completionListeners) listener(event) }
const manager = {
  waitForInit: async () => {}, getSessions: (id?: string) => sessions.filter(session => !id || session.workspaceId === id),
  async getSession(id: string) { return sessions.find(session => session.id === id) ?? null },
  getSessionWorkingDirectory: (id: string) => sessions.find(session => session.id === id)?.workingDirectory,
  getWorkspaces: () => roots, getWorkspacesInfo: () => roots,
  async updateSessionModel(id: string, _workspaceId: string, model: string | null, connection?: string) {
    writes++; const session = sessions.find(session => session.id === id)!; session.model = model ?? undefined
    if (connection) session.llmConnection = connection
    persist(); server.push(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: session.workspaceId }, { type: 'session_model_changed', sessionId: id, model: session.model })
  },
  setSessionPermissionMode(id: string, mode: 'safe' | 'ask' | 'allow-all') {
    writes++; const session = sessions.find(session => session.id === id)!
    const previousPermissionMode = session.permissionMode; session.permissionMode = mode; persist()
    server.push(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: session.workspaceId }, {
      type: 'permission_mode_changed', sessionId: id, permissionMode: mode, previousPermissionMode, modeVersion: writes,
      transitionDisplay: 'host-private-transition',
    })
  },
  onSessionComplete(listener: (event: SessionCompletionEvent) => void) { completionListeners.add(listener); return () => completionListeners.delete(listener) },
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
    const reply = { id: `reply-${writes}`, role: 'assistant' as const, content: 'Synthetic completed reply', timestamp: 4 }
    session.messages.push(reply); persist()
    for (const event of [{ type: 'user_message', sessionId: id, message, status: 'accepted' }, { type: 'text_delta', sessionId: id, delta: 'synthetic reply' }, { type: 'complete', sessionId: id }]) {
      server.push(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: session.workspaceId }, event)
    }
    const completion: SessionCompletionEvent = { workspaceId: session.workspaceId, sessionId: id, reason: 'complete', finalMessageId: reply.id }
    lastCompletion.set(id, completion)
    if (autoComplete) emitCompletion(completion)
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
  resolveLocalClientBinding: candidate => candidate.localClientProof === 'fixture-local-proof' && candidate.webContentsId === 91
    ? { workspaceId: 'workspace-a', webContentsId: 91 } : null,
  nativeEventChannels: new Set([RPC_CHANNELS.sessions.EVENT, RPC_CHANNELS.sources.CHANGED, RPC_CHANNELS.voice.JOB, RPC_CHANNELS.identity.CHANGED, RPC_CHANNELS.gamification.CHANGED, RPC_CHANNELS.toolchain.STATUS_CHANGED]),
  nativeClientEventChannels: new Set([RPC_CHANNELS.voice.JOB, RPC_CHANNELS.identity.CHANGED, RPC_CHANNELS.gamification.CHANGED, RPC_CHANNELS.toolchain.STATUS_CHANGED]),
  projectNativeEvent: (channel, args, id, principal) => projectNativeRegisteredWorkspaceEvent(authority, channel, args, id, principal, (sid, wid) => sessions.some(session => session.id === sid && session.workspaceId === wid)) })
const deps = { sessionManager: manager, nativeData: { authority }, platform: { logger: { info() {}, warn() {}, debug() {}, error() {} } } } as never
registerSessionsHandlers(server, deps); registerSourcesHandlers(server, deps); registerWorkspaceCoreHandlers(server, deps)
registerServerHandlers(server, deps, { serverId: 'fixture', startedAt: Date.now(), getConnectedClientCount: () => server.getConnectedClientCount() })
server.handle('fixture:client', context => context.clientId, { nativeAction: 'read' })
const clients: WsRpcClient[] = []
const connect = (issued: typeof writer, workspaceId = 'workspace-a', localProof?: string) => {
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token: issued.credential, workspaceId,
    mode: localProof ? 'local' : 'remote', webContentsId: localProof ? 91 : undefined, localClientProof: localProof,
    autoReconnect: false, requestTimeout: 1000, connectTimeout: 1000 })
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
    assert.deepEqual(eventsA, [{ type: 'error', sessionId: 'session-0', error: 'native-session-request-failed', errorCode: 'NATIVE_SESSION_REQUEST_FAILED' }]); assert.equal(eventsC.length, 0)
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
  } else if (mode === 'sources') {
    const snapshot = (path: string): unknown => {
      const stat = lstatSync(path)
      return [stat.mtimeMs, stat.isSymbolicLink() ? readlinkSync(path) : stat.isDirectory()
        ? readdirSync(path).sort().map(name => [name, snapshot(join(path, name))]) : readFileSync(path).toString('hex')]
    }
    const hostSnapshot = () => [snapshot(join(directory, 'config.json')), ...roots.map(workspace => snapshot(workspace.rootPath))]
    for (const key of ['EXA_API_KEY', 'CRAFT_EXA_API_KEY', 'ROX_EXA_API_KEY', 'FIRECRAWL_API_KEY', 'CRAFT_FIRECRAWL_API_KEY', 'ROX_FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'ROX_BRAVE_API_KEY', 'E2B_API_KEY', 'ROX_E2B_API_KEY']) delete process.env[key]
    const serviceFile = join(directory, 'fixture-service-secrets.env')
    process.env.ROX_SERVICE_SECRETS_FILE = serviceFile
    const assertDefaults = (value: LoadedSource[]) => {
      for (const slug of ['exa', 'firecrawl', 'brave', 'e2b']) assert(value.some((source: { config: { slug: string; enabled: boolean } }) => source.config.slug === slug && source.config.enabled))
      assert(!JSON.stringify(value).includes('host-private'))
      assert(!JSON.stringify(value).includes(roots[0]!.rootPath))
    }
    let probes = 0
    globalThis.fetch = Object.assign(() => { probes++; throw new Error('metadata read must not probe providers') }, { preconnect: () => {} }) as typeof fetch
    const sourcesDirectory = join(roots[0]!.rootPath, 'sources')
    renameSync(sourcesDirectory, `${sourcesDirectory}.original`)
    const missingBefore = hostSnapshot()
    const absent = await b.invoke(RPC_CHANNELS.sources.GET, 'workspace-a')
    assertDefaults(absent); assert.equal(absent.length, 4)
    for (const source of absent) assert.notEqual(source.config.isAuthenticated, true)
    assert.deepEqual(hostSnapshot(), missingBefore)
    writeFileSync(serviceFile, ['EXA_API_KEY', 'FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'E2B_API_KEY'].map(key => `${key}=host-private-synthetic-${key}`).join('\n'), { mode: 0o600 })
    const secretBefore = snapshot(serviceFile), configuredBefore = hostSnapshot()
    const provisioned = await b.invoke(RPC_CHANNELS.sources.GET, 'workspace-a')
    assertDefaults(provisioned)
    for (const source of provisioned) assert.equal(source.config.isAuthenticated, true)
    assert.deepEqual(hostSnapshot(), configuredBefore); assert.deepEqual(snapshot(serviceFile), secretBefore)
    renameSync(`${sourcesDirectory}.original`, sourcesDirectory)
    // Host-only guide/icon files are not read or returned by the display path.
    symlinkSync(join(roots[1]!.rootPath, 'config.json'), join(sourcePath, 'guide.md'))
    const configuredSourcesBefore = hostSnapshot()
    const own = await b.invoke(RPC_CHANNELS.sources.GET, 'workspace-a')
    assertDefaults(own); assert.equal(own.length, 5)
    const fixture = own.find((source: { config: { slug: string } }) => source.config.slug === 'fixture')
    assert(fixture); assert.equal(fixture.guide, null); assert.equal(fixture.config.api, undefined); assert.equal(fixture.config.local, undefined)
    assert.deepEqual(hostSnapshot(), configuredSourcesBefore)
    const fixtureConfigPath = join(sourcePath, 'config.json'), originalConfig = readFileSync(fixtureConfigPath, 'utf8')
    writeFileSync(fixtureConfigPath, JSON.stringify({ ...JSON.parse(originalConfig), icon: 'https://host.test/private-token', tagline: 'x'.repeat(1000) }))
    const boundedBefore = hostSnapshot(), bounded = (await b.invoke(RPC_CHANNELS.sources.GET, 'workspace-a')).find((source: { config: { slug: string } }) => source.config.slug === 'fixture')
    assert.equal(bounded.config.icon, undefined); assert.equal(bounded.config.tagline.length, 500); assert.deepEqual(hostSnapshot(), boundedBefore)
    writeFileSync(fixtureConfigPath, JSON.stringify({ ...JSON.parse(originalConfig), extra: 'x'.repeat(1024 * 1024) }))
    const oversizedBefore = hostSnapshot(); await denied(() => b.invoke(RPC_CHANNELS.sources.GET, 'workspace-a')); assert.deepEqual(hostSnapshot(), oversizedBefore)
    writeFileSync(fixtureConfigPath, originalConfig)
    const exaPath = join(sourcesDirectory, 'exa'); mkdirSync(exaPath)
    writeFileSync(join(exaPath, 'config.json'), JSON.stringify({ id: 'builtin-exa', slug: 'exa', name: 'Exa', provider: 'exa', type: 'api', enabled: false,
      api: { baseUrl: 'https://api.exa.ai', authType: 'header', headerName: 'x-api-key' } }))
    const disabledBefore = hostSnapshot(), disabled = await b.invoke(RPC_CHANNELS.sources.GET, 'workspace-a')
    assert.equal(disabled.filter((source: { config: { slug: string } }) => source.config.slug === 'exa').length, 1)
    assert.equal(disabled.find((source: { config: { slug: string } }) => source.config.slug === 'exa').config.enabled, false)
    assert.deepEqual(hostSnapshot(), disabledBefore)
    for (const path of [join(sourcePath, 'config.json'), sourcePath, sourcesDirectory]) {
      renameSync(path, `${path}.original`); symlinkSync(path.endsWith('config.json') ? join(roots[1]!.rootPath, 'config.json') : roots[1]!.rootPath, path)
      try { const before = hostSnapshot(); await denied(() => b.invoke(RPC_CHANNELS.sources.GET, 'workspace-a')); assert.deepEqual(hostSnapshot(), before) }
      finally { rmSync(path); renameSync(`${path}.original`, path) }
    }
    await denied(() => a.invoke(RPC_CHANNELS.sources.GET, 'workspace-b')); await denied(() => c.invoke(RPC_CHANNELS.sources.GET, 'workspace-a'))
    const originalRoot = roots[0]!.rootPath; roots[0]!.rootPath = roots[1]!.rootPath; saveRegistry()
    const driftBefore = hostSnapshot(); await denied(() => b.invoke(RPC_CHANNELS.sources.GET, 'workspace-a')); assert.deepEqual(hostSnapshot(), driftBefore)
    roots[0]!.rootPath = originalRoot; saveRegistry()
    authority.revokeWorkspaceGrant(admin.credential, reader.principal.subject, 'workspace-a')
    const revokedBefore = hostSnapshot(); await denied(() => b.invoke(RPC_CHANNELS.sources.GET, 'workspace-a')); assert.deepEqual(hostSnapshot(), revokedBefore)
    assert.equal(probes, 0); assert.deepEqual(snapshot(serviceFile), secretBefore)
  } else if (mode === 'roster') {
    let legacyReads = 0
    manager.getWorkspaces = manager.getWorkspacesInfo = () => { legacyReads++; throw new Error('native roster must not migrate host configuration') }
    const snapshot = (path: string): unknown => {
      const stat = lstatSync(path)
      return [stat.mtimeMs, stat.isSymbolicLink() ? readlinkSync(path) : stat.isDirectory()
        ? readdirSync(path).sort().map(name => [name, snapshot(join(path, name))]) : readFileSync(path).toString('hex')]
    }
    const registryPath = join(directory, 'config.json')
    const hostSnapshot = () => [snapshot(registryPath), ...roots.map(workspace => snapshot(workspace.rootPath))]
    const sourceEventsA: unknown[][] = [], sourceEventsB: unknown[][] = [], sourceEventsC: unknown[][] = []
    a.on(RPC_CHANNELS.sources.CHANGED, (...args) => sourceEventsA.push(args))
    b.on(RPC_CHANNELS.sources.CHANGED, (...args) => sourceEventsB.push(args))
    c.on(RPC_CHANNELS.sources.CHANGED, (...args) => sourceEventsC.push(args))
    const emit = () => {
      server.push(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'workspace-a' }, { type: 'text_delta', sessionId: 'session-0', delta: 'owned display update' })
      server.push(RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId: 'workspace-a' }, 'workspace-a', [{
        workspaceId: 'workspace-a', workspaceRootPath: roots[0]!.rootPath, folderPath: sourcePath, guide: 'host-private-guide',
        config: JSON.parse(readFileSync(join(sourcePath, 'config.json'), 'utf8')),
      }])
    }
    const ownBefore = hostSnapshot()
    for (const client of [a, b]) {
      const workspace = await client.invoke(RPC_CHANNELS.workspaces.GET, 'workspace-b')
      assert.deepEqual(workspace, [{ id: 'workspace-a', name: 'workspace-a', slug: 'workspace-a', rootPath: '', createdAt: roots[0]!.createdAt, kind: 'personal' }])
      const info = await client.invoke(RPC_CHANNELS.server.GET_WORKSPACES)
      assert.deepEqual(info, [{ id: 'workspace-a', name: 'workspace-a', slug: 'workspace-a', kind: 'personal' }])
    }
    assert.equal((await c.invoke(RPC_CHANNELS.workspaces.GET))[0].id, 'workspace-b')
    const foreign = connect(outsider, 'workspace-a')
    await denied(() => foreign.invoke(RPC_CHANNELS.workspaces.GET))
    await denied(() => foreign.invoke(RPC_CHANNELS.server.GET_WORKSPACES))
    emit(); await Promise.all([a.invoke('fixture:client'), b.invoke('fixture:client'), c.invoke('fixture:client')])
    assert.equal(eventsA.length, 1); assert.equal(eventsB.length, 1); assert.equal(eventsC.length, 0)
    assert.equal(sourceEventsA.length, 1); assert.equal(sourceEventsB.length, 1); assert.equal(sourceEventsC.length, 0)
    assert(!JSON.stringify([sourceEventsA, sourceEventsB]).includes('host-private'))
    assert(!JSON.stringify(sourceEventsA).includes(roots[0]!.rootPath))
    assert.deepEqual(hostSnapshot(), ownBefore)

    const assertQueriesDenied = async () => {
      const before = hostSnapshot(), prior = [eventsA.length, eventsB.length, sourceEventsA.length, sourceEventsB.length]
      for (const client of [a, b]) for (const channel of [RPC_CHANNELS.workspaces.GET, RPC_CHANNELS.server.GET_WORKSPACES]) await denied(() => client.invoke(channel))
      emit(); await c.invoke('fixture:client'); await new Promise(resolve => setTimeout(resolve, 10))
      assert.deepEqual([eventsA.length, eventsB.length, sourceEventsA.length, sourceEventsB.length], prior)
      assert.deepEqual(hostSnapshot(), before)
    }
    // Canonical registry drift, a foreign registry symlink, and a replaced root
    // all deny both roster access and delivery from the headless event projector.
    const originalRoot = roots[0]!.rootPath
    roots[0]!.rootPath = roots[1]!.rootPath; saveRegistry()
    await assertQueriesDenied()
    roots[0]!.rootPath = originalRoot; saveRegistry()
    renameSync(registryPath, `${registryPath}.original`); symlinkSync(join(roots[1]!.rootPath, 'config.json'), registryPath)
    try { await assertQueriesDenied() } finally { rmSync(registryPath); renameSync(`${registryPath}.original`, registryPath) }
    renameSync(originalRoot, `${originalRoot}.original`); symlinkSync(roots[1]!.rootPath, originalRoot)
    try {
      // The original source lives under the renamed root during this substitution.
      for (const client of [a, b]) for (const channel of [RPC_CHANNELS.workspaces.GET, RPC_CHANNELS.server.GET_WORKSPACES]) await denied(() => client.invoke(channel))
      const before = [eventsA.length, eventsB.length]
      server.push(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'workspace-a' }, { type: 'text_delta', sessionId: 'session-0', delta: 'must not deliver from replacement root' })
      await c.invoke('fixture:client'); await new Promise(resolve => setTimeout(resolve, 10))
      assert.deepEqual([eventsA.length, eventsB.length], before)
    } finally { rmSync(originalRoot); renameSync(`${originalRoot}.original`, originalRoot) }
    authority.revokeWorkspaceGrant(admin.credential, writer.principal.subject, 'workspace-a')
    authority.revokeWorkspaceGrant(admin.credential, reader.principal.subject, 'workspace-a')
    await assertQueriesDenied()
    assert.equal(legacyReads, 0)
  } else if (mode === 'sidebar') {
    registerStatusesHandlers(server, deps); registerLabelsHandlers(server, deps); registerProjectsHandlers(server, deps)
    const workspace = roots[0]!
    const channels = [RPC_CHANNELS.statuses.LIST, RPC_CHANNELS.labels.LIST, RPC_CHANNELS.views.LIST, RPC_CHANNELS.projects.GET]
    const snapshot = (root: string): unknown[] => readdirSync(root).sort().map(name => {
      const path = join(root, name), stat = lstatSync(path)
      return [name, stat.mtimeMs, stat.isDirectory() ? snapshot(path) : readFileSync(path).toString('hex')]
    })
    // A read-only enrolled actor must not seed labels/views/config or self-heal status icons.
    const emptyBefore = snapshot(workspace.rootPath)
    await b.invoke(RPC_CHANNELS.sessions.GET)
    await b.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, 'session-0')
    for (const channel of channels) assert(Array.isArray(await b.invoke(channel, 'workspace-a')))
    assert.deepEqual(snapshot(workspace.rootPath), emptyBefore)
    mkdirSync(join(workspace.rootPath, 'statuses'), { recursive: true })
    writeFileSync(join(workspace.rootPath, 'statuses', 'config.json'), JSON.stringify({ version: 1, defaultStatusId: 'todo', statuses: [
      ...getDefaultStatusConfig().statuses,
      { id: 'custom', label: 'Custom queue', category: 'open', isFixed: false, isDefault: false, order: 8, icon: '/host/private/icon.svg', secret: 'host-private-status-secret' },
    ] }))
    mkdirSync(join(workspace.rootPath, 'labels'), { recursive: true })
    writeFileSync(join(workspace.rootPath, 'labels', 'config.json'), JSON.stringify({ version: 1, labels: [
      { id: 'group', name: 'Group', color: { light: '#123456', secret: 'host-private-color-secret' }, autoRules: [{ pattern: 'host-private-rule-secret' }], children: [{ id: 'nested', name: 'Nested' }] },
    ] }))
    writeFileSync(join(workspace.rootPath, 'views.json'), JSON.stringify({ version: 2, views: [{ id: 'saved-view', name: 'Saved view', expression: 'hasUnread == true',
      knowledgeFilter: { pathPrefix: '/host/private' }, presetActions: [{ type: 'run_skill', skill: 'host-private-skill' }] }] }))
    const projectPath = join(workspace.rootPath, 'projects', 'own-project'); mkdirSync(projectPath, { recursive: true })
    writeFileSync(join(projectPath, 'config.json'), JSON.stringify({ id: 'own-project-id', slug: 'own-project', name: 'Own project', createdAt: 1, updatedAt: 2,
      workingDirectory: '/host/private/repository', details: 'host-private-system-context', repositoryConnection: { secret: 'host-private-repository-secret' }, icon: '/host/private/icon.png' }))
    const configuredBefore = snapshot(workspace.rootPath)
    for (const channel of channels) {
      const value = await b.invoke(channel, 'workspace-a'); assert(Array.isArray(value)); assert(!JSON.stringify(value).includes('host-private')); assert(!JSON.stringify(value).includes('/host/private'))
      await denied(() => a.invoke(channel, 'workspace-b')); await denied(() => c.invoke(channel, 'workspace-a'))
    }
    const statuses = await b.invoke(RPC_CHANNELS.statuses.LIST, 'workspace-a')
    for (const expected of ['backlog', 'todo', 'in-progress', 'needs-review', 'done', 'cancelled']) assert(statuses.some((status: { id: string }) => status.id === expected))
    assert.equal(new Set(statuses.filter((status: { id: string }) => status.id !== 'custom').map((status: { icon: string }) => status.icon)).size, 6)
    const labels = await b.invoke(RPC_CHANNELS.labels.LIST, 'workspace-a'); assert.equal(labels[0].children[0].id, 'nested')
    const projects = await b.invoke(RPC_CHANNELS.projects.GET, 'workspace-a'); assert.equal(projects[0].workspaceId, 'workspace-a'); assert.equal(projects[0].workspaceRootPath, ''); assert.equal(projects[0].config.workingDirectory, undefined)
    assert.deepEqual(snapshot(workspace.rootPath), configuredBefore)
    // Workspace-contained metadata names may not resolve to another workspace's config.
    for (const [channel, path] of [
      [RPC_CHANNELS.statuses.LIST, join(workspace.rootPath, 'statuses', 'config.json')],
      [RPC_CHANNELS.labels.LIST, join(workspace.rootPath, 'labels', 'config.json')],
      [RPC_CHANNELS.views.LIST, join(workspace.rootPath, 'views.json')],
      [RPC_CHANNELS.projects.GET, join(projectPath, 'config.json')],
    ] as const) {
      renameSync(path, `${path}.original`); symlinkSync(join(roots[1]!.rootPath, 'config.json'), path)
      try { await denied(() => b.invoke(channel, 'workspace-a')) }
      finally { rmSync(path); renameSync(`${path}.original`, path) }
    }
    const labelDirectory = join(workspace.rootPath, 'labels')
    renameSync(labelDirectory, `${labelDirectory}.original`); symlinkSync(roots[1]!.rootPath, labelDirectory)
    try { await denied(() => b.invoke(RPC_CHANNELS.labels.LIST, 'workspace-a')) }
    finally { rmSync(labelDirectory); renameSync(`${labelDirectory}.original`, labelDirectory) }
    await denied(() => a.invoke(RPC_CHANNELS.statuses.REORDER, 'workspace-a', [])); await denied(() => a.invoke(RPC_CHANNELS.labels.CREATE, 'workspace-a', { name: 'No native mutation' }))
    await denied(() => a.invoke(RPC_CHANNELS.views.SAVE, 'workspace-a', [])); await denied(() => a.invoke(RPC_CHANNELS.projects.CREATE, 'workspace-a', { name: 'No host repository creation' }))
    authority.revokeWorkspaceGrant(admin.credential, reader.principal.subject, 'workspace-a')
    for (const channel of channels) await denied(() => b.invoke(channel, 'workspace-a'))
    roots[0]!.rootPath += '-moved'; saveRegistry()
    for (const channel of channels) await denied(() => a.invoke(channel, 'workspace-a'))
  } else if (mode === 'permission') {
    for (const permissionMode of ['safe', 'ask', 'allow-all'] as const) {
      await a.invoke(RPC_CHANNELS.sessions.COMMAND, 'session-0', { type: 'setPermissionMode', mode: permissionMode })
      const session = await b.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, 'session-0')
      assert.equal(session.permissionMode, permissionMode)
      assert.equal(JSON.parse(readFileSync(canonical, 'utf8'))[0].permissionMode, permissionMode)
      assert(eventsA.some(event => event.type === 'permission_mode_changed' && event.permissionMode === permissionMode))
      assert(eventsB.some(event => event.type === 'permission_mode_changed' && event.permissionMode === permissionMode))
    }
    assert(!eventsC.some(event => event.type === 'permission_mode_changed'))
    assert(!JSON.stringify(eventsB).includes('host-private'))
    const before = writes
    for (const [client, sessionId] of [[b, 'session-0'], [a, 'session-1'], [c, 'session-0']] as const) {
      await denied(() => client.invoke(RPC_CHANNELS.sessions.COMMAND, sessionId, { type: 'setPermissionMode', mode: 'safe' }))
    }
    for (const value of [undefined, null, 'standard', 'yolo', {}, [], 3]) {
      await denied(() => a.invoke(RPC_CHANNELS.sessions.COMMAND, 'session-0', { type: 'setPermissionMode', mode: value }))
    }
    const originalRoot = roots[0]!.rootPath
    roots[0]!.rootPath += '-moved'; saveRegistry()
    await denied(() => a.invoke(RPC_CHANNELS.sessions.COMMAND, 'session-0', { type: 'setPermissionMode', mode: 'ask' }))
    roots[0]!.rootPath = originalRoot; saveRegistry()
    authority.revokeWorkspaceGrant(admin.credential, writer.principal.subject, 'workspace-a')
    await denied(() => a.invoke(RPC_CHANNELS.sessions.COMMAND, 'session-0', { type: 'setPermissionMode', mode: 'safe' }))
    assert.equal(writes, before)
  } else if (mode === 'model') {
    registerSettingsHandlers(server, deps)
    registerLlmConnectionsHandlers(server, deps)
    const snapshot = (path: string): unknown => {
      const stat = lstatSync(path)
      return [stat.mtimeMs, stat.isSymbolicLink() ? readlinkSync(path) : stat.isDirectory()
        ? readdirSync(path).sort().map(name => [name, snapshot(join(path, name))]) : readFileSync(path).toString('hex')]
    }
    const hostSnapshot = () => [snapshot(join(directory, 'config.json')), ...roots.map(workspace => snapshot(workspace.rootPath))]
    const configs = roots.map(workspace => readFileSync(join(workspace.rootPath, 'config.json'), 'utf8'))
    // Enrolled read-only actors may inspect missing workspace configuration,
    // but they must not bind/create folders or touch the foreign workspace.
    for (const workspace of roots) rmSync(join(workspace.rootPath, 'config.json'))
    sessions[0]!.llmConnection = undefined; persist()
    const missingBefore = hostSnapshot()
    assert.equal((await b.invoke(RPC_CHANNELS.sessions.GET_MODEL_CATALOG, 'session-0')).slug, 'workspace-rox')
    assert.equal((await b.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)).slug, 'workspace-rox')
    await denied(() => b.invoke(RPC_CHANNELS.sessions.GET_MODEL_CATALOG, 'session-1'))
    await denied(() => a.invoke(RPC_CHANNELS.sessions.SET_MODEL, 'session-0', 'workspace-a', 'unknown/model'))
    assert.deepEqual(hostSnapshot(), missingBefore)
    for (const [index, workspace] of roots.entries()) writeFileSync(join(workspace.rootPath, 'config.json'), configs[index]!)
    sessions[0]!.llmConnection = 'workspace-rox'; persist()
    const configuredBefore = hostSnapshot()
    const defaultCatalog = await b.invoke(RPC_CHANNELS.sessions.GET_MODEL_CATALOG, 'session-0')
    assert.deepEqual(defaultCatalog, { kind: 'configuration-only', sessionId: 'session-0', workspaceId: 'workspace-a', slug: 'workspace-rox', providerType: 'omp',
      defaultModel: 'rox/r1-max', models: [{ id: 'rox/r1-max', name: 'Rox R1 Max', supportsThinking: true, contextWindow: 1048576 }] })
    assert.equal(Object.hasOwn(defaultCatalog, 'isDefault'), false)
    assert.equal(Object.hasOwn(defaultCatalog, 'isAuthenticated'), false)
    assert.equal(Object.hasOwn(defaultCatalog, 'name'), false)
    await denied(() => a.invoke(RPC_CHANNELS.sessions.GET_MODEL_CATALOG, 'session-1'))
    await denied(() => c.invoke(RPC_CHANNELS.sessions.GET_MODEL_CATALOG, 'session-0'))
    assert.equal(await a.invoke(RPC_CHANNELS.sessions.GET_MODEL, 'session-0', 'workspace-a'), null)
    const before = writes
    for (const [client, sessionId, workspaceId, model, connection] of [
      [b, 'session-0', 'workspace-a', 'rox/r1-max', 'workspace-rox'],
      [a, 'session-1', 'workspace-a', 'rox/r1-max', 'workspace-rox'],
      [a, 'session-0', 'workspace-b', 'rox/r1-max', 'workspace-rox'],
      [a, 'session-0', 'workspace-a', 'rox/standard', 'workspace-rox'],
      [a, 'session-0', 'workspace-a', 'private-model', 'private-provider'],
      [a, 'session-0', 'workspace-a', null, 'workspace-rox'],
    ] as const) await denied(() => client.invoke(RPC_CHANNELS.sessions.SET_MODEL, sessionId, workspaceId, model, connection))
    await denied(() => a.invoke(RPC_CHANNELS.sessions.GET_MODEL, 'session-1', 'workspace-a'))
    await denied(() => a.invoke(RPC_CHANNELS.sessions.GET_MODEL, 'session-0', 'workspace-b'))
    assert.equal(writes, before)
    assert.equal((await b.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)).slug, 'workspace-rox')
    assert.deepEqual(hostSnapshot(), configuredBefore)
    await a.invoke(RPC_CHANNELS.sessions.SET_MODEL, 'session-0', 'workspace-a', 'rox/r1-max', 'workspace-rox')
    assert.equal(await a.invoke(RPC_CHANNELS.sessions.GET_MODEL, 'session-0', 'workspace-a'), 'rox/r1-max')
    assert.equal(JSON.parse(readFileSync(canonical, 'utf8'))[0].model, 'rox/r1-max')
    assert(eventsA.some(event => event.type === 'session_model_changed' && event.model === 'rox/r1-max'))
    assert(!eventsC.some(event => event.type === 'session_model_changed'))
    const customSummary = publicRuntimeSummary(readNativeRuntimeConnection('private-omp')!, true)
    assert.deepEqual(customSummary.models, [{ id: 'anthropic/claude-sonnet-4-5', name: 'Sonnet' }])
    assert.equal(customSummary.defaultModel, 'anthropic/claude-sonnet-4-5')
    sessions[0]!.llmConnection = 'private-omp'; persist()
    const lockedBefore = hostSnapshot()
    const lockedCatalog = await b.invoke(RPC_CHANNELS.sessions.GET_MODEL_CATALOG, 'session-0')
    assert.equal(lockedCatalog.slug, 'private-omp'); assert.equal(lockedCatalog.defaultModel, 'anthropic/claude-sonnet-4-5')
    assert.deepEqual(lockedCatalog.models, [{ id: 'anthropic/claude-sonnet-4-5', name: 'Sonnet' }])
    assert(!JSON.stringify(lockedCatalog).includes('PRIVATE')); assert.equal(Object.hasOwn(lockedCatalog, 'isDefault'), false)
    assert.equal((await b.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)).slug, 'workspace-rox')
    await denied(() => a.invoke(RPC_CHANNELS.sessions.SET_MODEL, 'session-0', 'workspace-a', 'rox/r1-max', 'private-omp'))
    assert.deepEqual(hostSnapshot(), lockedBefore)
    await a.invoke(RPC_CHANNELS.sessions.SET_MODEL, 'session-0', 'workspace-a', 'anthropic/claude-sonnet-4-5', 'private-omp')
    assert.equal(await a.invoke(RPC_CHANNELS.sessions.GET_MODEL, 'session-0', 'workspace-a'), 'anthropic/claude-sonnet-4-5')
    sessions[0]!.llmConnection = 'removed-omp'; persist()
    assert.equal(await a.invoke(RPC_CHANNELS.sessions.GET_MODEL_CATALOG, 'session-0'), null)
    sessions[0]!.llmConnection = undefined; persist()
    assert.equal((await a.invoke(RPC_CHANNELS.sessions.GET_MODEL_CATALOG, 'session-0')).slug, 'workspace-rox')
    sessions[0]!.llmConnection = 'workspace-rox'; persist()
    // A workspace config symlink is never followed to a foreign selection.
    const ownConfig = join(roots[0]!.rootPath, 'config.json'), foreignConfig = join(roots[1]!.rootPath, 'config.json')
    writeFileSync(foreignConfig, JSON.stringify({ defaults: { defaultLlmConnection: 'private-provider' }, secret: 'foreign-private-settings' }))
    rmSync(ownConfig); symlinkSync(foreignConfig, ownConfig)
    const symlinkBefore = hostSnapshot()
    assert.equal((await b.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)).slug, 'workspace-rox')
    sessions[0]!.llmConnection = undefined; persist()
    assert.equal((await b.invoke(RPC_CHANNELS.sessions.GET_MODEL_CATALOG, 'session-0')).slug, 'workspace-rox')
    assert.deepEqual(hostSnapshot(), symlinkBefore)
    rmSync(ownConfig); writeFileSync(ownConfig, configs[0]!); writeFileSync(foreignConfig, configs[1]!)
    sessions[0]!.llmConnection = 'workspace-rox'; persist()
    const original = manager.getSession
    for (const channel of [RPC_CHANNELS.sessions.GET_MODEL_CATALOG, RPC_CHANNELS.sessions.SET_MODEL]) for (const change of ['revoke', 'root', 'disconnect'] as const) {
      const client = connect(writer); await barrier(client)
      let release!: () => void, started!: () => void
      const held = new Promise<void>(resolve => { release = resolve }), entered = new Promise<void>(resolve => { started = resolve })
      manager.getSession = async id => { started(); await held; return original(id) }
      const snapshot = writes
      const args = channel === RPC_CHANNELS.sessions.GET_MODEL_CATALOG ? ['session-0'] : ['session-0', 'workspace-a', 'rox/r1-max']
      const pending = client.invoke(channel, ...args).then(() => false, () => true)
      await entered
      if (change === 'revoke') authority.revokeWorkspaceGrant(admin.credential, writer.principal.subject, 'workspace-a')
      if (change === 'root') { roots[0]!.rootPath += '-moved'; saveRegistry() }
      if (change === 'disconnect') { client.destroy(); await new Promise(resolve => setTimeout(resolve, 20)) }
      release(); assert.equal(await pending, true); assert.equal(writes, snapshot)
      manager.getSession = original
      if (change === 'revoke') authority.grantWorkspace(admin.credential, writer.principal.subject, 'workspace-a', ['read', 'write', 'subscribe'])
      if (change === 'root') { roots[0]!.rootPath = roots[0]!.rootPath.replace(/-moved$/, ''); saveRegistry() }
    }
  } else if (mode === 'runtime') {
    const toolchain = getToolchainManager()
    let installs = 0, listener: ((status: ToolStatus) => void) | undefined
    const status: ToolStatus = { name: 'omp', phase: 'error', installedVersion: '18.4.12', installedPath: '/host/private/runtime', error: 'host-private-provider-secret' }
    toolchain.status = async () => [status]; toolchain.update = async () => { installs++; return status }; toolchain.ensureAll = async () => []
    toolchain.onStatusChange = callback => { listener = callback; return () => { listener = undefined } }
    registerToolchainHandlers(server, deps)
    const initial = await a.invoke(RPC_CHANNELS.toolchain.STATUS); assert.equal(initial[0].installedVersion, '18.4.12'); assert.equal(initial[0].installedPath, undefined); assert.equal(initial[0].error, 'RUNTIME_UNAVAILABLE')
    await denied(() => a.invoke(RPC_CHANNELS.toolchain.UPDATE, 'omp')); await denied(() => a.invoke(RPC_CHANNELS.toolchain.GET_DISABLED)); await denied(() => a.invoke(RPC_CHANNELS.toolchain.SET_DISABLED, []))
    const spoofed = connect(writer, 'workspace-a', 'forged-local-proof'); await barrier(spoofed); await denied(() => spoofed.invoke(RPC_CHANNELS.toolchain.UPDATE, 'omp'))
    assert.equal(installs, 0)
    const local = connect(writer, 'workspace-a', 'fixture-local-proof'); await barrier(local)
    const updated = await local.invoke(RPC_CHANNELS.toolchain.UPDATE, 'omp'); assert.equal(installs, 1); assert.equal(updated.installedPath, undefined)
    const disabled = await local.invoke(RPC_CHANNELS.toolchain.GET_DISABLED); assert(Array.isArray(disabled))
    await local.invoke(RPC_CHANNELS.toolchain.SET_DISABLED, ['fzf']); assert((await local.invoke(RPC_CHANNELS.toolchain.GET_DISABLED)).includes('fzf'))
    const progressA: ToolStatus[] = [], progressB: ToolStatus[] = []; a.on(RPC_CHANNELS.toolchain.STATUS_CHANGED, value => progressA.push(value)); b.on(RPC_CHANNELS.toolchain.STATUS_CHANGED, value => progressB.push(value))
    listener!({ ...status, phase: 'downloading', downloadedBytes: 10, totalBytes: 100 }); await barrier(a)
    assert.equal(progressA.length, 1); assert.equal(progressA[0]!.installedPath, undefined); assert.equal(progressB.length, 0)
    authority.revokeWorkspaceGrant(admin.credential, writer.principal.subject, 'workspace-a'); listener!(status); await barrier(b); assert.equal(progressA.length, 1)
    server.close(); assert.equal(listener, undefined)
  } else if (mode === 'completion') {
    const host = { ...getDefaultGamificationState(), xp: 777 }; saveGamificationState(host, directory)
    const hostFile = join(directory, 'gamification.json'), hostBefore = readFileSync(hostFile, 'utf8')
    registerGamificationHandlers(server, deps)
    const xp = async (client: WsRpcClient) => (await client.invoke(RPC_CHANNELS.gamification.GET)).xp as number
    const settle = async () => { await new Promise(resolve => setTimeout(resolve, 20)); await barrier(b) }
    const ownEvents: unknown[] = [], readerEvents: unknown[] = []; a.on(RPC_CHANNELS.gamification.CHANGED, value => ownEvents.push(value)); b.on(RPC_CHANNELS.gamification.CHANGED, value => readerEvents.push(value))
    assert.equal(await xp(a), 0); assert.equal(await xp(b), 0)
    await a.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-0', 'complete one'); await settle(); assert.equal(await xp(a), 25)
    const completed = lastCompletion.get('session-0')!; emitCompletion(completed); await settle(); assert.equal(await xp(a), 25)
    await a.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-0', 'complete two'); await settle(); assert.equal(await xp(a), 50); assert.equal(await xp(b), 0)
    assert.equal(ownEvents.length, 2); assert.equal(readerEvents.length, 0)
    autoComplete = false
    for (const reason of ['error', 'interrupted', 'timeout'] as const) {
      await a.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-0', reason); emitCompletion({ ...lastCompletion.get('session-0')!, reason }); await settle(); assert.equal(await xp(a), 50)
    }
    await a.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-0', 'revoked before completion')
    authority.revokeWorkspaceGrant(admin.credential, writer.principal.subject, 'workspace-a'); authority.grantWorkspace(admin.credential, writer.principal.subject, 'workspace-a', ['read', 'write', 'subscribe'])
    emitCompletion(lastCompletion.get('session-0')!); await settle(); assert.equal(await xp(a), 50)
    await a.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-0', 'disconnected before completion'); a.destroy(); await settle(); emitCompletion(lastCompletion.get('session-0')!); await settle()
    const renewed = connect(writer); await barrier(renewed); assert.equal(await xp(renewed), 50)
    await denied(() => b.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-0', 'read-only fake completion')); assert.equal(await xp(b), 0)
    assert.equal(readFileSync(hostFile, 'utf8'), hostBefore)
  } else throw Error('Unknown fixture case')
  console.log(`native session ${mode} passed`)
} finally { for (const client of clients) client.destroy(); await new Promise(resolve => setTimeout(resolve, 20)); server.close(); authority.close() }
