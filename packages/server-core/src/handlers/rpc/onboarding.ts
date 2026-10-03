/**
 * Onboarding IPC handlers for Electron main process
 *
 * Handles workspace setup and configuration persistence.
 */
import { getRoxAccountAuthority, peekRoxAccountAuthority, LOCAL_ROX_CALLER, isRoxCloudRequired, getOnboardingAuthPayload, saveOmpRoxCredential } from '@rox/shared/auth'
import { getCredentialManager } from '@rox/shared/credentials'
import { isSetupDeferred, setSetupDeferred } from '@rox/shared/config'
import { prepareClaudeOAuth, exchangeClaudeCode, hasValidOAuthState, clearOAuthState, prepareMcpOAuth } from '@rox/shared/auth'
import { validateMcpConnection } from '@rox/shared/mcp'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import {
  isClaimableLive,
  rpcOnboardingActResult,
  rpcOnboardingListResult,
  rpcOnboardingReadResult,
} from '@rox/core/rox2'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

// ============================================
// IPC Handlers
// ============================================

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.onboarding.GET_AUTH_STATE,
  RPC_CHANNELS.onboarding.START_ROX_CONNECT,
  RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE,
  RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD,
  RPC_CHANNELS.onboarding.ENSURE_FIRST_SESSION,
  RPC_CHANNELS.onboarding.VALIDATE_MCP,
  RPC_CHANNELS.onboarding.START_MCP_OAUTH,
  RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH,
  RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE,
  RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.DEFER_SETUP,
  RPC_CHANNELS.onboarding.SAVE_OMP_CREDENTIAL,
  RPC_CHANNELS.onboarding.GET_ROX_BALANCE,
] as const

export function registerOnboardingHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.onboarding.ENSURE_FIRST_SESSION, async (_ctx, workspaceId: string) => {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new Error('workspaceId is required')
    return deps.sessionManager.ensureFirstSessionWelcome(workspaceId)
  })

  // Get current auth state
  server.handle(RPC_CHANNELS.onboarding.GET_AUTH_STATE, async ctx => {
    const listed = rpcOnboardingListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('onboarding auth state is not live')
    // Honor "Setup later" like the Electron main handler does — without the
    // flag, headless/WebUI clients re-enter onboarding on every reload.
    const { authState, setupNeeds } = await getOnboardingAuthPayload(isSetupDeferred())
    // Headless/read-only startup can report the missing native account vault.
    // It must not turn a supported non-cloud startup probe into a rejected RPC.
    const authority = peekRoxAccountAuthority()
    const cloud = authority
      ? await authority.state(ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : LOCAL_ROX_CALLER)
      : { connected: false }
    if (cloud.connected) {
      setupNeeds.needsOmpCredential = false
      setupNeeds.isFullyConfigured = true
    }
    setupNeeds.needsRoxCloud = isRoxCloudRequired() && !cloud.connected
    setupNeeds.shouldShowOnboardingOnLaunch = setupNeeds.needsRoxCloud
    setupNeeds.isFullyConfigured &&= !setupNeeds.needsRoxCloud
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
      setupNeeds,
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
    const act = rpcOnboardingActResult({ source: 'native', action: 'write', nativeId: mcpUrl || 'mcp' })
    if (!isClaimableLive(act)) return { success: false, error: 'onboarding mcp oauth is not live' }
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
    const act = rpcOnboardingActResult({ source: 'native', action: 'write', nativeId: 'claude' })
    if (!isClaimableLive(act)) return { success: false, error: 'onboarding claude oauth is not live' }
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
    if (!connectionSlug) return { success: false, error: 'onboarding.exchange: connectionSlug is required' }
    const act = rpcOnboardingActResult({ source: 'native', action: 'write', nativeId: connectionSlug })
    if (!isClaimableLive(act)) return { success: false, error: 'onboarding exchange is not live' }
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
      // Forward resolved identity (issue #838) so the renderer can thread it into
      // the SETUP payload, which is where it actually gets persisted. Credentials
      // are stored above via setLlmOAuth; identity is not a credential.
      const identity = (tokens.account || tokens.organization)
        ? { account: tokens.account, organization: tokens.organization }
        : undefined
      return { success: true, token: tokens.accessToken, identity }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Exchange Claude code error:', message)
      return { success: false, error: message }
    }
  })

  // Check if there's a valid OAuth state in progress
  server.handle(RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE, async () => {
    const valid = hasValidOAuthState()
    const read = rpcOnboardingReadResult({ source: 'native', nativeId: valid ? 'claude' : undefined })
    if (!isClaimableLive(read.result)) return false
    return true
  })

  // Clear OAuth state (for cancel/reset)
  server.handle(RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE, async () => {
    const act = rpcOnboardingActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'claude' })
    if (!isClaimableLive(act)) return { success: false }
    clearOAuthState()
    return { success: true }
  })

  // User chose "Setup later" — persist so onboarding doesn't re-show on next launch
  server.handle(RPC_CHANNELS.onboarding.DEFER_SETUP, async () => {
    const act = rpcOnboardingActResult({ source: 'native', action: 'write', nativeId: 'defer' })
    if (!isClaimableLive(act)) return { success: false }
    setSetupDeferred(true)
    log?.info('[Onboarding] User deferred setup')
    return { success: true }
  })

  server.handle(RPC_CHANNELS.onboarding.SAVE_OMP_CREDENTIAL, async (_ctx, apiKey: string) => {
    const act = rpcOnboardingActResult({ source: 'native', action: 'write', nativeId: 'omp' })
    if (!isClaimableLive(act)) return { success: false, error: 'onboarding omp credential is not live' }
    return saveOmpRoxCredential(typeof apiKey === 'string' ? apiKey : '')
  })
  const caller = (ctx: import('@rox/server-core/transport').RequestContext) => ctx.principal
    ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : LOCAL_ROX_CALLER
  server.handle(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE, ctx => getRoxAccountAuthority().state(caller(ctx)), { access: 'nativeOrLocalElectron', nativeAction: 'read' })
  server.handle(RPC_CHANNELS.onboarding.START_ROX_CONNECT, async ctx => {
    try {
      const started = await getRoxAccountAuthority().start(caller(ctx))
      // The redemption proof and device_code stay in this process.
      return { success: true, userCode: started.userCode, verificationUri: started.verificationUri, verificationUriComplete: started.verificationUriComplete, expiresIn: started.expiresIn }
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'ROX_CONNECT_FAILED' } }
  }, { access: 'localElectron', nativeAction: 'read' })
  server.handle(RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD, async ctx => {
    await getRoxAccountAuthority().logout(caller(ctx))
    return { success: true }
  }, { access: 'localElectron', nativeAction: 'read' })
  server.handle(RPC_CHANNELS.onboarding.GET_ROX_BALANCE, async ctx => {
    const state = await getRoxAccountAuthority().state(caller(ctx))
    if (state.connectError) return { status: 'error', message: state.connectError }
    if (!state.account) return { status: 'disconnected' }
    return { status: 'ok', balance: Number(state.account.balance.balanceRox) }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })
}
