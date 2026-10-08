/**
 * PERF-06: LIST_WITH_STATUS `{ refresh: false }` (renderer startup) never
 * waits on an OAuth network refresh; it refreshes in the background and
 * pushes llmConnections.CHANGED. Omitting options keeps the legacy refresh.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

const actualConfig = await import('@rox/shared/config')
const actualCredentials = await import('@rox/shared/credentials')
const actualClaudeToken = await import('@rox/shared/auth/claude-token')

type StoredOAuth = { accessToken: string; refreshToken?: string; expiresAt?: number }
let stored: StoredOAuth | null = null
let refreshCalls = 0
let refreshFails = false

const connection = { slug: 'claude-max', name: 'Claude', providerType: 'anthropic', authType: 'oauth', createdAt: 1 }
mock.module('@rox/shared/config', () => ({
  ...actualConfig,
  getLlmConnections: () => [{ ...connection }],
  getDefaultLlmConnection: () => connection.slug,
}))
const manager = {
  getLlmOAuth: async () => stored,
  setLlmOAuth: async (_slug: string, value: StoredOAuth) => { stored = value },
  getClaudeOAuthCredentials: async () => null,
  hasLlmCredentials: async () => stored !== null,
}
mock.module('@rox/shared/credentials', () => ({ ...actualCredentials, getCredentialManager: () => manager }))
mock.module('@rox/shared/auth/claude-token', () => ({
  ...actualClaudeToken,
  refreshClaudeToken: async () => {
    refreshCalls++
    if (refreshFails) throw new Error('refresh revoked')
    return { accessToken: 'fresh', refreshToken: 'refresh-2', expiresAt: Date.now() + 3_600_000 }
  },
}))

const { registerLlmConnectionsHandlers } = await import('../llm-connections')

const handlers = new Map<string, HandlerFn>()
const pushes: string[] = []
const server = {
  handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
  push(channel: string) { pushes.push(channel) },
  async invokeClient() { return undefined },
  hasClientCapability() { return false },
  findClientsWithCapability() { return [] },
} as unknown as RpcServer
registerLlmConnectionsHandlers(server, {
  platform: { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } },
} as unknown as HandlerDeps)

type Listed = { isAuthenticated: boolean; authError?: string; oauthTimeRemainingMs?: number; oauthRefreshError?: string }
const list = (...args: unknown[]) =>
  handlers.get(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS)!({ clientId: 'c1', workspaceId: null } as unknown as RequestContext, ...args) as Promise<Listed[]>
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(async () => {
  await settle()
  refreshCalls = 0
  refreshFails = false
  pushes.length = 0
})

describe('LIST_WITH_STATUS startup refresh', () => {
  test('refresh:false answers without a network refresh, then refreshes in the background', async () => {
    stored = { accessToken: 'old', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 }
    const [first] = await list({ refresh: false })
    expect(refreshCalls).toBe(0)
    // Shown the way a successful refresh would be (agents refresh on use).
    expect(first!.isAuthenticated).toBe(true)
    expect(first!.authError).toBeUndefined()
    expect(first!.oauthTimeRemainingMs).toBeUndefined()
    await settle()
    expect(refreshCalls).toBe(1)
    expect(pushes).toEqual([RPC_CHANNELS.llmConnections.CHANGED])
    const [after] = await list({ refresh: false })
    expect(refreshCalls).toBe(1)
    expect(after!.isAuthenticated).toBe(true)
    expect(after!.oauthTimeRemainingMs).toBeGreaterThan(0)
  })

  test('omitting options keeps the legacy refreshing listing', async () => {
    stored = { accessToken: 'old', refreshToken: 'refresh-3', expiresAt: Date.now() - 1000 }
    const [listed] = await list()
    expect(refreshCalls).toBe(1)
    expect(listed!.isAuthenticated).toBe(true)
    await settle()
    expect(pushes).toEqual([])
  })

  test('a failed background refresh is reported by the next non-refreshing listing', async () => {
    refreshFails = true
    stored = { accessToken: 'old', refreshToken: 'refresh-4', expiresAt: Date.now() - 1000 }
    await list({ refresh: false })
    await settle()
    expect(refreshCalls).toBe(1)
    const [listed] = await list({ refresh: false })
    expect(listed!.isAuthenticated).toBe(false)
    expect(listed!.authError).toBe('OAuth auto-refresh failed. Re-authenticate to continue.')
    expect(listed!.oauthRefreshError).toBe('refresh revoked')
  })
})
