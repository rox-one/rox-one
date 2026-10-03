import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

let setupDeferred = false
let setupDeferredReadCount = 0
const setupDeferredCalls: boolean[] = []
let oauthPreparationCalls = 0
const welcomeWorkspaceCalls: string[] = []

mock.module('@rox/shared/auth', () => ({
  LOCAL_ROX_CALLER: { issuer: 'rox:local-electron', subject: 'installation' },
  isRoxCloudRequired: () => true,
  getRoxAccountAuthority: () => ({ state: async () => ({ connected: false, account: null }) }),
  fetchRoxBalance: async () => ({ balanceRox: '0' }),
  getAuthState: async () => ({
    billing: {
      type: null,
      hasCredentials: false,
      apiKey: null,
      claudeOAuthToken: null,
    },
    workspace: { hasWorkspace: false, active: null },
  }),
  getSetupNeeds: (_state: unknown, deferred?: boolean) => ({
    needsBillingConfig: true,
    needsCredentials: false,
    isFullyConfigured: true,
    isSetupDeferred: deferred === true,
    shouldShowOnboardingOnLaunch: false,
  }),
  getOnboardingAuthPayload: async (deferred?: boolean) => ({
    authState: {
      billing: {
        type: null,
        hasCredentials: false,
        apiKey: null,
        claudeOAuthToken: null,
      },
      workspace: { hasWorkspace: false, active: null },
    },
    setupNeeds: {
      needsBillingConfig: true,
      needsCredentials: false,
      isFullyConfigured: true,
      isSetupDeferred: deferred === true,
      shouldShowOnboardingOnLaunch: false,
    },
  }),
  saveOmpRoxCredential: async () => ({ success: true, ready: true }),
  prepareClaudeOAuth: () => {
    oauthPreparationCalls += 1
    return 'https://example.test/oauth'
  },
  exchangeClaudeCode: async () => ({ accessToken: 'test-token' }),
  hasValidOAuthState: () => false,
  clearOAuthState: () => {},
  prepareMcpOAuth: async () => {
    oauthPreparationCalls += 1
    return {
      authUrl: 'https://example.test/oauth',
      state: 'test-state',
      codeVerifier: 'test-verifier',
      tokenEndpoint: 'https://example.test/token',
      clientId: 'test-client',
      redirectUri: 'http://127.0.0.1/callback',
    }
  },
}))

mock.module('@rox/shared/config', () => ({
  isSetupDeferred: () => {
    setupDeferredReadCount += 1
    return setupDeferred
  },
  setSetupDeferred: (deferred: boolean) => {
    setupDeferredCalls.push(deferred)
    setupDeferred = deferred
  },
}))

mock.module('@rox/shared/credentials', () => ({
  getCredentialManager: () => ({
    setLlmOAuth: async () => {},
    setClaudeOAuthCredentials: async () => {},
    hasRoxCloudSession: async () => false,
  }),
}))

mock.module('@rox/shared/mcp', () => ({
  validateMcpConnection: async () => ({ success: true }),
}))

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

async function createHarness() {
  // This module must load after Bun installs the isolated auth/config seams;
  // a static import would bind the real credential and OAuth implementations.
  const { registerOnboardingHandlers } = await import('../onboarding')
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
  } as unknown as RpcServer
  const deps = {
    sessionManager: {
      ensureFirstSessionWelcome: async (workspaceId: string) => {
        welcomeWorkspaceCalls.push(workspaceId)
        return { id: 'welcome', messages: [{ role: 'assistant', content: 'Hello' }] }
      },
    },
    platform: {
      logger: { info() {}, error() {}, warn() {}, debug() {} },
    },
  } as HandlerDeps

  registerOnboardingHandlers(server, deps)

  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`missing handler for ${channel}`)
    return handler({}, ...args)
  }

  return { invoke }
}

beforeEach(() => {
  setupDeferred = false
  setupDeferredReadCount = 0
  setupDeferredCalls.length = 0
  oauthPreparationCalls = 0
  welcomeWorkspaceCalls.length = 0
})

describe('onboarding:getAuthState', () => {
  it('requires Pocket authentication even when provider setup is deferred', async () => {
    const { invoke } = await createHarness()
    const result = await invoke(RPC_CHANNELS.onboarding.GET_AUTH_STATE) as {
      setupNeeds: {
        needsBillingConfig: boolean
        needsCredentials: boolean
        isFullyConfigured: boolean
        shouldShowOnboardingOnLaunch?: boolean
        isSetupDeferred?: boolean
      }
    }

    expect(result.setupNeeds.needsBillingConfig).toBe(true)
    expect(result.setupNeeds.needsCredentials).toBe(false)
    expect(result.setupNeeds.isFullyConfigured).toBe(false)
    expect(result.setupNeeds.shouldShowOnboardingOnLaunch).toBe(true)
    expect(result.setupNeeds.isSetupDeferred).toBe(false)
    expect(setupDeferredReadCount).toBe(1)
    expect(oauthPreparationCalls).toBe(0)
  })

  it('preserves provider deferral while requiring the independent Pocket gate', async () => {
    setupDeferred = true
    const { invoke } = await createHarness()
    const result = await invoke(RPC_CHANNELS.onboarding.GET_AUTH_STATE) as {
      setupNeeds: {
        isFullyConfigured: boolean
        shouldShowOnboardingOnLaunch?: boolean
        isSetupDeferred?: boolean
      }
    }

    expect(result.setupNeeds.isFullyConfigured).toBe(false)
    expect(result.setupNeeds.shouldShowOnboardingOnLaunch).toBe(true)
    expect(result.setupNeeds.isSetupDeferred).toBe(true)
    expect(setupDeferredReadCount).toBe(1)
  })

  it('persists explicit setup deferral only when the user chooses it', async () => {
    const { invoke } = await createHarness()

    await invoke(RPC_CHANNELS.onboarding.DEFER_SETUP)

    expect(setupDeferredCalls).toEqual([true])
  })
})

describe('onboarding:getRoxBalance', () => {
  it('is registered and reports «disconnected» without a Rox cloud session', async () => {
    const { invoke } = await createHarness()
    expect(await invoke(RPC_CHANNELS.onboarding.GET_ROX_BALANCE)).toEqual({ status: 'disconnected' })
  })
})

describe('onboarding:ensureFirstSession', () => {
  it('returns the persisted assistant conversation without starting OAuth or credential setup', async () => {
    const { invoke } = await createHarness()
    expect(await invoke(RPC_CHANNELS.onboarding.ENSURE_FIRST_SESSION, 'ws')).toEqual({
      id: 'welcome', messages: [{ role: 'assistant', content: 'Hello' }],
    })
    expect(welcomeWorkspaceCalls).toEqual(['ws'])
    expect(oauthPreparationCalls).toBe(0)
  })

  it('requires a workspace before creating a greeting', async () => {
    const { invoke } = await createHarness()
    await expect(invoke(RPC_CHANNELS.onboarding.ENSURE_FIRST_SESSION, '  ')).rejects.toThrow('workspaceId is required')
    expect(welcomeWorkspaceCalls).toEqual([])
  })
})
