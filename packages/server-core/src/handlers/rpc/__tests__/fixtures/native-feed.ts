import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NativeAuthority } from '../../../../authority/native-authority'
import { WsRpcServer } from '../../../../transport/server'
import { WsRpcClient } from '../../../../transport/client'
import { registerFeedHandlers } from '../../feed'
import { projectNativeFeedChanged } from '../../native-feed'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getCredentialManager } from '@rox/shared/credentials'
import type { HandlerDeps } from '../../../handler-deps'
import type { NativeFeedEnvironment } from '../../native-feed'

const directory = process.env.CRAFT_CONFIG_DIR!
const rootA = join(directory, 'workspace-a'), rootB = join(directory, 'workspace-b')
mkdirSync(rootA); mkdirSync(rootB)
const configPath = join(directory, 'config.json')
const configuration = { workspaces: [{ id: 'workspace-a', rootPath: rootA }, { id: 'workspace-b', rootPath: rootB }], llmConnections: [] }
writeFileSync(configPath, JSON.stringify(configuration))
writeFileSync(join(directory, 'feed-state.json'), JSON.stringify({ version: 2, sources: [{ id: 'host-source', url: 'https://host.invalid', paused: true }], items: [{ id: 'host-item', at: 1, title: 'HOST_PRIVATE_ITEM' }], annotations: { 'host-item': { tags: ['HOST_PRIVATE_TAG'] } } }))
writeFileSync(join(rootA, 'automations-history.jsonl'), [
  { id: 'own-run', ts: 5, ok: false, prompt: 'Own automation', error: '/PRIVATE_HOST_PATH', webhook: { url: 'PRIVATE_WEBHOOK' }, sessionId: 'own-session' },
  { id: 'other-session-run', ts: 6, ok: true, sessionId: 'foreign-session' },
].map(row => JSON.stringify(row)).join('\n'))
writeFileSync(join(rootB, 'automations-history.jsonl'), JSON.stringify({ id: 'foreign-run', ts: 100, ok: true, prompt: 'FOREIGN_WORKSPACE_RUN' }))
const checks: Array<{ name: string; passed: boolean }> = []
const check = (name: string, passed: unknown) => { checks.push({ name, passed: !!passed }); if (!passed) throw new Error(name) }
const denied = async (operation: () => Promise<unknown>) => { try { await operation(); return false } catch { return true } }
const authority = new NativeAuthority({ stateDir: join(directory, 'authority') })
const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin
try { Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }); admin = authority.bootstrapLocalAdministrator('Feed operator') }
finally { if (tty) Object.defineProperty(process.stdin, 'isTTY', tty); else Reflect.deleteProperty(process.stdin, 'isTTY') }
authority.registerWorkspace(admin.credential, 'workspace-a', rootA)
authority.registerWorkspace(admin.credential, 'workspace-b', rootB)
function enroll(name: string, actions: Array<'read' | 'write' | 'subscribe'>) {
  const credential = authority.redeemEnrollment(authority.issueEnrollment(admin!.credential, name, Date.now() + 60_000), name)
  if (!credential) throw new Error('Enrollment failed')
  authority.grantWorkspace(admin!.credential, credential.principal.subject, 'workspace-a', actions)
  return credential
}
const actorA = enroll('Actor A', ['read', 'write', 'subscribe']), actorB = enroll('Actor B', ['read', 'write', 'subscribe']), readOnly = enroll('Reader', ['read', 'subscribe'])
authority.grantWorkspace(admin.credential, actorA.principal.subject, 'workspace-b', ['read', 'write', 'subscribe'])
let hostCredentialReads = 0, networkCalls = 0, mode: 'ok' | 'error' | 'private-redirect' | 'pause' = 'ok'
let sawPinnedAddress = false, sawHostAndSni = false
let feedNow = Date.now()
let reach: (() => void) | undefined, release: (() => void) | undefined
let paused: Promise<void> = Promise.resolve()
const credentialManager = getCredentialManager()
credentialManager.get = async () => { hostCredentialReads++; throw new Error('Native Feed touched host credentials') }
const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
  nativeEventChannels: new Set([RPC_CHANNELS.feed.CHANGED]),
  projectNativeEvent: (channel, args, workspaceId, principal) => channel === RPC_CHANNELS.feed.CHANGED ? projectNativeFeedChanged(authority, args, workspaceId, principal) : args })
const deps = { nativeData: { authority }, platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } }, sessionManager: {
  getSessions: (workspaceId: string) => [
    { id: 'own-session', workspaceId, name: 'Own session', preview: 'Own preview', lastMessageAt: 10, internalPath: '/PRIVATE_PATH' },
    { id: 'foreign-session', workspaceId: 'not-bound', name: 'FOREIGN_SESSION', preview: 'FOREIGN_PREVIEW', lastMessageAt: 500 },
  ],
} } as unknown as HandlerDeps
const environment: NativeFeedEnvironment = { now: () => feedNow, lookup: async hostname => [{ address: hostname === 'private.example' ? '127.0.0.1' : '93.184.216.34' }],
  fetch: async (url, options) => {
    networkCalls++
    if (url.includes('/feed')) {
      sawPinnedAddress = new URL(url).hostname === '93.184.216.34'
      const tls = (options as BunFetchRequestInit)?.tls
      sawHostAndSni = new Headers(options?.headers).get('host') === 'example.com' && tls?.serverName === 'example.com' && tls.rejectUnauthorized === true
    }
    if (mode === 'pause') { reach?.(); await paused }
    if (mode === 'error') throw new Error('SECRET_FETCH_DIAGNOSTIC')
    if (mode === 'private-redirect') return new Response('', { status: 302, headers: { location: 'http://private.example/secret' } })
    if (url.includes('/users/me')) {
      if (new Headers(options?.headers).get('authorization') !== 'Bearer OWN_PRIVATE_X_TOKEN') throw new Error('Wrong X custody')
      return Response.json({ data: { id: 'own-x', username: 'own-account' } })
    }
    if (url.includes('/timelines/')) return Response.json({ data: [{ id: 'own-x-post', text: 'Own X post', created_at: '2026-10-03T00:00:00Z' }] })
    return new Response('<?xml version="1.0"?><rss version="2.0"><channel><title>Own feed</title><item><guid>own-item</guid><title>Own article</title><link>https://example.com/article</link></item></channel></rss>', { headers: { 'content-type': 'application/rss+xml' } })
  } }
registerFeedHandlers(server, deps, environment)
const clients: WsRpcClient[] = []
function client(token: string, workspaceId = 'workspace-a') {
  const connection = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId, mode: 'local', autoReconnect: false, requestTimeout: 3000, connectTimeout: 1000 })
  clients.push(connection); connection.connect(); return connection
}
function snapshot(path: string): unknown {
  const info = statSync(path)
  return info.isDirectory() ? Object.fromEntries(readdirSync(path).sort().map(name => [name, snapshot(join(path, name))])) : [readFileSync(path).toString('base64'), info.mtimeMs, info.mode]
}
function immutableFiles() { return [snapshot(configPath), snapshot(join(directory, 'feed-state.json')), snapshot(rootA), snapshot(rootB)] }
try {
  await server.listen()
  const a = client(actorA.credential), a2 = client(actorA.credential), b = client(actorB.credential), reader = client(readOnly.credential), otherWorkspace = client(actorA.credential, 'workspace-b')
  const before = JSON.stringify(immutableFiles())
  const empty = await a.invoke(RPC_CHANNELS.feed.LIST, 'workspace-a')
  check('native-list-only-canonical-bound-session-and-run-metadata', empty.items.length === 3 && empty.items.some((item: { id: string }) => item.id === 'session:own-session'))
  check('native-list-no-host-global-state-or-paths-or-foreign-session-ref', !/HOST_PRIVATE|PRIVATE_HOST_PATH|PRIVATE_WEBHOOK|PRIVATE_PATH|FOREIGN_SESSION|FOREIGN_PREVIEW|FOREIGN_WORKSPACE_RUN/.test(JSON.stringify(empty)) && !empty.items.some((item: { sessionId?: string }) => item.sessionId === 'foreign-session'))
  check('fresh-list-no-feed-custody-creation', !readdirSync(authority.stateDirectory).includes('native-feed'))
  check('fresh-list-all-config-and-workspace-bytes-mtime-unchanged', JSON.stringify(immutableFiles()) === before)
  check('fresh-list-no-provider-or-host-credential-calls', networkCalls === 0 && hostCredentialReads === 0)
  check('renderer-foreign-workspace-argument-denied', await denied(() => a.invoke(RPC_CHANNELS.feed.LIST, 'workspace-b')))
  const sameActorEvents: unknown[] = [], otherActorEvents: unknown[] = []
  a2.on(RPC_CHANNELS.feed.CHANGED, event => sameActorEvents.push(event)); b.on(RPC_CHANNELS.feed.CHANGED, event => otherActorEvents.push(event))
  await a2.invoke(RPC_CHANNELS.feed.LIST); await b.invoke(RPC_CHANNELS.feed.LIST)
  const added = await a.invoke(RPC_CHANNELS.feed.SOURCES_ADD, 'https://example.com/feed', 60, { color: 'blue', tags: ['Work'], title: 'My source' })
  check('native-source-save-fetch-and-items-work', added.ok && added.source.lastStatus === 'ok' && (await a.invoke(RPC_CHANNELS.feed.LIST)).items.some((item: { title: string }) => item.title === 'Own article'))
  check('http-connection-pins-validated-address-with-original-host-and-certificate-name', sawPinnedAddress && sawHostAndSni)
  const scheduledBefore = networkCalls
  await a.invoke(RPC_CHANNELS.feed.REFRESH, '__due__')
  feedNow += 59 * 60_000
  await a.invoke(RPC_CHANNELS.feed.REFRESH, '__due__')
  check('native-due-refresh-respects-configured-source-interval', networkCalls === scheduledBefore)
  feedNow += 60_000
  await a.invoke(RPC_CHANNELS.feed.REFRESH, '__due__')
  check('native-due-refresh-polls-on-configured-interval', networkCalls === scheduledBefore + 1)
  check('list-reports-native-write-refresh-capability-only-for-current-grant', (await a.invoke(RPC_CHANNELS.feed.LIST)).refreshAllowed === true && (await reader.invoke(RPC_CHANNELS.feed.LIST)).refreshAllowed === false)
  check('read-only-due-refresh-rejected-without-network', await denied(() => reader.invoke(RPC_CHANNELS.feed.REFRESH, '__due__')) && networkCalls === scheduledBefore + 1)
  const stateDir = join(authority.stateDirectory, 'native-feed')
  check('actor-custody-private-modes', (statSync(stateDir).mode & 0o777) === 0o700 && readdirSync(stateDir).every(name => (statSync(join(stateDir, name)).mode & 0o777) === 0o600))
  check('same-actor-event-only-safe-at', sameActorEvents.length >= 1 && sameActorEvents.every(event => JSON.stringify(Object.keys(event as object)) === '["at"]'))
  check('other-actor-event-not-delivered', otherActorEvents.length === 0)
  const own = await a.invoke(RPC_CHANNELS.feed.LIST)
  const article = own.items.find((item: { title: string }) => item.title === 'Own article')
  check('annotation-belongs-to-visible-own-items', (await a.invoke(RPC_CHANNELS.feed.ITEMS_ANNOTATE, [article.id, 'session:foreign-session'], { tags: ['Useful'], starred: true, read: true })).updated === 1)
  check('annotation-persisted', (await a.invoke(RPC_CHANNELS.feed.LIST)).annotations[article.id].starred)
  const restarted = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority })
  registerFeedHandlers(restarted, deps, environment)
  let restartedClient: WsRpcClient | undefined
  try {
    await restarted.listen()
    restartedClient = new WsRpcClient(`ws://127.0.0.1:${restarted.port}`, { token: actorA.credential, workspaceId: 'workspace-a', mode: 'local', autoReconnect: false, requestTimeout: 1000, connectTimeout: 1000 })
    restartedClient.connect()
    const restored = await restartedClient.invoke(RPC_CHANNELS.feed.LIST)
    check('new-rpc-server-restores-private-sources-items-and-annotations', restored.sources.length === 1 && restored.annotations[article.id].starred && restored.items.some((item: { id: string }) => item.id === article.id))
  } finally { restartedClient?.destroy(); restarted.close() }
  check('source-update-persisted', (await a.invoke(RPC_CHANNELS.feed.SOURCES_UPDATE, added.source.id, { color: 'violet', paused: true })).color === 'violet')
  check('other-actors-have-independent-source-and-annotation-custody', (await b.invoke(RPC_CHANNELS.feed.LIST)).sources.length === 0 && Object.keys((await b.invoke(RPC_CHANNELS.feed.LIST)).annotations).length === 0)
  check('same-actor-other-workspace-is-independent', (await otherWorkspace.invoke(RPC_CHANNELS.feed.LIST)).sources.length === 0)
  check('foreign-source-remove-cannot-touch-owner', !(await b.invoke(RPC_CHANNELS.feed.SOURCES_REMOVE, added.source.id)).removed && (await a.invoke(RPC_CHANNELS.feed.LIST)).sources.length === 1)
  check('read-only-source-and-annotation-mutations-denied', await denied(() => reader.invoke(RPC_CHANNELS.feed.SOURCES_ADD, 'https://example.com/other')) && await denied(() => reader.invoke(RPC_CHANNELS.feed.ITEMS_ANNOTATE, 'session:own-session', { starred: true })))
  const populatedBefore = JSON.stringify([immutableFiles(), snapshot(stateDir)])
  const priorCalls = networkCalls
  await a.invoke(RPC_CHANNELS.feed.LIST); await a.invoke(RPC_CHANNELS.feed.LIST); await reader.invoke(RPC_CHANNELS.feed.LIST)
  check('populated-list-all-bytes-and-mtime-unchanged-no-network', JSON.stringify([immutableFiles(), snapshot(stateDir)]) === populatedBefore && networkCalls === priorCalls && hostCredentialReads === 0)
  mode = 'error'
  await a.invoke(RPC_CHANNELS.feed.REFRESH, added.source.id)
  const failed = (await a.invoke(RPC_CHANNELS.feed.LIST)).sources[0]
  check('network-failure-visible-without-secret-diagnostics', failed.lastStatus === 'error' && failed.lastError === 'network-error' && !JSON.stringify(failed).includes('SECRET'))
  mode = 'ok'
  await a.invoke(RPC_CHANNELS.feed.REFRESH, added.source.id)
  check('explicit-network-retry-recovers-source', (await a.invoke(RPC_CHANNELS.feed.LIST)).sources[0].lastStatus === 'ok')
  const previewBefore = JSON.stringify([immutableFiles(), snapshot(stateDir)])
  check('preview-works-without-state-writes', (await reader.invoke(RPC_CHANNELS.feed.SOURCES_PREVIEW, 'https://example.com/preview')).ok && JSON.stringify([immutableFiles(), snapshot(stateDir)]) === previewBefore)
  mode = 'private-redirect'; const beforeRedirect = networkCalls
  check('redirect-to-host-private-network-rejected', !(await a.invoke(RPC_CHANNELS.feed.SOURCES_PREVIEW, 'https://example.com/redirect')).ok && networkCalls === beforeRedirect + 1)
  mode = 'ok'
  check('x-token-is-validatable-per-actor', (await a.invoke(RPC_CHANNELS.feed.X_SET_TOKEN, 'OWN_PRIVATE_X_TOKEN')).state === 'connected')
  const tokenReadBefore = JSON.stringify(snapshot(stateDir)), tokenNetworkBefore = networkCalls
  check('x-status-read-no-network-or-write', (await a.invoke(RPC_CHANNELS.feed.LIST)).x.username === 'own-account' && networkCalls === tokenNetworkBefore && JSON.stringify(snapshot(stateDir)) === tokenReadBefore)
  check('x-token-does-not-cross-list-or-other-actor', !JSON.stringify(await a.invoke(RPC_CHANNELS.feed.LIST)).includes('OWN_PRIVATE_X_TOKEN') && (await b.invoke(RPC_CHANNELS.feed.LIST)).x.state === 'not-connected')
  await a.invoke(RPC_CHANNELS.feed.REFRESH, 'x')
  check('x-refresh-uses-private-actor-token', (await a.invoke(RPC_CHANNELS.feed.LIST)).items.some((item: { title: string }) => item.title === 'Own X post'))
  check('x-clear-removes-native-token', (await a.invoke(RPC_CHANNELS.feed.X_CLEAR)).state === 'not-connected' && !readdirSync(stateDir).some(name => readFileSync(join(stateDir, name), 'utf8').includes('OWN_PRIVATE_X_TOKEN')))
  const eventBefore = sameActorEvents.length
  server.push(RPC_CHANNELS.feed.CHANGED, { to: 'all' }, { at: 99 })
  await a.invoke(RPC_CHANNELS.feed.LIST)
  check('legacy-global-feed-event-suppressed-for-native', sameActorEvents.length === eventBefore)
  const canonical = JSON.stringify(configuration)
  writeFileSync(configPath, JSON.stringify({ ...configuration, workspaces: [{ id: 'workspace-a', rootPath: rootB }, configuration.workspaces[1]] }))
  check('registry-root-drift-denied', await denied(() => a.invoke(RPC_CHANNELS.feed.LIST)))
  writeFileSync(configPath, canonical)
  renameSync(rootA, `${rootA}.moved`); mkdirSync(rootA)
  check('workspace-inode-drift-denied', await denied(() => a.invoke(RPC_CHANNELS.feed.LIST)))
  rmSync(rootA, { recursive: true }); renameSync(`${rootA}.moved`, rootA)
  const recovered = client(actorA.credential)
  await recovered.invoke(RPC_CHANNELS.feed.LIST)
  const racedBefore = JSON.stringify(snapshot(stateDir))
  mode = 'pause'
  const reached = new Promise<void>(resolve => { reach = resolve })
  paused = new Promise<void>(resolve => { release = resolve })
  const racing = recovered.invoke(RPC_CHANNELS.feed.REFRESH, added.source.id).then(() => false, () => true)
  await reached
  authority.grantWorkspace(admin.credential, actorA.principal.subject, 'workspace-a', ['read', 'subscribe'])
  release!()
  check('pending-refresh-revocation-cannot-commit', await racing && JSON.stringify(snapshot(stateDir)) === racedBefore)
  mode = 'ok'
  authority.grantWorkspace(admin.credential, actorA.principal.subject, 'workspace-a', ['read', 'write', 'subscribe'])
  const latest = client(actorA.credential)
  check('restored-grant-new-context-can-read', (await latest.invoke(RPC_CHANNELS.feed.LIST)).sources.length === 1)
  authority.revokeCredential(admin.credential, actorA.principal.credentialId)
  check('revoked-credential-denied', await denied(() => latest.invoke(RPC_CHANNELS.feed.LIST)))
  check('native-workflow-never-touched-host-credentials-or-state', hostCredentialReads === 0 && !readFileSync(join(directory, 'feed-state.json'), 'utf8').includes('Own article'))
  const protectedDirectory = join(authority.stateDirectory, 'native-feed')
  renameSync(protectedDirectory, `${protectedDirectory}.safe`)
  const external = mkdtempSync(join(tmpdir(), 'native-feed-outside-'))
  try {
    symlinkSync(external, protectedDirectory, 'dir')
    check('custody-symlink-denied', await denied(() => b.invoke(RPC_CHANNELS.feed.LIST)))
    check('custody-symlink-no-external-writes', readdirSync(external).length === 0)
  } finally { rmSync(protectedDirectory); renameSync(`${protectedDirectory}.safe`, protectedDirectory); rmSync(external, { recursive: true }) }
  console.log(JSON.stringify(checks))
} finally { release?.(); for (const connection of clients) connection.destroy(); server.close(); authority.close() }
