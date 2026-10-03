/**
 * Onboarding IPC handlers for Electron main process
 *
 * Handles workspace setup and configuration persistence.
 */
import { getOnboardingAuthPayload, saveOmpRoxCredential } from '@rox/shared/auth'
import {
  fetchRoxBalance,
  getRoxAuthBaseUrl,
  isRoxCloudRequired,
  startRoxDeviceFlow,
  waitForRoxDeviceApproval,
} from '@rox/shared/auth/rox-cloud'
import { isSetupDeferred, setSetupDeferred } from '@rox/shared/config/storage'
import { getCredentialManager } from '@rox/shared/credentials'
import { prepareClaudeOAuth, exchangeClaudeCode, hasValidOAuthState, clearOAuthState, prepareMcpOAuth } from '@rox/shared/auth'
import { validateMcpConnection } from '@rox/shared/mcp'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer, RequestContext } from '@rox/server-core/transport'
import type { HandlerDeps } from './handlers/handler-deps'
import { RoxConnectFlow } from './rox-connect-flow'

// ============================================
// IPC Handlers
// ============================================

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.onboarding.GET_AUTH_STATE,
  RPC_CHANNELS.onboarding.VALIDATE_MCP,
  RPC_CHANNELS.onboarding.START_MCP_OAUTH,
  RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH,
  RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE,
  RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.DEFER_SETUP,
  RPC_CHANNELS.onboarding.START_ROX_CONNECT,
  RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE,
  RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD,
  RPC_CHANNELS.onboarding.GET_ROX_BALANCE,
  RPC_CHANNELS.onboarding.SAVE_OMP_CREDENTIAL,
] as const

export function registerOnboardingHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // Get current auth state
  server.handle(RPC_CHANNELS.onboarding.GET_AUTH_STATE, async () => {
    const { authState, setupNeeds } = await getOnboardingAuthPayload(isSetupDeferred())
    const manager = getCredentialManager()
    const roxSession = await manager.getRoxCloudSession()
    const roxCloudRequired = isRoxCloudRequired()
    const hasRoxCloud = await manager.hasRoxCloudSession()
    // Redact raw credentials — renderer only needs boolean flags (hasCredentials, setupNeeds)
    return {
      authState: {
        ...authState,
        billing: {
          ...authState.billing,
          apiKey: authState.billing.apiKey ? '••••' : null,
          claudeOAuthToken: authState.billing.claudeOAuthToken ? '••••' : null,
        },
      },
      setupNeeds: {
        ...setupNeeds,
        needsRoxCloud: roxCloudRequired && !hasRoxCloud,
        isFullyConfigured: setupNeeds.isFullyConfigured && (!roxCloudRequired || hasRoxCloud) && !setupNeeds.needsOmpCredential,
      },
      roxCloud: {
        required: roxCloudRequired,
        connected: hasRoxCloud,
        authBaseUrl: getRoxAuthBaseUrl(),
        user: roxSession
          ? { id: roxSession.userId, email: roxSession.email, name: roxSession.name }
          : null,
      },
    }
  })

  // Validate MCP connection
  server.handle(RPC_CHANNELS.onboarding.VALIDATE_MCP, async (_ctx, mcpUrl: string, accessToken?: string) => {
    try {
      const result = await validateMcpConnection({
        mcpUrl,
        mcpAccessToken: accessToken,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Prepare MCP server OAuth (server-side only — no browser open).
  // Returns authUrl for the client to open locally.
  // NOTE: Currently unused in renderer. If re-enabled, needs client-side
  // orchestration (callback server + browser open) like performOAuth().
  server.handle(RPC_CHANNELS.onboarding.START_MCP_OAUTH, async (_ctx, mcpUrl: string, callbackPort?: number) => {
    log.info('[Onboarding:Main] ONBOARDING_START_MCP_OAUTH received')
    try {
      if (!callbackPort) {
        throw new Error('callbackPort is required — client must run a local callback server')
      }
      const prepared = await prepareMcpOAuth(mcpUrl, { callbackPort })
      log.info('[Onboarding:Main] MCP OAuth prepared, returning authUrl to client')

      return {
        success: true,
        authUrl: prepared.authUrl,
        state: prepared.state,
        codeVerifier: prepared.codeVerifier,
        tokenEndpoint: prepared.tokenEndpoint,
        clientId: prepared.clientId,
        redirectUri: prepared.redirectUri,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding:Main] MCP OAuth prepare failed:', message)
      return { success: false, error: message }
    }
  })

  // Prepare Claude OAuth flow (server-side only — no browser open).
  // Returns authUrl for the client to open locally via shell.openExternal.
  server.handle(RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH, async () => {
    try {
      log.info('[Onboarding] Preparing Claude OAuth flow...')

      const authUrl = prepareClaudeOAuth()

      log.info('[Onboarding] Claude OAuth URL generated (client will open browser)')
      return { success: true, authUrl }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Prepare Claude OAuth error:', message)
      return { success: false, error: message }
    }
  })

  // Exchange authorization code for tokens
  server.handle(RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE, async (_ctx, authorizationCode: string, connectionSlug: string) => {
    try {
      log.info(`[Onboarding] Exchanging Claude authorization code for connection: ${connectionSlug}`)

      if (!hasValidOAuthState()) {
        log.error('[Onboarding] No valid OAuth state found')
        return { success: false, error: 'OAuth session expired. Please start again.' }
      }

      const tokens = await exchangeClaudeCode(authorizationCode, (status) => {
        log.info('[Onboarding] Claude code exchange status:', status)
      })

      // Save credentials with refresh token support
      const manager = getCredentialManager()

      // Save to new LLM connection system
      await manager.setLlmOAuth(connectionSlug, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      })

      // Also save to legacy key for validation compatibility
      await manager.setClaudeOAuthCredentials({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        source: 'native',
      })

      const expiresAtDate = tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : 'never'
      log.info(`[Onboarding] Claude OAuth saved to LLM connection (expires: ${expiresAtDate})`)
      return { success: true, token: tokens.accessToken }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Exchange Claude code error:', message)
      return { success: false, error: message }
    }
  })

  // Check if there's a valid OAuth state in progress
  server.handle(RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE, async () => {
    return hasValidOAuthState()
  })

  // Clear OAuth state (for cancel/reset)
  server.handle(RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE, async () => {
    clearOAuthState()
    return { success: true }
  })

  // User chose "Setup later" — persist so onboarding doesn't re-show on next launch.
  // Cleared automatically when user configures a provider from Settings.
  server.handle(RPC_CHANNELS.onboarding.DEFER_SETUP, async () => {
    // LLM provider setup can be deferred; Rox cloud Connect cannot when required.
    setSetupDeferred(true)
    log.info('[Onboarding] User deferred LLM setup')
    return { success: true }
  })

  const roxFlows = new Map<string, { flow: RoxConnectFlow; context: RequestContext }>()
  const cloudOwner = (ctx: RequestContext) => ctx.principal
    ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : undefined
  const roxFlow = (ctx: RequestContext) => {
    const owner = cloudOwner(ctx)
    const key = owner ? JSON.stringify(owner) : 'local'
    let record = roxFlows.get(key)
    if (!record) {
      const ownerContext = { current: ctx }
      const flow = new RoxConnectFlow({
        start: signal => startRoxDeviceFlow(undefined, { signal }),
        wait: waitForRoxDeviceApproval,
        save: async approved => {
          const latest = ownerContext.current
          if (latest.principal && (!latest.workspaceId || !deps.nativeData?.authority.authorize(latest.principal, latest.workspaceId, 'read'))) {
            throw new Error('ROX_CONNECT_CANCELLED')
          }
          await getCredentialManager().setRoxCloudSession({
            accessToken: approved.accessToken,
            expiresAt: Date.now() + approved.expiresIn * 1000,
            userId: approved.user.id,
            email: approved.user.email,
            name: approved.user.name,
            authBaseUrl: getRoxAuthBaseUrl(),
          }, owner)
          log.info('[Onboarding] Rox Connect succeeded')
        },
        clear: () => getCredentialManager().clearRoxCloudSession(owner),
        failed: message => log.error('[Onboarding] Rox Connect poll failed:', message),
      })
      record = { flow, get context() { return ownerContext.current }, set context(value) { ownerContext.current = value } }
      roxFlows.set(key, record)
    }
    record.context = ctx
    return record.flow
  }

  server.handle(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE, async ctx => {
    const manager = getCredentialManager()
    const session = await manager.getRoxCloudSession(cloudOwner(ctx))
    return {
      required: isRoxCloudRequired(),
      connected: await manager.hasRoxCloudSession(cloudOwner(ctx)),
      authBaseUrl: getRoxAuthBaseUrl(),
      user: session
        ? { id: session.userId, email: session.email, name: session.name }
        : null,
      ...roxFlow(ctx).state,
    }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  // Real balance from rox.one for the connected account. The token never
  // leaves the main process; without a live session the UI keeps its «—».
  server.handle(RPC_CHANNELS.onboarding.GET_ROX_BALANCE, async ctx => {
    const manager = getCredentialManager()
    if (!(await manager.hasRoxCloudSession(cloudOwner(ctx)))) return { status: 'disconnected' as const }
    const session = await manager.getRoxCloudSession(cloudOwner(ctx))
    if (!session?.accessToken) return { status: 'disconnected' as const }
    try {
      const { balanceRox } = await fetchRoxBalance(session.accessToken)
      const balance = Number.parseFloat(String(balanceRox))
      if (!Number.isFinite(balance)) return { status: 'error' as const, message: 'invalid balance payload' }
      return { status: 'ok' as const, balance }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('[Onboarding] Rox balance fetch failed:', message)
      return { status: 'error' as const, message }
    }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  server.handle(RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD, async ctx => {
    await roxFlow(ctx).clear()
    return { success: true }
  }, { access: 'localElectron', nativeAction: 'read' })

  /**
   * Start Rox Connect: create device grant, return user-facing codes.
   * Spawns background poll; renderer opens browser + watches GET_ROX_CLOUD_STATE.
   */
  server.handle(RPC_CHANNELS.onboarding.START_ROX_CONNECT, async ctx => {
    log.info('[Onboarding] Starting Rox cloud Connect device flow')
    try {
      const started = await roxFlow(ctx).start()

      return {
        success: true as const,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        verificationUriComplete: started.verificationUriComplete,
        expiresIn: started.expiresIn,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Rox Connect start failed:', message)
      return { success: false as const, error: message }
    }
  }, { access: 'localElectron', nativeAction: 'read' })

  server.handle(RPC_CHANNELS.onboarding.SAVE_OMP_CREDENTIAL, async (_ctx, apiKey: string) => {
    return saveOmpRoxCredential(typeof apiKey === 'string' ? apiKey : '')
  })
}
