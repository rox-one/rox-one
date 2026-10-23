import { beforeEach, describe, expect, it } from 'bun:test'
import { ImService, normalizeImMessage, normalizeImStatus, type ImPushSink } from '../service'
import type {
  ImChatCoreClient,
  ImChatCoreOptions,
  ImMessageEvent,
  ImPresenceEvent,
  ImStatusEvent,
  ImTypingEvent,
} from '../types'

const OPTIONS: ImChatCoreOptions = {
  relayUrl: 'ws://127.0.0.1:0/relay',
  dbPath: '/tmp/im-chat-core-test.sqlite',
  secretKeyHex: '00'.repeat(32),
}

interface FakeClient extends ImChatCoreClient {
  emitMessage(message: ImMessageEvent): void
  emitPresence(presence: ImPresenceEvent): void
  emitTyping(typing: ImTypingEvent): void
  emitStatus(status: unknown): void
  calls: { subscribe: string[]; unsubscribe: string[]; sent: Array<[string, string]>; typing: Array<[string, boolean]>; reads: string[] }
}

function fakeClient(): FakeClient {
  let onMessage: ((message: ImMessageEvent) => void) | null = null
  let onPresence: ((presence: ImPresenceEvent) => void) | null = null
  let onTyping: ((typing: ImTypingEvent) => void) | null = null
  let onStatus: ((status: unknown) => void) | null = null
  const calls: FakeClient['calls'] = { subscribe: [], unsubscribe: [], sent: [], typing: [], reads: [] }
  return {
    start: () => {},
    stop: () => {},
    subscribe: (channelId) => { calls.subscribe.push(channelId) },
    unsubscribe: (channelId) => { calls.unsubscribe.push(channelId) },
    sendMessage: (channelId, text) => {
      calls.sent.push([channelId, text])
      return { id: 'm1', channelId, senderId: 'me', text, createdAt: 42 }
    },
    listMessages: (_channel?: string) => [],
    publishTyping: (channelId, isTyping) => { calls.typing.push([channelId, isTyping]) },
    markRead: (channelId) => { calls.reads.push(channelId) },
    onMessage: (cb) => { onMessage = cb },
    onPresence: (cb) => { onPresence = cb },
    onTyping: (cb) => { onTyping = cb },
    onStatus: (cb) => { onStatus = cb },
    emitMessage: (message) => onMessage?.(message),
    emitPresence: (presence) => onPresence?.(presence),
    emitTyping: (typing) => onTyping?.(typing),
    emitStatus: (status) => onStatus?.(status),
    calls,
  }
}

interface RecordedPush {
  messages: ImMessageEvent[]
  presence: ImPresenceEvent[]
  typing: ImTypingEvent[]
  status: ImStatusEvent[]
}

function recordingSink(sink: RecordedPush): ImPushSink {
  return {
    message: (m) => sink.messages.push(m),
    presence: (p) => sink.presence.push(p),
    typing: (t) => sink.typing.push(t),
    status: (s) => sink.status.push(s),
  }
}

describe('ImService — native available', () => {
  let client: FakeClient
  let push: RecordedPush
  let service: ImService
  let loadCount: number

  beforeEach(() => {
    client = fakeClient()
    push = { messages: [], presence: [], typing: [], status: [] }
    loadCount = 0
    service = new ImService({
      enabled: true,
      resolveChatCoreOptions: () => OPTIONS,
      load: async () => {
        loadCount += 1
        return { createChatCore: () => client }
      },
    })
    service.setPush(recordingSink(push))
  })

  it('starts the client once and reports native mode', async () => {
    const status = await service.ensureStarted()
    await service.ensureStarted()
    expect(status).toEqual({ available: true, mode: 'native' })
    expect(service.isAvailable()).toBe(true)
    expect(loadCount).toBe(1)
  })

  it('forwards onMessage as an im:message event', async () => {
    await service.ensureStarted()
    const message: ImMessageEvent = { id: 'm7', channelId: 'c1', senderId: 'u2', text: 'hello', createdAt: 1000 }
    client.emitMessage(message)
    expect(push.messages).toEqual([message])
  })

  it('forwards onPresence as an im:presence event', async () => {
    await service.ensureStarted()
    const presence: ImPresenceEvent = { userId: 'u2', status: 'online', lastSeenAt: 1234 }
    client.emitPresence(presence)
    expect(push.presence).toEqual([presence])
  })

  it('forwards onTyping as an im:typing event', async () => {
    await service.ensureStarted()
    const typing: ImTypingEvent = { channelId: 'c1', userId: 'u2', isTyping: true }
    client.emitTyping(typing)
    expect(push.typing).toEqual([typing])
  })

  it('normalizes onStatus into an im:statusChanged event', async () => {
    await service.ensureStarted()
    push.status.length = 0
    client.emitStatus({ available: false, reason: 'relay-down' })
    expect(push.status).toEqual([{ available: false, mode: 'fallback', reason: 'relay-down' }])
  })

  it('delegates request channels to the native client', async () => {
    expect(await service.subscribeChannel('c1')).toEqual({ ok: true })
    expect(await service.unsubscribeChannel('c1')).toEqual({ ok: true })
    const sent = await service.sendMessage('c1', 'hi there')
    expect(sent.ok).toBe(true)
    expect(await service.publishTyping('c1', true)).toEqual({ ok: true })
    expect(await service.markRead('c1')).toEqual({ ok: true })
    expect(client.calls.subscribe).toEqual(['c1'])
    expect(client.calls.unsubscribe).toEqual(['c1'])
    expect(client.calls.sent).toEqual([['c1', 'hi there']])
    expect(client.calls.typing).toEqual([['c1', true]])
    expect(client.calls.reads).toEqual(['c1'])
  })

  it('refcounts subscribe/unsubscribe so overlapping hooks keep the native sub', async () => {
    await service.ensureStarted()
    client.calls.subscribe = []
    client.calls.unsubscribe = []
    expect(await service.subscribeChannel('c1')).toEqual({ ok: true })
    expect(await service.subscribeChannel('c1')).toEqual({ ok: true })
    expect(client.calls.subscribe).toEqual(['c1'])
    expect(await service.unsubscribeChannel('c1')).toEqual({ ok: true })
    expect(client.calls.unsubscribe).toEqual([])
    expect(await service.unsubscribeChannel('c1')).toEqual({ ok: true })
    expect(client.calls.unsubscribe).toEqual(['c1'])
    // Extra unsubscribe is a no-op at the wire
    expect(await service.unsubscribeChannel('c1')).toEqual({ ok: true })
    expect(client.calls.unsubscribe).toEqual(['c1'])
  })
})

describe('ImService — native unavailable (fallback)', () => {
  it('never throws when the module import fails and reports team-chat fallback', async () => {
    const push: RecordedPush = { messages: [], presence: [], typing: [], status: [] }
    const service = new ImService({
      enabled: true,
      resolveChatCoreOptions: () => OPTIONS,
      load: async () => {
        throw new Error("Cannot find module '@rox/chat-core'")
      },
    })
    service.setPush(recordingSink(push))

    const status = await service.ensureStarted()
    expect(status).toEqual({ available: false, mode: 'fallback', reason: 'module-missing' })
    expect(service.isAvailable()).toBe(false)
    expect(push.status).toEqual([{ available: false, mode: 'fallback', reason: 'module-missing' }])

    const result = await service.subscribeChannel('c1')
    expect(result).toEqual({ ok: false, reason: 'module-missing', fallback: 'team-chat' })
    expect(await service.sendMessage('c1', 'x')).toEqual({ ok: false, reason: 'module-missing', fallback: 'team-chat' })
  })

  it('does not load the module when the flag is off', async () => {
    let loaded = false
    const service = new ImService({
      enabled: false,
      resolveChatCoreOptions: () => OPTIONS,
      load: async () => {
        loaded = true
        return {}
      },
    })
    const status = await service.ensureStarted()
    expect(status).toEqual({ available: false, mode: 'fallback', reason: 'flag-disabled' })
    expect(loaded).toBe(false)
    expect(await service.listMessages({ channelId: 'c1' })).toEqual({
      ok: false,
      reason: 'flag-disabled',
      fallback: 'team-chat',
    })
  })
})

describe('normalizeImStatus', () => {
  it('treats non-object payloads as unavailable', () => {
    expect(normalizeImStatus(undefined)).toEqual({ available: false, mode: 'fallback' })
    expect(normalizeImStatus('online')).toEqual({ available: false, mode: 'fallback' })
  })

  it('honors the online alias', () => {
    expect(normalizeImStatus({ online: true })).toEqual({ available: true, mode: 'native' })
  })

  it('maps native connection states to available', () => {
    expect(normalizeImStatus({ state: 'connected' })).toEqual({ available: true, mode: 'native' })
    expect(normalizeImStatus({ state: 'reconnecting' })).toEqual({
      available: true,
      mode: 'native',
      reason: 'reconnecting',
    })
    expect(normalizeImStatus({ state: 'offline' })).toEqual({
      available: false,
      mode: 'fallback',
      reason: 'offline',
    })
  })
})

describe('normalizeImMessage e-tags', () => {
  it('prefers reply-marked e tag over earlier root e', () => {
    const msg = normalizeImMessage({
      id: 'm1',
      channelId: 'c1',
      senderId: 'u1',
      text: 'hi',
      createdAt: 1000,
      tags: [
        ['e', 'root-id'],
        ['e', 'parent-id', '', 'reply'],
        ['e', 'edit-target', '', 'edit'],
      ],
    })
    expect(msg?.replyToId).toBe('parent-id')
    expect(msg?.threadId).toBe('parent-id')
  })

  it('falls back to the last non-edit e when unmarked', () => {
    const msg = normalizeImMessage({
      id: 'm2',
      channel_id: 'c1',
      pubkey: 'pk',
      content: 'x',
      created_at: 1_700_000_000,
      tags: [
        ['e', 'root-id'],
        ['e', 'leaf-id'],
      ],
    })
    expect(msg?.replyToId).toBe('leaf-id')
    expect(msg?.channelId).toBe('c1')
    expect(msg?.senderId).toBe('pk')
  })
})
