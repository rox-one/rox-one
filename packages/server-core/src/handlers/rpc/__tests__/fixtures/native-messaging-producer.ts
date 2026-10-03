import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthority } from '../../../../authority/native-authority'
import { WsRpcServer } from '../../../../transport/server'
import { WsRpcClient } from '../../../../transport/client'
import { registerMessagingHandlers } from '../../messaging'
import { projectNativeInboxChanged } from '../../native-inbox-events'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { MessagingGatewayRegistry } from '../../../../../../messaging-gateway/src/registry'
import type { MessagingGateway } from '../../../../../../messaging-gateway/src/gateway'
import type { ConfigStore } from '../../../../../../messaging-gateway/src/config-store'
import type { IncomingMessage, ButtonPress, PlatformAdapter } from '../../../../../../messaging-gateway/src/types'

const directory = process.env.ROX_CONFIG_DIR!, root = join(directory, 'workspace'), scenario = process.argv[2]!
mkdirSync(root); writeFileSync(join(root, 'config.json'), JSON.stringify({ id: 'a', name: 'A' }))
writeFileSync(join(directory, 'config.json'), JSON.stringify({ workspaces: [{ id: 'a', name: 'A', rootPath: root, createdAt: 1 }], llmConnections: [] }))
let authority = new NativeAuthority({ stateDir: join(directory, 'authority') })
const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin: ReturnType<NativeAuthority['bootstrapLocalAdministrator']>
try { Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true }); admin = authority.bootstrapLocalAdministrator('operator') }
finally { if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor); else Reflect.deleteProperty(process.stdin, 'isTTY') }
authority.registerWorkspace(admin.credential, 'a', root)
const enroll = (name: string) => { const value = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, name, Date.now() + 60000), name); assert(value); return value }
const alice = enroll('alice'), bob = enroll('bob'), reader = enroll('reader')
for (const actor of [alice, bob]) authority.grantWorkspace(admin.credential, actor.principal.subject, 'a', ['read', 'write', 'subscribe'])
authority.grantWorkspace(admin.credential, reader.principal.subject, 'a', ['read', 'subscribe'])
const owner = (actor: typeof alice) => ({ issuer: actor.principal.issuer, subject: actor.principal.subject })
let routed = 0, lookupEntered: (() => void) | undefined, heldLookup: Promise<void> | undefined, releaseLookup: (() => void) | undefined
const manager = { getSessions: () => [{ id: 'a-session', workspaceId: 'a' }],
  getSession: async () => { lookupEntered?.(); await heldLookup; return { id: 'a-session', workspaceId: 'a', name: 'Synthetic session', messages: [] } },
  sendMessage: async (_session: string, _message: string, _attachments: unknown, _stored: unknown, _options: unknown, _existing: unknown, _retry: unknown, _ack: unknown,
    context?: { nativeMemoryContext?: { assertAuthorized(): void } }) => { assert(context?.nativeMemoryContext); context.nativeMemoryContext.assertAuthorized(); routed++ },
  cancelProcessing: async () => {},
}
const noop = () => {}, logger = { info: noop, warn: noop, error: noop, child: () => logger }
const makeRegistry = () => new MessagingGatewayRegistry({ sessionManager: manager as never, credentialManager: { get: async () => null } as never,
  getMessagingDir: () => join(root, 'messaging'), logger, publishEvent: (channel, target, ...args) => server?.push(channel, target, ...args) })
let registry = makeRegistry()
let server: WsRpcServer
const clients: WsRpcClient[] = []
let gateway: MessagingGateway, config: ConfigStore
let fireMessage: (message: IncomingMessage) => Promise<void>, fireButton: (press: ButtonPress) => Promise<void>
const sent: string[] = []
const installAdapter = async () => {
  await registry.initializeWorkspace('a')
  const state = (registry as unknown as { workspaces: Map<string, { gateway: MessagingGateway; configStore: ConfigStore }> }).workspaces.get('a')!
  gateway = state.gateway; config = state.configStore
  if (!config.get().enabled) config.update({ enabled: true, platforms: { telegram: { enabled: true, accessMode: 'owner-control', owners: [{ userId: 'host-operator', addedAt: 1 }] } } })
  const adapter: PlatformAdapter = { platform: 'telegram', capabilities: { messageEditing: true, inlineButtons: true, maxButtons: 10, maxMessageLength: 4096, markdown: 'v2', webhookSupport: false },
    initialize: async () => {}, destroy: async () => {}, isConnected: () => true,
    onMessage: callback => { fireMessage = callback }, onButtonPress: callback => { fireButton = callback },
    sendText: async (channelId, text) => { sent.push(text); return { platform: 'telegram', channelId, messageId: String(sent.length) } },
    editMessage: async () => {}, sendTyping: async () => {},
    sendButtons: async channelId => ({ platform: 'telegram', channelId, messageId: 'buttons' }),
    sendFile: async channelId => ({ platform: 'telegram', channelId, messageId: 'file' }),
  }
  gateway.registerAdapter(adapter); await gateway.start()
}
const startServer = async () => {
  server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
    nativeEventChannels: new Set([RPC_CHANNELS.messaging.PENDING_CHANGED, RPC_CHANNELS.messaging.BINDING_CHANGED]),
    projectNativeEvent: (_channel, args, workspaceId, principal) => projectNativeInboxChanged(authority, args, workspaceId, principal) })
  registerMessagingHandlers(server, { sessionManager: manager, messagingRegistry: registry, nativeData: { authority } } as never)
  await server.listen(); await installAdapter()
}
const connect = (actor: typeof alice) => { const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token: actor.credential, workspaceId: 'a', mode: 'remote', autoReconnect: false }); clients.push(client); client.connect(); return client }
const denied = async (operation: () => Promise<unknown>) => { let failure: unknown; try { await operation() } catch (error) { failure = error } assert(failure) }
const message = (senderId: string, channelId: string, text = 'hello', threadId = 7): IncomingMessage => ({ platform: 'telegram', channelId, senderId, text, threadId, messageId: 'synthetic', timestamp: Date.now(), raw: {} })
const list = (client: WsRpcClient) => client.invoke(RPC_CHANNELS.messaging.GET_PENDING_SENDERS)
const pair = async (client: WsRpcClient, sender: string, channel: string) => {
  const generated = await client.invoke(RPC_CHANNELS.messaging.GENERATE_CODE, 'a-session', 'telegram')
  await fireMessage(message(sender, channel, `/pair ${generated.code}`))
}
try {
  await startServer()
  let a = connect(alice), b = connect(bob), r = connect(reader)
  await Promise.all([list(a), list(b), list(r)])
  await denied(() => r.invoke(RPC_CHANNELS.messaging.GENERATE_CODE, 'a-session', 'telegram'))
  await denied(() => a.invoke(RPC_CHANNELS.messaging.GENERATE_CODE, 'foreign-session', 'telegram'))
  const initialConfig = JSON.stringify(config!.get())
  if (scenario === 'held-pair') {
    const entered = new Promise<void>(resolve => { lookupEntered = resolve }); heldLookup = new Promise<void>(resolve => { releaseLookup = resolve })
    const generated = await a.invoke(RPC_CHANNELS.messaging.GENERATE_CODE, 'a-session', 'telegram')
    const pendingPair = fireMessage!(message('alice-external', '-1001', `/pair ${generated.code}`)); const rejection = denied(() => pendingPair)
    await entered; authority.revokeWorkspaceGrant(admin.credential, alice.principal.subject, 'a'); releaseLookup!(); await rejection
    assert.equal(registry.getBindings('a').length, 0); assert.equal(JSON.stringify(config!.get()), initialConfig)
  } else {
    await pair(a, 'alice-external', '-1001'); await pair(b, 'bob-external', '-1002')
    const aliceBinding = registry.getBindings('a').find(binding => binding.channelId === '-1001')!
    assert(aliceBinding); assert.deepEqual(aliceBinding.nativeOwner, owner(alice)); assert.deepEqual(aliceBinding.allowedSenderIds, ['alice-external'])
    assert.equal(JSON.stringify(config!.get()), initialConfig, 'native pairing must not acquire global bot ownership')
    assert.equal((await a.invoke(RPC_CHANNELS.messaging.GET_BINDINGS)).length, 1)
    if (scenario === 'restart') {
      for (const client of clients) client.destroy(); server!.close(); await registry.stopAll(); authority.close()
      authority = new NativeAuthority({ stateDir: join(directory, 'authority') }); registry = makeRegistry(); await startServer()
      a = connect(alice); b = connect(bob); r = connect(reader); await Promise.all([list(a), list(b), list(r)])
      await fireMessage!(message('alice-external', '-1001')); assert.equal(routed, 1)
    }
    if (scenario === 'forged') {
      const actual = gateway!.getBindingStore().getAll().find(binding => binding.channelId === '-1001')!
      actual.nativeOwner = owner(bob)
      await fireMessage!(message('stranger', '-1001')); assert.equal(registry.getPendingSenders('a').length, 0)
      assert.equal((await b.invoke(RPC_CHANNELS.messaging.GET_BINDINGS)).length, 1)
      actual.nativeOwner = owner(alice)
    } else if (scenario.startsWith('recovery')) {
      const staleCode = await a.invoke(RPC_CHANNELS.messaging.GENERATE_CODE, 'a-session', 'telegram')
      const bobBindingId = registry.getBindings('a').find(binding => binding.channelId === '-1002')!.id
      authority.revokeWorkspaceGrant(admin.credential, alice.principal.subject, 'a')
      for (const text of ['hello', '/help', '/status', '/new', '/bind']) await fireMessage!(message('alice-external', '-1001', text))
      assert.equal(routed, 0); assert.equal(registry.getPendingSenders('a').length, 0)
      a.destroy(); authority.grantWorkspace(admin.credential, alice.principal.subject, 'a', ['read', 'write', 'subscribe'])
      a = connect(alice); await list(a)
      assert.equal(authority.authorizeMessagingBinding(aliceBinding, root), null, 'regrant must not reactivate an old receipt')
      assert.deepEqual(authority.getMessagingBindingOwner(aliceBinding, root), owner(alice))
      assert.equal((await a.invoke(RPC_CHANNELS.messaging.GET_BINDINGS)).length, 0)
      if (scenario === 'recovery-foreign') {
        const actual = gateway!.getBindingStore().getAll().find(binding => binding.id === aliceBinding.id)!
        actual.nativeOwner = owner(bob)
        writeFileSync(join(root, 'messaging/bindings.json'), JSON.stringify(gateway!.getBindingStore().getAll()))
        const forgedBytes = readFileSync(join(root, 'messaging/bindings.json'))
        await pair(b, 'bob-external', '-1001')
        assert.equal(registry.getBindings('a').find(binding => binding.channelId === '-1001')!.id, aliceBinding.id)
        assert(readFileSync(join(root, 'messaging/bindings.json')).equals(forgedBytes), 'foreign fresh pair must preserve the old binding')
        assert.equal(JSON.stringify(config!.get()), initialConfig)
        await fireMessage!(message('bob-external', '-1001')); assert.equal(routed, 0)
      } else if (scenario === 'recovery-bad-code') {
        const bytes = readFileSync(join(root, 'messaging/bindings.json'))
        await fireMessage!(message('alice-external', '-1001', '/pair invalid'))
        await fireMessage!(message('alice-external', '-1001', `/pair ${staleCode.code}`))
        assert(readFileSync(join(root, 'messaging/bindings.json')).equals(bytes))
        assert.equal(registry.getBindings('a').find(binding => binding.channelId === '-1001')!.id, aliceBinding.id)
        assert.equal(JSON.stringify(config!.get()), initialConfig)
      } else if (scenario === 'recovery-disabled') {
        const freshCode = await a.invoke(RPC_CHANNELS.messaging.GENERATE_CODE, 'a-session', 'telegram')
        config!.update({ platforms: { telegram: { ...config!.get().platforms.telegram!, accessMode: 'disabled' } } })
        const bytes = readFileSync(join(root, 'messaging/bindings.json'))
        await fireMessage!(message('alice-external', '-1001', `/pair ${freshCode.code}`))
        assert(readFileSync(join(root, 'messaging/bindings.json')).equals(bytes)); assert.equal(routed, 0)
        await denied(() => a.invoke(RPC_CHANNELS.messaging.GENERATE_CODE, 'a-session', 'telegram'))
        config!.update({ platforms: { telegram: { ...config!.get().platforms.telegram!, accessMode: 'owner-control' } } })
      }
      const invalidations: unknown[][] = []
      a.on(RPC_CHANNELS.messaging.PENDING_CHANGED, (...args) => invalidations.push(args))
      await pair(a, 'alice-external', '-1001'); await Bun.sleep(20)
      assert.deepEqual(invalidations, [['a']], 'successful re-pair must refresh Inbox with a bounded native event')
      const repaired = registry.getBindings('a').find(binding => binding.channelId === '-1001')!
      assert.notEqual(repaired.id, aliceBinding.id); assert.deepEqual(repaired.nativeOwner, owner(alice))
      assert.deepEqual(repaired.allowedSenderIds, ['alice-external'])
      assert.deepEqual(authority.authorizeMessagingBinding(repaired, root), owner(alice))
      assert.equal(registry.getBindings('a').find(binding => binding.channelId === '-1002')!.id, bobBindingId)
      assert.equal((await a.invoke(RPC_CHANNELS.messaging.GET_BINDINGS)).length, 1)
      assert.equal(JSON.stringify(config!.get()), initialConfig)
      await fireMessage!(message('recovered-stranger', '-1001'))
      const pending = await list(a); assert.equal(pending.length, 1); assert.equal(pending[0].bindingId, repaired.id)
      await a.invoke(RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER, 'telegram', 'recovered-stranger', { reason: 'not-on-binding-allowlist', bindingId: repaired.id })
      await fireMessage!(message('recovered-stranger', '-1001')); assert.equal(routed, 1)
      a.destroy(); await fireMessage!(message('alice-external', '-1001')); assert.equal(routed, 2)
    } else if (scenario === 'disabled') {
      const generated = await a.invoke(RPC_CHANNELS.messaging.GENERATE_CODE, 'a-session', 'telegram')
      config!.update({ platforms: { telegram: { ...config!.get().platforms.telegram!, accessMode: 'disabled' } } })
      await denied(() => a.invoke(RPC_CHANNELS.messaging.GENERATE_CODE, 'a-session', 'telegram'))
      await fireMessage!(message('alice-external', '-1001')); await fireMessage!(message('stranger', '-1001'))
      await fireMessage!(message('host-operator', '-1003', `/pair ${generated.code}`))
      assert.equal(routed, 0); assert.equal(registry.getPendingSenders('a').length, 0); assert.equal(registry.getBindings('a').length, 2)
    } else if (scenario === 'status-revoked') {
      const entered = new Promise<void>(resolve => { lookupEntered = resolve }); heldLookup = new Promise<void>(resolve => { releaseLookup = resolve })
      const sentBefore = sent.length
      const status = fireMessage!(message('alice-external', '-1001', '/status')); const rejection = denied(() => status)
      await entered; authority.revokeWorkspaceGrant(admin.credential, alice.principal.subject, 'a'); releaseLookup!(); await rejection
      assert.equal(sent.length, sentBefore); assert.equal(routed, 0)
    } else if (scenario === 'repair-failed') {
      const bindingsBefore = readFileSync(join(root, 'messaging/bindings.json'))
      const original = authority.registerMessagingBinding.bind(authority)
      authority.registerMessagingBinding = () => { throw new Error('Synthetic private receipt commit failure') }
      await denied(() => pair(a, 'alice-external', '-1001'))
      authority.registerMessagingBinding = original
      assert(readFileSync(join(root, 'messaging/bindings.json')).equals(bindingsBefore))
      assert.equal(registry.getBindings('a').find(binding => binding.channelId === '-1001')!.id, aliceBinding.id)
      assert.equal(JSON.stringify(config!.get()), initialConfig)
    } else if (scenario === 'diagnostics') {
      const before = sent.length
      for (const type of ['error', 'typed_error']) gateway!.onSessionEvent(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'a' }, { type, sessionId: 'a-session', error: 'DO-NOT-LEAK-native-diagnostic: /private/host/token' })
      gateway!.onSessionEvent(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'a' }, { type: 'tool_start', sessionId: 'a-session', toolName: 'DO-NOT-LEAK-native-tool-path' })
      await Bun.sleep(20)
      const visible = sent.slice(before)
      assert.equal(visible.length, 4); assert(visible.every(value => !value.includes('DO-NOT-LEAK') && !value.includes('/private/host') && !value.includes('chat.sessionRequestFailed')))
    } else if (scenario === 'dismiss') {
      await fireMessage!(message('same-stranger', '-1001')); await fireMessage!(message('same-stranger', '-1002')); await fireMessage!(message('same-stranger', '-9999'))
      await denied(() => b.invoke(RPC_CHANNELS.messaging.DISMISS_PENDING_SENDER, 'telegram', 'same-stranger', { bindingId: aliceBinding.id }))
      await a.invoke(RPC_CHANNELS.messaging.DISMISS_PENDING_SENDER, 'telegram', 'same-stranger', { reason: 'not-on-binding-allowlist', bindingId: aliceBinding.id })
      assert.equal((await list(a)).length, 0); assert.equal((await list(b)).length, 1); assert.equal(registry.getPendingSenders('a').length, 2)
      assert.equal(JSON.stringify(config!.get()), initialConfig)
    } else if (scenario === 'revoked' || scenario === 'root') {
      const generated = await a.invoke(RPC_CHANNELS.messaging.GENERATE_CODE, 'a-session', 'telegram')
      if (scenario === 'revoked') authority.revokeWorkspaceGrant(admin.credential, alice.principal.subject, 'a')
      else { renameSync(root, root + '-old'); mkdirSync(root) }
      await fireMessage!(message('alice-external', '-1001')); await fireMessage!(message('stranger', '-1001'))
      await fireMessage!(message('alice-external', '-1003', `/pair ${generated.code}`))
      assert.equal(routed, 0); assert.equal(registry.getPendingSenders('a').length, 0); assert.equal(registry.getBindings('a').length, 2)
      assert.equal(JSON.stringify(config!.get()), initialConfig)
    } else {
      await fireMessage!(message('same-stranger', '-1001')); await fireMessage!(message('same-stranger', '-1002'))
      await fireMessage!(message('unknown-global', '-9999'))
      assert.equal(registry.getPendingSenders('a').length, 3)
      const alicePending = await list(a), bobPending = await list(b)
      assert.equal(alicePending.length, 1); assert.equal(bobPending.length, 1)
      assert.deepEqual(alicePending[0].nativeOwner, owner(alice)); assert.equal(alicePending[0].bindingId, aliceBinding.id)
      assert.equal((await list(r)).length, 0)
      await denied(() => b.invoke(RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER, 'telegram', 'same-stranger', { bindingId: aliceBinding.id }))
      await a.invoke(RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER, 'telegram', 'same-stranger', { reason: 'not-on-binding-allowlist', bindingId: aliceBinding.id })
      assert.equal((await list(a)).length, 0); assert.equal((await list(b)).length, 1)
      assert.equal(JSON.stringify(config!.get()), initialConfig)
      await fireMessage!(message('same-stranger', '-1001')); assert(routed > 0)
      const before = routed; await fireMessage!(message('host-operator', '-1001')); assert.equal(routed, before, 'host bot owners do not enter native bindings')
      await fireButton!({ platform: 'telegram', channelId: '-1001', threadId: 7, senderId: 'host-operator', messageId: 'button', buttonId: 'bind:a-session' })
      assert.equal(registry.getBindings('a').find(binding => binding.channelId === '-1001')!.id, aliceBinding.id)
      a.destroy(); await fireMessage!(message('alice-external', '-1001')); assert(routed > before, 'normal native client close must not disable a durable binding')
      assert.equal(readFileSync(join(root, 'messaging/config.json'), 'utf8').includes(alice.principal.subject), false)
    }
  }
  console.log(`native messaging producer ${scenario} passed`)
} finally { for (const client of clients) client.destroy(); server!.close(); await registry.stopAll(); authority.close() }
