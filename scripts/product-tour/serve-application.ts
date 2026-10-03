/** Test-only composition: production App/transport/native Notes; synthetic shell bootstrap and custody DI. */
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { EventEmitter } from 'node:events'
import { build, createServer, preview } from 'vite'
import { applicationBuildFingerprint, requireApplicationBuildReceipt, writeApplicationBuildReceipt } from './application-build'

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
const { registerNativeReplicaIpc } = await import('../../apps/electron/src/main/native-replica')
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
authority.grantWorkspace(admin.credential, issued.principal.subject, workspaceId, ['read', 'write', 'delete'])
const principal = authority.authenticate(issued.credential)!
authority.updateSelfProfile(principal, workspaceId, { name: 'Product Tour Test' })
// Host metadata exists only in the throwaway profile. Domain writes use the native journal.
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [{ id: workspaceId, name: 'Tour QA', rootPath: workspaceRoot, kind: 'local', createdAt: Date.now() }], activeWorkspaceId: workspaceId }))
writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({ id: workspaceId, name: 'Tour QA', createdAt: Date.now(), defaults: { permissionMode: 'allow-all' } }))

const journal = new NativeJournal({
  stateDir: join(profile, 'state'),
  authorize: (...args) => authority.authorize(...args),
  permissionFence: (...args) => authority.permissionFence(...args),
  authorizePreparedRecovery: (...args) => authority.authorizePreparedRecovery(...args),
})
const operations: Array<{ channel: string; method: string }> = []
const senders = new Map<number, EventEmitter & { id: number; isDestroyed(): boolean }>()
let nextWebContentsId = 100
function closeWindow(id: number) {
  const sender = senders.get(id)
  if (!sender) return
  senders.delete(id); sender.emit('destroyed')
}
const rpc = new WsRpcServer({
  host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
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
  nativeData: { authority, journal, sync: new CollaborationSyncService(authority, journal) },
  platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
} as unknown as import('../../packages/server-core/src/handlers/handler-deps').HandlerDeps
registerNativeDataHandlers(rpc, deps)
registerNotesHandlers(rpc, deps)

const shellReplies: Record<string, unknown> = {
  // This fixture exercises the production app/native domain in explicit
  // non-cloud mode. Account login and billing have separate authority tests.
  getRoxCloudState: { required: false, connected: false },
  getWorkspaces: [{ id: workspaceId, name: 'Tour QA', rootPath: workspaceRoot, kind: 'local', createdAt: Date.now() }],
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
const emptyReads = new Set(['getSessions', 'getSources', 'getSkills', 'getProjects', 'getLabels', 'getStatuses', 'getSessionStatuses', 'getWorkspaceSources', 'getWorkspaceSkills', 'getWorkspaceProjects', 'getWorkspaceLabels', 'getWorkspaceSessionStatuses', 'listLlmConnections', 'listLlmConnectionsWithStatus', 'getSessionTodo', 'getFeedSources', 'listOrganizations', 'getCustomThemes', 'getAutomations', 'getMemoryEntries', 'getNavigationHistory', 'getPluginRegistry', 'getPersonalTasks', 'listLabels', 'listViews', 'getPages'])
for (const [method, entry] of Object.entries(CHANNEL_MAP)) {
  if (entry.type !== 'invoke' || registered.has(entry.channel)) continue
  if (method in shellReplies || emptyReads.has(method)) {
    rpc.handle(entry.channel, () => shellReplies[method] ?? [], {
      access: method === 'getSessions' || method === 'listLlmConnectionsWithStatus' ? 'localElectron' : undefined,
      nativeAction: 'read',
    })
  }
}
await rpc.listen()

// In-process IPC adapter, with the production main queue and production preload bridge.
// This is application harness evidence, never OS/Electron IPC custody evidence.
const ipcHandlers = new Map<string, (...args: any[]) => any>()
const credentials = new Map<string, import('../../packages/shared/src/credentials/types').StoredCredential>()
const disposeReplica = registerNativeReplicaIpc({ handle(channel: string, fn: (...args: any[]) => any) { ipcHandlers.set(channel, fn) }, removeHandler(channel: string) { ipcHandlers.delete(channel) } } as any, {
  configDir: config,
  credentials: { get: async id => credentials.get(JSON.stringify(id)) ?? null, set: async (id, value) => { credentials.set(JSON.stringify(id), value) } },
  getWorkspaceForWindow: id => senders.has(id) ? workspaceId : null,
})
const fixtureMarker = 'rox-product-tour-application-test-only'
const fixtureHttp: import('connect').NextHandleFunction = async (request, response, next) => {
  if (!request.url?.startsWith('/__fixture/')) { next(); return }
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/__fixture/bootstrap') {
    const webContentsId = ++nextWebContentsId
    senders.set(webContentsId, Object.assign(new EventEmitter(), { id: webContentsId, isDestroyed: () => !senders.has(webContentsId) }))
    response.end(JSON.stringify({ marker: fixtureMarker, workspaceId, webContentsId, serverUrl: `ws://127.0.0.1:${rpc.port}`, token: issued.credential, proof: 'owned-product-tour-bootstrap' })); return
  }
  if (request.url === '/__fixture/evidence') {
    const snapshots = deps.nativeData!.sync.pull(principal, workspaceId, 0, 100)
    response.end(JSON.stringify({ marker: fixtureMarker, operations, canonicalNotes: snapshots.entities, nativeFiles: snapshots.entities.flatMap(entity => entity.files.map(file => ({ ...file, actualContent: readFileSync(join(workspaceRoot, file.path), 'utf8') }))) })); return
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
      response.end(JSON.stringify({ value: await handler({ sender }, input.input) }))
    } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: String(error) })) }
    return
  }
  if (request.url === '/__fixture/window-close' && request.method === 'POST') {
    let body = ''; for await (const chunk of request) body += chunk
    closeWindow(JSON.parse(body).webContentsId); response.end('{}'); return
  }
  response.statusCode = 404; response.end('{}')
}
// Import the owned config once. Bun cannot re-import Vite's already removed
// temporary bundled config when build() is followed by preview() in one process.
const { default: applicationViteConfig } = await import('../../tests/e2e/product-tour/fixtures/application/vite.config')
const applicationConfig = { ...applicationViteConfig, configFile: false as const }
// Optional bounded acceptance route exercises the built real App rather than timing cold dev-module transforms.
const builtApplication = process.env.PRODUCT_TOUR_APPLICATION_STATIC === '1'
if (builtApplication) {
  if (process.env.PRODUCT_TOUR_APPLICATION_PREBUILT === '1') requireApplicationBuildReceipt(repository)
  else {
    const fingerprint = applicationBuildFingerprint(repository)
    await build(applicationConfig)
    if (fingerprint !== applicationBuildFingerprint(repository)) throw new Error('Acceptance App source changed during build')
    writeApplicationBuildReceipt(repository, fingerprint)
  }
}
const fixturePlugin = { name: 'owned-product-tour-http', configureServer(server: import('vite').ViteDevServer) { server.middlewares.use(fixtureHttp) }, configurePreviewServer(server: import('vite').PreviewServer) { server.middlewares.use(fixtureHttp) } }
const vite = builtApplication
  ? await preview({ ...applicationConfig, plugins: [...(applicationConfig.plugins ?? []), fixturePlugin], preview: { port: 5269, strictPort: true, host: '127.0.0.1' } })
  : await createServer({ ...applicationConfig, plugins: [...(applicationConfig.plugins ?? []), fixturePlugin], server: { port: 5269, strictPort: true, host: '127.0.0.1' } })
if ('listen' in vite) await vite.listen()
console.log(JSON.stringify({ marker: fixtureMarker, origin: 'http://127.0.0.1:5269', evidence: 'production App + RPC + native journal, synthetic bootstrap/IPC/custody DI; not native OS' }))
let disposed = false
async function dispose() {
  if (disposed) return
  disposed = true
  for (const id of senders.keys()) closeWindow(id)
  disposeReplica(); if ('close' in vite) await vite.close(); else await new Promise<void>((done, fail) => vite.httpServer.close(error => error ? fail(error) : done())); rpc.close(); journal.close(); authority.close()
  rmSync(profile, { recursive: true, force: true })
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void dispose().then(() => process.exit(0)) })
