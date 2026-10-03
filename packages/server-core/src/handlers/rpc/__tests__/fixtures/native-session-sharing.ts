import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthority } from '../../../../authority/native-authority'
import { WsRpcServer } from '../../../../transport/server'
import { WsRpcClient } from '../../../../transport/client'
import { registerSessionsHandlers } from '../../sessions'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { RPC_CHANNELS, type Session } from '@craft-agent/shared/protocol'

const directory = process.env.ROX_CONFIG_DIR!
const roots = ['workspace-a', 'workspace-b'].map(id => {
  const rootPath = join(directory, id); mkdirSync(rootPath)
  writeFileSync(join(rootPath, 'config.json'), JSON.stringify({ id, name: id, slug: id, createdAt: 1 }))
  return { id, name: id, slug: id, rootPath, createdAt: 1 }
})
// Sensitive host fields and legacy singleton share capability must never be published or adopted.
const registryFile = join(directory, 'config.json')
writeFileSync(registryFile, JSON.stringify({ workspaces: roots, activeWorkspaceId: roots[0]!.id, llmConnections: [] }))
getWorkspaceByNameOrId('workspace-a') // Establish ordinary configuration migration before the action baseline.
const registryBefore = readFileSync(registryFile, 'utf8')
const sessions = roots.flatMap(workspace => ['conversation', 'other'].map(name => ({
  id: `${workspace.id}-${name}`, workspaceId: workspace.id, workspaceName: workspace.name, name: 'Synthetic sharing fixture',
  createdAt: 1, lastMessageAt: 4, isProcessing: false, sdkSessionId: 'HOST PRIVATE SDK ID',
  sharedId: 'host-link', sharedUrl: 'https://agents.rox.one/s/host-link', sharedOwnerKey: 'HOST PRIVATE OWNER KEY',
  workingDirectory: '/host/private/cwd', sessionFolderPath: '/host/private/session',
  messages: [{ id: 'user', role: 'user', content: 'Synthetic visible question api_key=secret-fixture-token', timestamp: 1,
    attachments: [{ id: 'file', storedPath: '/host/private/attachment' }] },
  { id: 'reply', role: 'assistant', content: 'Synthetic visible answer Bearer secret-fixture-bearer', timestamp: 2 },
  { id: 'tool', role: 'tool', content: 'HOST PRIVATE TOOL CONTENT', timestamp: 3 },
  { id: 'hidden', role: 'assistant', content: 'HOST PRIVATE HIDDEN CONTENT', hidden: true, timestamp: 4 },
  { id: 'intermediate', role: 'assistant', content: 'HOST PRIVATE INTERMEDIATE CONTENT', isIntermediate: true, timestamp: 4 }],
} as unknown as Session)))
const canonical = join(directory, 'canonical-sessions.json')
writeFileSync(canonical, JSON.stringify(sessions)); const canonicalBefore = readFileSync(canonical, 'utf8')
let readGate: (() => Promise<void>) | undefined
const manager = { waitForInit: async () => {}, getSessions: (id?: string) => sessions.filter(session => !id || session.workspaceId === id),
  getSession: async (id: string) => { await readGate?.(); return sessions.find(session => session.id === id) ?? null } }
const authority = new NativeAuthority({ stateDir: join(directory, 'authority') })
const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin: ReturnType<NativeAuthority['bootstrapLocalAdministrator']>
try { Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true }); admin = authority.bootstrapLocalAdministrator('fixture operator') }
finally { if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor); else Reflect.deleteProperty(process.stdin, 'isTTY') }
for (const workspace of roots) authority.registerWorkspace(admin.credential, workspace.id, workspace.rootPath)
const enroll = (name: string) => authority.redeemEnrollment(authority.issueEnrollment(admin.credential, name, Date.now() + 60000), name)!
const alice = enroll('alice'), bob = enroll('bob'), reader = enroll('reader')
for (const actor of [alice, bob]) authority.grantWorkspace(admin.credential, actor.principal.subject, 'workspace-a', ['read', 'write'])
authority.grantWorkspace(admin.credential, alice.principal.subject, 'workspace-b', ['read', 'write'])
authority.grantWorkspace(admin.credential, reader.principal.subject, 'workspace-a', ['read'])
const clients: WsRpcClient[] = []
const extraServers: WsRpcServer[] = []
let server: WsRpcServer
const log = { info() {}, warn() {}, error() {}, debug() {} }
const start = async () => {
  server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority, validateToken: async () => true })
  registerSessionsHandlers(server, { sessionManager: manager, nativeData: { authority }, platform: { logger: log } } as never)
  await server.listen()
}
const connect = (actor: typeof alice, workspaceId = 'workspace-a') => {
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token: actor.credential, workspaceId, mode: 'remote', autoReconnect: false, requestTimeout: 1500, connectTimeout: 1500 })
  clients.push(client); client.connect(); return client
}
const denied = async (action: () => Promise<unknown>) => { let failure: unknown; try { await action() } catch (error) { failure = error }; assert(failure, 'expected authorization denial') }
const command = (client: WsRpcClient, type: string, fields: object = {}, id = 'workspace-a-conversation') => client.invoke(RPC_CHANNELS.sessions.COMMAND, id, { type, ...fields })
const requests: Array<{ url: string; method: string; authorization: string | null; body?: unknown }> = []
let fetchGate: (() => Promise<void>) | undefined
let malformedResponse = false
let sequence = 0
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input, init) => {
  const url = String(input)
  assert(url.startsWith('https://agents.rox.one/s/api'), 'unexpected external request attempted')
  requests.push({ url, method: init?.method ?? 'GET', authorization: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : undefined })
  assert.equal(init?.redirect, 'error')
  await fetchGate?.()
  if (init?.method === 'POST') {
    const id = `synthetic-share-${++sequence}`
    return Response.json({ id, url: `https://${malformedResponse ? 'evil.test' : 'agents.rox.one'}/s/${id}`, ownerKey: `synthetic-owner-${sequence}` })
  }
  return Response.json({ success: true })
}) as typeof fetch
const stop = async () => { for (const client of clients.splice(0)) client.destroy(); await new Promise(resolve => setTimeout(resolve, 20)); server.close() }

try {
  await start(); let a = connect(alice), b = connect(bob); const r = connect(reader), foreign = connect(alice, 'workspace-b')
  await Promise.all([a.invoke(RPC_CHANNELS.sessions.GET), b.invoke(RPC_CHANNELS.sessions.GET), r.invoke(RPC_CHANNELS.sessions.GET), foreign.invoke(RPC_CHANNELS.sessions.GET)])
  const scenario = process.argv[2]
  if (scenario === 'actors') {
    for (const type of ['shareToViewer', 'updateShare', 'revokeShare', 'inviteBro', 'joinBroInvite', 'revokeBroInvite', 'listBroPresence']) {
      await denied(() => command(r, type, { url: 'invalid', joinKey: 'a'.repeat(32) }))
      await denied(() => command(a, type, { url: 'https://bro.rox.one/@synthetic/workspace-b-conversation/' + 'a'.repeat(32), joinKey: 'a'.repeat(32) }, 'workspace-b-conversation'))
    }
    assert.equal(requests.length, 0)
    const first = await command(a, 'shareToViewer', { owner: bob.principal, sharedOwnerKey: 'HOST PRIVATE OWNER KEY' })
    assert.deepEqual(first, { success: true, url: 'https://agents.rox.one/s/synthetic-share-1' })
    assert.equal(requests[0]!.authorization, null)
    const body = requests[0]!.body as { messages: Array<{ id: string; type: string; content: string }> }
    assert.deepEqual(body.messages.map(message => [message.id, message.type]), [['user', 'user'], ['reply', 'assistant']])
    const encoded = JSON.stringify(body)
    for (const forbidden of ['HOST PRIVATE', '/host/private', 'sharedOwnerKey', 'sdkSessionId', 'attachments', 'secret-fixture-token', 'secret-fixture-bearer']) assert(!encoded.includes(forbidden), `published ${forbidden}`)
    assert(body.messages.every(message => message.content.includes('[redacted]')))
    assert.deepEqual(await command(a, 'shareToViewer'), first); assert.equal(requests.length, 1)
    assert.equal((await command(b, 'updateShare')).success, false)
    assert.equal((await command(b, 'revokeShare', { id: 'synthetic-share-1', ownerKey: 'synthetic-owner-1' })).success, false)
    assert.equal(requests.length, 1, 'other actor used first actor capability')
    const second = await command(b, 'shareToViewer'); assert.equal(second.url, 'https://agents.rox.one/s/synthetic-share-2')
    assert.equal((await command(b, 'updateShare')).success, true)
    assert.equal(requests.at(-1)!.authorization, 'Bearer synthetic-owner-2')
    assert.equal((await command(a, 'updateShare')).success, true)
    assert.equal(requests.at(-1)!.authorization, 'Bearer synthetic-owner-1')
    const invite = await command(a, 'inviteBro', { role: 'viewer', accountId: bob.principal.subject, owner: bob.principal })
    assert.equal(invite.success, true); const joinKey = new URL(invite.url).pathname.split('/').at(-1)!
    await denied(() => command(b, 'revokeBroInvite', { joinKey }))
    await denied(() => command(a, 'revokeBroInvite', { joinKey }, 'workspace-a-other'))
    await denied(() => command(a, 'inviteBro', { role: 'owner' }))
    await denied(() => command(foreign, 'joinBroInvite', { url: invite.url }, 'workspace-b-conversation'))
    const joined = await command(b, 'joinBroInvite', { url: invite.url, accountId: alice.principal.subject }, 'unrelated-open-page')
    assert.equal(joined.ok, true); assert.equal(joined.workspaceId, 'workspace-a'); assert.equal(joined.role, 'viewer')
    assert.notEqual(joined.accountId, alice.principal.subject); assert.notEqual(joined.accountId, bob.principal.subject)
    assert.equal((await command(b, 'joinBroInvite', { url: invite.url })).error, 'reused')
    const presence = await command(a, 'listBroPresence')
    assert.equal(presence.length, 2); assert.notEqual(presence[0].accountId, presence[1].accountId)
    const revokedInvite = await command(a, 'inviteBro'); const revokeKey = new URL(revokedInvite.url).pathname.split('/').at(-1)!
    assert.equal((await command(a, 'revokeBroInvite', { joinKey: revokeKey })).success, true)
    assert.equal((await command(b, 'joinBroInvite', { url: revokedInvite.url })).error, 'revoked')
    // Private per-actor capabilities and invitation membership survive actual server/store restart.
    await stop(); await start(); a = connect(alice); b = connect(bob)
    assert.equal((await command(a, 'updateShare')).success, true); assert.equal(requests.at(-1)!.authorization, 'Bearer synthetic-owner-1')
    assert.equal((await command(b, 'updateShare')).success, true); assert.equal(requests.at(-1)!.authorization, 'Bearer synthetic-owner-2')
    assert.equal((await command(a, 'listBroPresence')).length, 2)
    assert.equal((await command(b, 'revokeShare')).success, true); assert.equal(requests.at(-1)!.authorization, 'Bearer synthetic-owner-2')
    assert.equal((await command(a, 'updateShare')).success, true); assert.equal(requests.at(-1)!.authorization, 'Bearer synthetic-owner-1')
    const count = requests.length
    authority.revokeWorkspaceGrant(admin.credential, alice.principal.subject, 'workspace-a')
    await denied(() => command(a, 'shareToViewer')); await denied(() => command(a, 'inviteBro')); assert.equal(requests.length, count)
    assert.equal(statSync(join(directory, 'authority/native-session-sharing/native-share-links.sqlite')).mode & 0o777, 0o600)
  } else if (scenario === 'lifecycle') {
    const secondServer = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority })
    extraServers.push(secondServer)
    registerSessionsHandlers(secondServer, { sessionManager: manager, nativeData: { authority }, platform: { logger: log } } as never)
    await secondServer.listen()
    const secondClient = new WsRpcClient(`ws://127.0.0.1:${secondServer.port}`, { token: bob.credential, workspaceId: 'workspace-a', mode: 'remote', autoReconnect: false, requestTimeout: 1500 })
    clients.push(secondClient); secondClient.connect()
    assert.equal((await command(a, 'inviteBro')).success, true)
    assert.equal((await command(secondClient, 'inviteBro')).success, true)
    let release!: () => void; let entered!: () => void
    const enteredFetch = new Promise<void>(resolve => { entered = resolve })
    const heldFetch = new Promise<void>(resolve => { release = resolve })
    fetchGate = async () => { entered(); await heldFetch }
    const pending = command(a, 'shareToViewer'); await enteredFetch
    secondClient.destroy(); secondServer.close(); release()
    assert.equal((await pending).success, true, 'unrelated server shutdown closed active share registry')
    fetchGate = undefined
    assert.equal((await command(a, 'updateShare')).success, true)
    assert.equal(requests.at(-1)!.authorization, 'Bearer synthetic-owner-1')
    assert.equal((await command(a, 'listBroPresence')).length, 2)
  } else if (scenario === 'races') {
    let release!: () => void; let entered!: () => void
    const enteredRead = new Promise<void>(resolve => { entered = resolve })
    const heldRead = new Promise<void>(resolve => { release = resolve })
    readGate = async () => { entered(); await heldRead }
    const pendingInvite = command(a, 'inviteBro'); await enteredRead
    authority.revokeWorkspaceGrant(admin.credential, alice.principal.subject, 'workspace-a'); release()
    await denied(() => pendingInvite); assert.equal(requests.length, 0)
    readGate = undefined; authority.grantWorkspace(admin.credential, alice.principal.subject, 'workspace-a', ['read', 'write']); a = connect(alice)
    // Revocation while the synthetic provider is responding cannot persist a capability.
    const enteredFetch = new Promise<void>(resolve => { entered = resolve })
    const heldFetch = new Promise<void>(resolve => { release = resolve })
    fetchGate = async () => { entered(); await heldFetch }
    const pendingShare = command(a, 'shareToViewer'); await enteredFetch
    const busy = await command(a, 'shareToViewer'); assert.equal(busy.errorCode, 'SHARE_BUSY')
    authority.revokeWorkspaceGrant(admin.credential, alice.principal.subject, 'workspace-a'); release()
    await denied(() => pendingShare)
    fetchGate = undefined; authority.grantWorkspace(admin.credential, alice.principal.subject, 'workspace-a', ['read', 'write']); a = connect(alice)
    const count = requests.length
    assert.equal((await command(a, 'updateShare')).success, false); assert.equal(requests.length, count, 'revoked request persisted link')
    malformedResponse = true; assert.equal((await command(a, 'shareToViewer')).success, false)
    assert.equal((await command(a, 'updateShare')).success, false)
    malformedResponse = false; const accepted = await command(a, 'shareToViewer'); assert.equal(accepted.success, true)
    // Changing the registered root inode invalidates even a previously owned link.
    renameSync(roots[0]!.rootPath, `${roots[0]!.rootPath}-old`); mkdirSync(roots[0]!.rootPath)
    await denied(() => command(a, 'updateShare')); await denied(() => command(b, 'inviteBro'))
  } else throw new Error('Unknown fixture scenario')
  assert.equal(readFileSync(registryFile, 'utf8'), registryBefore, 'host account registry changed')
  assert.equal(readFileSync(canonical, 'utf8'), canonicalBefore, 'host singleton share/session changed')
  console.log(`native sharing ${scenario} passed`)
} finally { globalThis.fetch = originalFetch; for (const extra of extraServers) extra.close(); await stop(); authority.close() }
process.exit(0)
