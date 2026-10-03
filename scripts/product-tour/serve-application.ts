/** TEST ONLY: authenticated WebUI App + native Notes stores, not desktop startup or OS custody.
 * Shell presentation is synthetic; read-only session storage and Electron window/credential custody are explicit DI.
 */
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createServer } from 'vite'
import type { BrowserWindow, IpcMain } from 'electron'
import type { Session } from '../../packages/shared/src/protocol'

const repository = resolve(import.meta.dirname, '../..')
const profile = realpathSync(mkdtempSync(join(tmpdir(), 'rox-product-tour-app-')))
const config = join(profile, 'config')
mkdirSync(config)
process.env.ROX_CONFIG_DIR = config
process.env.CRAFT_CONFIG_DIR = config
copyFileSync(join(repository, 'apps/electron/resources/config-defaults.json'), join(config, 'config-defaults.json'))
// These imports must occur after config isolation; no developer profile is opened.
const { NativeAuthority } = await import('../../packages/server-core/src/authority/native-authority')
const { NativeJournal } = await import('../../packages/server-core/src/authority/native-journal')
const { CollaborationSyncService } = await import('../../packages/server-core/src/collaboration/sync-service')
const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
const { registerNativeDataHandlers } = await import('../../packages/server-core/src/handlers/rpc/native-data')
const { registerNotesHandlers } = await import('../../packages/server-core/src/handlers/rpc/notes')
const { projectNativeNotesChanged } = await import('../../packages/server-core/src/handlers/rpc/native-notes-events')
const { registerSessionsHandlers } = await import('../../packages/server-core/src/handlers/rpc/sessions')
const { createSession, listSessions, getSessionPath } = await import('../../packages/shared/src/sessions/storage')
const { registerNativeReplicaForWindows } = await import('../../apps/electron/src/main/native-replica-bootstrap')
const { CHANNEL_MAP } = await import('../../apps/electron/src/transport/channel-map')
const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol')

const authority = new NativeAuthority({ stateDir: join(profile, 'state') })
const originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin
try {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  admin = authority.bootstrapLocalAdministrator('product-tour owned test operator')
} finally {
  if (originalTTY) Object.defineProperty(process.stdin, 'isTTY', originalTTY)
  else Reflect.deleteProperty(process.stdin, 'isTTY')
}
const workspaceId = 'product-tour-owned-workspace'
const workspaceRoot = join(profile, 'workspace')
mkdirSync(workspaceRoot)
const workspace = authority.registerWorkspace(admin.credential, workspaceId, workspaceRoot)
const issued = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'product-tour owned browser', Date.now() + 3_600_000), 'product-tour owned browser')!
authority.grantWorkspace(admin.credential, issued.principal.subject, workspaceId, ['read', 'write', 'delete', 'subscribe'])
const principal = authority.authenticate(issued.credential)!
authority.updateSelfProfile(principal, workspaceId, { name: 'Product Tour Test' })
// Host metadata exists only in the throwaway profile. Domain writes use the native journal.
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [{ id: workspaceId, name: 'Tour QA', rootPath: workspaceRoot, kind: 'local', createdAt: Date.now() }], activeWorkspaceId: workspaceId }))
writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({ id: workspaceId, name: 'Tour QA', createdAt: Date.now(), defaults: { permissionMode: 'allow-all' } }))
// Canonical empty JSONL sessions prove scoped reads without starting an agent,
// migrating credentials, or bootstrapping the desktop SessionManager/automations.
const ownedSession = await createSession(workspaceRoot, { name: 'Owned native metadata', workingDirectory: workspaceRoot })
const foreignWorkspaceId = 'product-tour-ungranted-workspace'
const foreignWorkspaceRoot = join(profile, 'ungranted-workspace')
mkdirSync(foreignWorkspaceRoot)
authority.registerWorkspace(admin.credential, foreignWorkspaceId, foreignWorkspaceRoot)
const foreignSession = await createSession(foreignWorkspaceRoot, { name: 'Foreign native metadata', workingDirectory: foreignWorkspaceRoot })
const storedWorkspaces = [
  { id: workspaceId, name: 'Tour QA', rootPath: workspaceRoot },
  { id: foreignWorkspaceId, name: 'Ungrantable fixture', rootPath: foreignWorkspaceRoot },
]
const sessionStore = {
  waitForInit: async () => {}, // Both canonical seed writes above have completed.
  getSessions: (id?: string): Session[] => storedWorkspaces.filter(item => !id || item.id === id).flatMap(item =>
    listSessions(item.rootPath).map(metadata => ({ ...metadata, workspaceId: item.id, workspaceName: item.name,
      messages: [], isProcessing: false, sessionFolderPath: getSessionPath(item.rootPath, metadata.id) }))),
  getSession: async (id: string) => sessionStore.getSessions().find(session => session.id === id) ?? null,
}

const journal = new NativeJournal({
  stateDir: join(profile, 'state'),
  authorize: (...args) => authority.authorize(...args),
  permissionFence: (...args) => authority.permissionFence(...args),
  authorizePreparedRecovery: (...args) => authority.authorizePreparedRecovery(...args),
})
const operations: Array<{ channel: string; method: string }> = []
const senders = new Map<number, EventEmitter & { id: number; mainFrame: { url: string }; isDestroyed(): boolean }>()
let nextWebContentsId = 100
function closeWindow(id: number) {
  const sender = senders.get(id)
  if (!sender) return
  senders.delete(id); sender.emit('destroyed')
}
const rpc = new WsRpcServer({
  host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
  nativeEventChannels: new Set([RPC_CHANNELS.notes.CHANGED]),
  projectNativeEvent: (channel, args, id, actor) => channel === RPC_CHANNELS.notes.CHANGED
    ? projectNativeNotesChanged(authority, args, id, actor) : null,
  resolveLocalClientBinding: candidate => candidate.localClientProof === 'owned-product-tour-bootstrap' && typeof candidate.webContentsId === 'number' && senders.has(candidate.webContentsId) && candidate.workspaceId === workspaceId
    ? { workspaceId, webContentsId: candidate.webContentsId } : null,
})
const registered = new Set<string>()
const realHandle = rpc.handle.bind(rpc)
rpc.handle = (channel, handler, options) => {
  registered.add(channel)
  realHandle(channel, async (context, ...args) => {
    operations.push({ channel, method: Object.entries(CHANNEL_MAP).find(([, value]) => value.channel === channel)?.[0] ?? channel })
    return handler(context, ...args)
  }, options)
}
const deps = {
  sessionManager: sessionStore,
  nativeData: { authority, journal, sync: new CollaborationSyncService(authority, journal) },
  platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
} as unknown as import('../../packages/server-core/src/handlers/handler-deps').HandlerDeps
registerNativeDataHandlers(rpc, deps)
registerNotesHandlers(rpc, deps)
// Register the unchanged production authenticated read handlers only. This
// adapter does not claim SessionManager startup, message sending, or desktop inventory success.
const sessionReadChannels = new Set<string>([RPC_CHANNELS.sessions.GET, RPC_CHANNELS.sessions.GET_MESSAGES])
registerSessionsHandlers(new Proxy(rpc, { get(target, property) {
  if (property === 'handle') return ((channel, handler, options) => {
    if (sessionReadChannels.has(channel)) target.handle(channel, handler, options)
  }) as typeof rpc.handle
  const value = Reflect.get(target, property, target)
  return typeof value === 'function' ? value.bind(target) : value
} }), deps)

const shellReplies: Record<string, unknown> = {
  // This fixture exercises the production app/native domain in explicit
  // non-cloud mode. Account login and billing have separate authority tests.
  getRoxCloudState: { required: false, connected: false },
  getWorkspaces: [{ id: workspaceId, name: 'Tour QA', rootPath: '', kind: 'personal', createdAt: Date.now() }],
  getWindowWorkspace: workspaceId, getOrgIdentity: { userId: issued.principal.subject, issuer: principal.issuer, name: 'Product Tour Test', authority: 'native' },
  getPreferences: { language: 'en', name: 'Product Tour Test' }, getAppVersion: 'acceptance-harness',
  getWorkspaceSettings: { name: 'Tour QA', defaults: { permissionMode: 'allow-all' } },
  getStartupRuntimeSummary: { kind: 'configuration-only', isDefault: true, providerType: 'omp', slug: 'rox-kimi' },
  getAllDrafts: {}, getAppTheme: 'system', getColorTheme: 'default', getWorkspaceColorTheme: null,
  getNotificationsEnabled: false, checkGitBash: { available: true }, getUnreadSummary: {}, getSessionUnreadSummary: {},
  getGlobalPermissions: { defaultMode: 'allow-all' }, getToolIcons: {}, getUserPreferences: {},
  getUpdateInfo: { status: 'up-to-date' }, getLlmConnection: null, getDefaultLlmConnection: 'rox-kimi',
  getMemorySettings: { enabled: false }, getMemoryOnboardingStatus: { completed: false },
  getSessionOptions: { permissionMode: 'allow-all' }, getEnabledModelIds: [],
  getGamificationProfile: { xp: 0, level: 1, progress: 0, balance: null, weeklyXp: { current: 0, previous: 0 }, quests: [], questRecords: [], ratings: [], analyticsConsent: false },
}
const emptyReads = new Set(['getSources', 'getSkills', 'getProjects', 'getLabels', 'getStatuses', 'getSessionStatuses', 'getWorkspaceSources', 'getWorkspaceSkills', 'getWorkspaceProjects', 'getWorkspaceLabels', 'getWorkspaceSessionStatuses', 'listLlmConnections', 'listLlmConnectionsWithStatus', 'getSessionTodo', 'getFeedSources', 'listOrganizations', 'getCustomThemes', 'getAutomations', 'getMemoryEntries', 'getNavigationHistory', 'getPluginRegistry', 'getPersonalTasks', 'listLabels', 'listViews', 'getPages'])
for (const [method, entry] of Object.entries(CHANNEL_MAP)) {
  if (entry.type !== 'invoke' || registered.has(entry.channel)) continue
  if (method in shellReplies || emptyReads.has(method)) {
    rpc.handle(entry.channel, () => shellReplies[method] ?? [], {
      access: method === 'listLlmConnectionsWithStatus' ? 'localElectron' : undefined,
      nativeAction: 'read',
    })
  }
}
await rpc.listen()

// In-process IPC adapter, with the production main queue and production preload bridge.
// This is application harness evidence, never OS/Electron IPC custody evidence.
const ipcHandlers = new Map<string, (...args: any[]) => any>()
const credentials = new Map<string, import('../../packages/shared/src/credentials/types').StoredCredential>()
const disposeReplica = registerNativeReplicaForWindows({ handle(channel: string, fn: (...args: any[]) => any) { ipcHandlers.set(channel, fn) }, removeHandler(channel: string) { ipcHandlers.delete(channel) } } as unknown as IpcMain, {
  configDir: config,
  credentials: { get: async id => credentials.get(JSON.stringify(id)) ?? null, set: async (id, value) => { credentials.set(JSON.stringify(id), value) } },
  getWindowManager: () => ({
    getWindowByWebContentsId: id => {
      const sender = senders.get(id)
      return sender ? { webContents: sender, isDestroyed: () => sender.isDestroyed() } as unknown as BrowserWindow : null
    },
    getWorkspaceForWindow: id => senders.has(id) ? workspaceId : null,
    getWorkspaceGenerationForWindow: id => senders.has(id) ? 1 : null,
  }),
})
const fixtureMarker = 'rox-product-tour-application-test-only'
const fixtureHttp: import('connect').NextHandleFunction = async (request, response, next) => {
  if (!request.url?.startsWith('/__fixture/')) { next(); return }
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/__fixture/bootstrap') {
    const webContentsId = ++nextWebContentsId
    senders.set(webContentsId, Object.assign(new EventEmitter(), { id: webContentsId, mainFrame: { url: 'http://127.0.0.1:5269/' }, isDestroyed: () => !senders.has(webContentsId) }))
    response.end(JSON.stringify({ marker: fixtureMarker, workspaceId, webContentsId, serverUrl: `ws://127.0.0.1:${rpc.port}`, token: issued.credential, proof: 'owned-product-tour-bootstrap' })); return
  }
  if (request.url === '/__fixture/evidence') {
    const snapshots = deps.nativeData!.sync.pull(principal, workspaceId, 0, 100)
    response.end(JSON.stringify({ marker: fixtureMarker, operations, sessionStore: { ownedSessionId: ownedSession.id, foreignSessionId: foreignSession.id }, canonicalNotes: snapshots.entities, nativeFiles: snapshots.entities.flatMap(entity => entity.files.map(file => ({ ...file, actualContent: readFileSync(join(workspaceRoot, file.path), 'utf8') }))) })); return
  }
  if (request.url === '/__fixture/ipc' && request.method === 'POST') {
    try {
      let body = ''
      for await (const chunk of request) body += chunk
      const input = JSON.parse(body)
      const handler = ipcHandlers.get(input.channel)
      if (!handler) throw new Error('Unregistered test IPC method')
      const sender = senders.get(input.webContentsId)
      if (!sender) throw new Error('Closed or unknown owned application window')
      // A negative test may supply a distinct subframe; the production common
      // registration must reject it before opening encrypted replica custody.
      const senderFrame = input.frame === 'subframe' ? { url: sender.mainFrame.url } : sender.mainFrame
      response.end(JSON.stringify({ value: await handler({ sender, senderFrame }, input.input) }))
    } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: String(error) })) }
    return
  }
  if (request.url === '/__fixture/window-close' && request.method === 'POST') {
    let body = ''; for await (const chunk of request) body += chunk
    closeWindow(JSON.parse(body).webContentsId); response.end('{}'); return
  }
  response.statusCode = 404; response.end('{}')
}
const vite = await createServer({ configFile: join(repository, 'tests/e2e/product-tour/fixtures/application/vite.config.ts'), plugins: [{ name: 'owned-product-tour-http', configureServer(server) { server.middlewares.use(fixtureHttp) } }], server: { port: 5269, strictPort: true, host: '127.0.0.1' } })
await vite.listen()
console.log(JSON.stringify({ marker: fixtureMarker, origin: 'http://127.0.0.1:5269', evidence: 'production App + RPC + native journal, synthetic bootstrap/IPC/custody DI; not native OS' }))
let disposed = false
async function dispose() {
  if (disposed) return
  disposed = true
  for (const id of senders.keys()) closeWindow(id)
  disposeReplica(); await vite.close(); rpc.close(); journal.close(); authority.close()
  rmSync(profile, { recursive: true, force: true })
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void dispose().then(() => process.exit(0)) })
