import { describe, expect, it } from 'bun:test'
import { isChatCoreUnavailableError, loadImChatCore } from '../chat-core-loader'
import type { ImChatCoreClient, ImChatCoreOptions } from '../types'

const OPTIONS: ImChatCoreOptions = {
  relayUrl: 'ws://127.0.0.1:0/relay',
  dbPath: '/tmp/im-chat-core-test.sqlite',
  secretKeyHex: '00'.repeat(32),
}

function fakeClient(overrides: Partial<ImChatCoreClient> = {}): ImChatCoreClient {
  return {
    start: () => {},
    stop: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    sendMessage: () => ({ id: 'm1', channelId: 'c1', senderId: 'u1', text: 'hi', createdAt: 1 }),
    listMessages: () => [],
    publishTyping: () => {},
    ...overrides,
  }
}

describe('loadImChatCore', () => {
  it('reports flag-disabled without attempting to load when disabled', async () => {
    let loaded = false
    const result = await loadImChatCore({
      enabled: false,
      options: OPTIONS,
      load: async () => {
        loaded = true
        return {}
      },
    })
    expect(result).toEqual({ status: 'unavailable', reason: 'flag-disabled' })
    expect(loaded).toBe(false)
  })

  it('reports not-configured without attempting to load when options are absent', async () => {
    let loaded = false
    const result = await loadImChatCore({
      enabled: true,
      options: null,
      load: async () => {
        loaded = true
        return {}
      },
    })
    expect(result).toEqual({ status: 'unavailable', reason: 'not-configured' })
    expect(loaded).toBe(false)
  })

  it('falls back to module-missing and never throws when the package is absent', async () => {
    const result = await loadImChatCore({
      enabled: true,
      options: OPTIONS,
      load: async () => {
        throw new Error("Cannot find module '@rox/chat-core'")
      },
    })
    expect(result).toEqual({ status: 'unavailable', reason: 'module-missing' })
  })

  it('maps ChatCoreUnavailableError during import to native-unavailable', async () => {
    const error = new Error('native binding missing')
    error.name = 'ChatCoreUnavailableError'
    const result = await loadImChatCore({
      enabled: true,
      options: OPTIONS,
      load: async () => {
        throw error
      },
    })
    expect(result).toEqual({ status: 'unavailable', reason: 'native-unavailable' })
  })

  it('maps a ChatCoreUnavailableError thrown by start() to native-unavailable', async () => {
    const error = new Error('no native binding')
    error.name = 'ChatCoreUnavailableError'
    const result = await loadImChatCore({
      enabled: true,
      options: OPTIONS,
      load: async () => ({
        createChatCore: () => fakeClient({ start: () => { throw error } }),
      }),
    })
    expect(result).toEqual({ status: 'unavailable', reason: 'native-unavailable' })
  })

  it('maps any other start() failure to start-failed', async () => {
    const result = await loadImChatCore({
      enabled: true,
      options: OPTIONS,
      load: async () => ({
        createChatCore: () => fakeClient({ start: () => { throw new Error('boom') } }),
      }),
    })
    expect(result).toEqual({ status: 'unavailable', reason: 'start-failed' })
  })

  it('reports module-missing when the namespace lacks createChatCore', async () => {
    const result = await loadImChatCore({ enabled: true, options: OPTIONS, load: async () => ({}) })
    expect(result).toEqual({ status: 'unavailable', reason: 'module-missing' })
  })

  it('returns a started client when the module resolves', async () => {
    let started = 0
    const client = fakeClient({ start: () => { started += 1 } })
    const result = await loadImChatCore({
      enabled: true,
      options: OPTIONS,
      load: async () => ({ createChatCore: () => client }),
    })
    expect(result).toEqual({ status: 'ready', client })
    expect(started).toBe(1)
  })
})

describe('isChatCoreUnavailableError', () => {
  it('matches only the named error', () => {
    const error = new Error('x')
    error.name = 'ChatCoreUnavailableError'
    expect(isChatCoreUnavailableError(error)).toBe(true)
    expect(isChatCoreUnavailableError(new Error('x'))).toBe(false)
    expect(isChatCoreUnavailableError(null)).toBe(false)
    expect(isChatCoreUnavailableError('ChatCoreUnavailableError')).toBe(false)
  })
})
