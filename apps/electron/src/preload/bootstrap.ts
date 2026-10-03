/**
 * WS-mode preload — replaces the full IPC preload (index.ts).
 *
 * Normal mode (local server):
 *   Creates a RoutedClient that routes LOCAL_ONLY channels to the local
 *   Electron server and REMOTE_ELIGIBLE channels to whichever server owns
 *   the active workspace (local or remote). Workspace switches swap the
 *   workspace client transparently.
 *
 * Thin-client mode (CRAFT_SERVER_URL):
 *   Creates a single WsRpcClient connected to the remote server.
 *   All channels go to the remote server.
 *
 * On localhost the WS handshake completes in <1ms. The React app takes >100ms
 * to initialise, so by the time any component calls an API method, the
 * connection is established.
 */

import '@sentry/electron/preload'
import { contextBridge, ipcRenderer, shell, webUtils } from 'electron'
import { WsRpcClient, type TransportConnectionState } from '../transport/client'
import { RoutedClient } from '../transport/routed-client'
import { ProjectAuthorityConnection } from '../transport/project-authority-connection'
import { PROJECT_AUTHORITY_IPC, PROJECT_AUTHORITY_CONNECT_IPC, PROJECT_AUTHORITY_DISCONNECT_IPC, PROJECT_AUTHORITY_CONFIGURATION_IPC, type ProjectAuthorityTarget, type ProjectAuthorityConfiguration, type ProjectAuthorityMutationResult } from '../shared/project-authority'
import { buildClientApi } from '../transport/build-api'
import { CHANNEL_MAP } from '../transport/channel-map'
import { createCallbackServer } from '@craft-agent/shared/auth/callback-server'
import { createNativeReplicaBridge } from './native-replica'
import { CHATGPT_OAUTH_CONFIG } from '@craft-agent/shared/auth/chatgpt-oauth-config'
import {
  isOAuthFlowCancelledError,
  OAuthFlowTimedOutError,
  waitForOAuthCallback,
} from './oauth-wait'
import {
  CLIENT_OPEN_EXTERNAL,
  CLIENT_OPEN_PATH,
  CLIENT_SHOW_IN_FOLDER,
  CLIENT_CONFIRM_DIALOG,
  CLIENT_OPEN_FILE_DIALOG,
  CLIENT_BROWSER_INVOKE,
  LOCAL_CLIENT_CAPABILITIES,
} from '@craft-agent/server-core/transport'
import type { ConfirmDialogSpec, FileDialogSpec, BrowserCapabilityRequest } from '@craft-agent/server-core/transport'
import type { RpcClient } from '@craft-agent/server-core/transport'
import type { RemoteServerConfig } from '@craft-agent/core/types'
import type { ElectronAPI, SshBootstrapProgress, SshConnectionStatus } from '../shared/types'
import { isSshBacked } from '../shared/ssh'
import { MEETINGS_LOCAL_IPC, type MeetingsLocalApi } from '../shared/meetings-local'
import { MAIL_IPC, type MailLocalApi } from '../shared/mail-local'
import { peerTrustOptionsForRemote } from '../shared/remote-tls-client-options.ts'
import { createOpenClawHostControlBridge } from './openclaw-host-control'

// ---------------------------------------------------------------------------
// Client interface — common surface for both RoutedClient and WsRpcClient
// ---------------------------------------------------------------------------

interface TransportClient extends RpcClient {
  isChannelAvailable(channel: string): boolean
  getConnectionState(): TransportConnectionState
  onConnectionStateChanged(callback: (state: TransportConnectionState) => void): () => void
  reconnectNow(): void
}

// ---------------------------------------------------------------------------
// Connection setup
// ---------------------------------------------------------------------------

const webContentsId: number = ipcRenderer.sendSync('__get-web-contents-id')
const isClientOnly = !!process.env.CRAFT_SERVER_URL
const openClawHostControl = createOpenClawHostControlBridge({
  isClientOnly,
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
})

let client: TransportClient
let projectAuthority: ProjectAuthorityConnection | null = null

if (isClientOnly) {
  // ── Thin-client mode ───────────────────────────────────────────────────
  // Single WsRpcClient connected directly to the remote server.
  // No local server, no routing — all channels go to remote.

  const wsUrl = process.env.CRAFT_SERVER_URL!
  const wsToken = process.env.CRAFT_SERVER_TOKEN ?? ''

  // Block unencrypted ws:// to non-localhost servers — tokens would be sent in cleartext
  const parsed = new URL(wsUrl)
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1'
  if (parsed.protocol === 'ws:' && !isLocalhost) {
    throw new Error(
      `Refusing to connect to remote server over unencrypted ws://. ` +
      `Use wss:// (TLS) for non-localhost connections. ` +
      `Set CRAFT_RPC_TLS_CERT/KEY on the server to enable TLS.`
    )
  }

  // Workspace ID is optional — if missing, renderer shows a workspace picker
  const workspaceId = process.env.CRAFT_WORKSPACE_ID || ipcRenderer.sendSync('__get-workspace-id') || undefined

  const wsClient = new WsRpcClient(wsUrl, {
    token: wsToken,
    workspaceId,
    webContentsId,
    autoReconnect: true,
    mode: 'remote',
    clientCapabilities: [...LOCAL_CLIENT_CAPABILITIES],
    // Thin-client CRAFT_SERVER_URL is public-CA only (no enrolled SPKI pin).
    ...peerTrustOptionsForRemote({
      url: wsUrl,
      token: wsToken,
      remoteWorkspaceId: workspaceId ?? '',
      tlsTrust: { mode: 'public-ca' },
    }),
  })
  wsClient.connect()
  client = wsClient

} else {
  // ── Normal mode ────────────────────────────────────────────────────────
  // RoutedClient routes LOCAL_ONLY to local server, REMOTE_ELIGIBLE to
  // whichever server owns the workspace (local or remote).

  const wsPort: number = ipcRenderer.sendSync('__get-ws-port')
  const workspaceId: string = ipcRenderer.sendSync('__get-workspace-id')
  const localClientProof: string = ipcRenderer.sendSync('__get-local-client-proof')

  const localClient = new WsRpcClient(`ws://127.0.0.1:${wsPort}`, {
    workspaceId,
    webContentsId,
    localClientProof,
    resolveTarget: async () => ({
      url: `ws://127.0.0.1:${wsPort}`,
      token: await ipcRenderer.invoke('__resolve-local-ws-token', workspaceId),
    }),
    autoReconnect: true,
    mode: 'local',
    clientCapabilities: [...LOCAL_CLIENT_CAPABILITIES],
  })

  // Build a workspace client for a RemoteServerConfig. SSH-backed configs get a
  // `resolveTarget` hook that re-establishes the tunnel + a fresh url/token per connect.
  const makeRemoteClient = (rc: RemoteServerConfig): WsRpcClient =>
    new WsRpcClient(rc.url, {
      token: rc.token,
      workspaceId: rc.remoteWorkspaceId,
      webContentsId,
      autoReconnect: true,
      mode: 'remote',
      clientCapabilities: [...LOCAL_CLIENT_CAPABILITIES],
      ...peerTrustOptionsForRemote(rc),
      ...(isSshBacked(rc)
        ? {
            resolveTarget: async () => {
              const resolved = await ipcRenderer.invoke('ssh:resolveWorkspaceConnection', rc)
              return { url: resolved.url, token: resolved.token }
            },
          }
        : {}),
    })

  // Check if the current workspace is remote (synchronous IPC during preload eval)
  const remoteConfig: RemoteServerConfig | null = ipcRenderer.sendSync('__get-workspace-remote-config')

  let initialWorkspaceClient: WsRpcClient
  if (remoteConfig && typeof remoteConfig.url === 'string') {
    // Workspace is remote — create a connection (SSH-backed resolves a fresh port).
    initialWorkspaceClient = makeRemoteClient(remoteConfig)
    initialWorkspaceClient.connect()
  } else {
    // Workspace is local — workspace client IS the local client
    initialWorkspaceClient = localClient
  }

  const routedClient = new RoutedClient(localClient, initialWorkspaceClient)
  projectAuthority = new ProjectAuthorityConnection(async localWorkspaceId => {
    const value: ProjectAuthorityTarget | null = await ipcRenderer.invoke(PROJECT_AUTHORITY_IPC, localWorkspaceId)
    return value
  })
  routedClient.setProjectAuthority(projectAuthority, workspaceId)

  // Set workspace ID mapping if initial workspace is remote
  if (remoteConfig) {
    routedClient.setWorkspaceMapping(workspaceId, remoteConfig.remoteWorkspaceId)
  }

  // Factory for creating remote workspace clients on switch (SSH-backed configs
  // resolve a fresh forwarded port on connect via makeRemoteClient's hook).
  routedClient.setClientFactory((remoteServer: RemoteServerConfig) => makeRemoteClient(remoteServer))

  localClient.connect()
  client = routedClient
}

// ---------------------------------------------------------------------------
// Register client-side capability handlers (server can invoke these)
// ---------------------------------------------------------------------------

client.handleCapability(CLIENT_OPEN_EXTERNAL, (url: string) => shell.openExternal(url))

client.handleCapability(CLIENT_OPEN_PATH, async (path: string) => {
  const error = await shell.openPath(path)
  return { error: error || undefined }
})

client.handleCapability(CLIENT_SHOW_IN_FOLDER, (path: string) => {
  shell.showItemInFolder(path)
})

client.handleCapability(CLIENT_CONFIRM_DIALOG, async (spec: ConfirmDialogSpec) => {
  return await ipcRenderer.invoke('__dialog:showMessageBox', spec)
})

client.handleCapability(CLIENT_OPEN_FILE_DIALOG, async (spec: FileDialogSpec) => {
  return await ipcRenderer.invoke('__dialog:showOpenDialog', spec)
})

// Browser pane invocation. The remote server packages an IBrowserPaneManager
// method call as a BrowserCapabilityRequest; we dispatch it to the local
// `BrowserPaneManager` via the `__browser:invoke` IPC channel registered in
// `apps/electron/src/main/browser-pane-manager.ts:registerCapabilityIpc()`.
client.handleCapability(CLIENT_BROWSER_INVOKE, async (req: BrowserCapabilityRequest) => {
  return await ipcRenderer.invoke('__browser:invoke', req)
})

// ---------------------------------------------------------------------------
// Build ElectronAPI proxy
// ---------------------------------------------------------------------------

const api = buildClientApi(client, CHANNEL_MAP, (ch) => client.isChannelAvailable(ch))
const nativeReplicaBridge = createNativeReplicaBridge({ client, invokeIpc: (channel, input) => ipcRenderer.invoke(channel, input) })
;(api as ElectronAPI).nativeReplica = nativeReplicaBridge.nativeReplica
;(api as ElectronAPI).nativeData.readEntity = nativeReplicaBridge.readEntity
;(api as ElectronAPI).nativeData.mutate = nativeReplicaBridge.mutate
;(api as ElectronAPI).readNote = nativeReplicaBridge.readNote
;(api as ElectronAPI).createNote = nativeReplicaBridge.createNote
let projectAuthorityMutationGeneration = 0
// Every window discards private transport/cache state after a committed identity or configuration change.
ipcRenderer.on('__project-authority:configuration-changed', () => { ++projectAuthorityMutationGeneration; projectAuthority?.destroy() })
api.getProjectAuthorityState = async () => projectAuthority?.getState() ?? 'unconfigured'
api.onProjectAuthorityChanged = callback => projectAuthority?.subscribe(callback) ?? (() => {})
api.getProjectAuthorityConfiguration = async workspaceId => {
  if (!projectAuthority) return null
  const value: ProjectAuthorityConfiguration | null = await ipcRenderer.invoke(PROJECT_AUTHORITY_CONFIGURATION_IPC, workspaceId)
  return value
}
// Durable intent storage lives in main; renderer/preload retain no JWT or command queue.
api.getSharedProjectCreateIntent = async workspaceId => {
  if (!projectAuthority) return { state: 'none', eligible: false }
  const result: import('../shared/project-create-intent').ProjectCreateIntentView = await ipcRenderer.invoke('__project-create-intent', workspaceId, 'get')
  return result
}
api.queueSharedProjectCreate = async (workspaceId, body) => {
  if (!projectAuthority || projectAuthority.getState() === 'unconfigured') return { state: 'blocked', eligible: false, code: 'AUTH_FAILED' }
  const result: import('../shared/project-create-intent').ProjectCreateIntentView = await ipcRenderer.invoke('__project-create-intent', workspaceId, 'queue', body)
  return result
}
api.retrySharedProjectCreate = async workspaceId => {
  if (!projectAuthority || projectAuthority.getState() === 'unconfigured') return { state: 'blocked', eligible: false, code: 'AUTH_FAILED' }
  const result: import('../shared/project-create-intent').ProjectCreateAttempt = await ipcRenderer.invoke('__project-create-intent', workspaceId, 'retry')
  return result
}
api.cancelSharedProjectCreate = async workspaceId => {
  if (!projectAuthority) return { state: 'blocked', eligible: false, code: 'CAPABILITY_UNAVAILABLE' }
  const result: import('../shared/project-create-intent').ProjectCreateIntentView = await ipcRenderer.invoke('__project-create-intent', workspaceId, 'cancel')
  return result
}
api.getLicenseAuditIntent = async workspaceId => {
  if (!projectAuthority) return { state: 'none', eligible: false }
  const result: import('../shared/license-audit-intent').LicenseAuditIntentView = await ipcRenderer.invoke('__license-audit-intent', workspaceId, 'get')
  return result
}
api.queueLicenseAudit = async (workspaceId, body) => {
  if (!projectAuthority || projectAuthority.getState() === 'unconfigured') return { state: 'blocked', eligible: false, code: 'AUTH_FAILED' }
  const result: import('../shared/license-audit-intent').LicenseAuditIntentView = await ipcRenderer.invoke('__license-audit-intent', workspaceId, 'queue', body)
  return result
}
api.retryLicenseAudit = async workspaceId => {
  if (!projectAuthority || projectAuthority.getState() === 'unconfigured') return { state: 'blocked', eligible: false, code: 'AUTH_FAILED' }
  const result: import('../shared/license-audit-intent').LicenseAuditAttempt = await ipcRenderer.invoke('__license-audit-intent', workspaceId, 'retry')
  return result
}
api.cancelLicenseAudit = async workspaceId => {
  if (!projectAuthority) return { state: 'blocked', eligible: false, code: 'CAPABILITY_UNAVAILABLE' }
  const result: import('../shared/license-audit-intent').LicenseAuditIntentView = await ipcRenderer.invoke('__license-audit-intent', workspaceId, 'cancel')
  return result
}
api.connectProjectAuthority = async (workspaceId, input) => {
  if (!projectAuthority) return { ok: false, error: { code: 'CAPABILITY_UNAVAILABLE', status: 503 } }
  const generation = ++projectAuthorityMutationGeneration
  projectAuthority.destroy()
  const result: ProjectAuthorityMutationResult = await ipcRenderer.invoke(PROJECT_AUTHORITY_CONNECT_IPC, workspaceId, input)
  if (generation !== projectAuthorityMutationGeneration) return { ok: false, error: { code: 'WORKSPACE_MISMATCH', status: 403 } }
  if (result.ok) await projectAuthority.setWorkspace(workspaceId)
  if (generation !== projectAuthorityMutationGeneration) return { ok: false, error: { code: 'WORKSPACE_MISMATCH', status: 403 } }
  return result
}
api.disconnectProjectAuthority = async workspaceId => {
  if (!projectAuthority) return { ok: false, error: { code: 'CAPABILITY_UNAVAILABLE', status: 503 } }
  ++projectAuthorityMutationGeneration
  projectAuthority.destroy()
  const result: ProjectAuthorityMutationResult = await ipcRenderer.invoke(PROJECT_AUTHORITY_DISCONNECT_IPC, workspaceId)
  return result
}

let cancelPendingChatGptOAuth: (() => void) | null = null
let pendingChatGptOAuthState: string | undefined

;(api as any).getRuntimeEnvironment = (): 'electron' | 'web' => 'electron'

// ---------------------------------------------------------------------------
// Transport connection state logging (for remote connections)
// ---------------------------------------------------------------------------

function formatTransportReason(state: TransportConnectionState): string {
  const err = state.lastError
  if (err) {
    const codePart = err.code ? ` [${err.code}]` : ''
    return `${err.kind}${codePart}: ${err.message}`
  }

  if (state.lastClose?.code != null) {
    const reason = state.lastClose.reason ? ` (${state.lastClose.reason})` : ''
    return `close ${state.lastClose.code}${reason}`
  }

  return 'no additional details'
}

// Log remote connection state changes to main process (visible in terminal + main.log).
// Activates whenever the workspace connection is remote (thin client or remote workspace).
client.onConnectionStateChanged((state) => {
  if (state.mode !== 'remote') return

  const emitToMain = (level: 'info' | 'warn' | 'error', message: string) => {
    ipcRenderer.send('__transport:status', {
      level,
      message,
      status: state.status,
      attempt: state.attempt,
      nextRetryInMs: state.nextRetryInMs,
      error: state.lastError,
      close: state.lastClose,
      url: state.url,
    })
  }

  if (state.status === 'connected') {
    const message = `[transport] connected to ${state.url}`
    console.info(message)
    emitToMain('info', message)
    return
  }

  if (state.status === 'reconnecting') {
    const retry = state.nextRetryInMs != null ? ` retry in ${state.nextRetryInMs}ms` : ''
    const message = `[transport] reconnecting (attempt ${state.attempt})${retry} — ${formatTransportReason(state)}`
    console.warn(message)
    emitToMain('warn', message)
    return
  }

  if (state.status === 'failed' || state.status === 'disconnected') {
    const message = `[transport] ${state.status} — ${formatTransportReason(state)}`
    console.error(message)
    emitToMain('error', message)
  }
})

// ---------------------------------------------------------------------------
// Transport state API (exposed to renderer)
// ---------------------------------------------------------------------------

;(api as any).getTransportConnectionState = async () => client.getConnectionState()
;(api as any).onTransportConnectionStateChanged = (callback: (state: TransportConnectionState) => void) => {
  return client.onConnectionStateChanged(callback)
}
;(api as any).reconnectTransport = async () => {
  client.reconnectNow()
}

// ── performOAuth ─────────────────────────────────────────────────────────
// Multi-step orchestration: callback server (local) → oauth:start (server) →
// open browser → wait for callback → oauth:complete (server).
// Runs client-side because the callback server must receive the redirect.
;(api as any).performOAuth = async (args: {
  sourceSlug: string
  sessionId?: string
  authRequestId?: string
}): Promise<{ success: boolean; error?: string; email?: string }> => {
  let callbackServer: Awaited<ReturnType<typeof createCallbackServer>> | null = null
  let flowId: string | undefined
  let state: string | undefined

  try {
    // 1. Start local callback server to receive OAuth redirect
    callbackServer = await createCallbackServer({ appType: 'electron' })
    const callbackUrl = `${callbackServer.url}/callback`

    // 2. Ask server to prepare the flow (PKCE, auth URL, store in flow store)
    const startResult = await client.invoke('oauth:start', {
      sourceSlug: args.sourceSlug,
      callbackUrl,
      sessionId: args.sessionId,
      authRequestId: args.authRequestId,
    })
    flowId = startResult.flowId
    state = startResult.state

    // 3. Open browser for user consent (local — must open on the user's machine, not remote server)
    await shell.openExternal(startResult.authUrl)

    // 4. Wait for OAuth provider to redirect to our callback server
    const callback = await callbackServer.promise

    // 5. Check for errors from the provider
    if (callback.query.error) {
      const error = callback.query.error_description || callback.query.error
      await client.invoke('oauth:cancel', { flowId, state })
      return { success: false, error }
    }

    const code = callback.query.code
    if (!code) {
      await client.invoke('oauth:cancel', { flowId, state })
      return { success: false, error: 'No authorization code received' }
    }

    // 6. Send code to server for token exchange + credential storage
    const result = await client.invoke('oauth:complete', { flowId, code, state })
    return { success: result.success, error: result.error, email: result.email }
  } catch (err) {
    // Clean up server-side flow on error
    if (flowId && state) {
      client.invoke('oauth:cancel', { flowId, state }).catch(() => {})
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'OAuth flow failed',
    }
  } finally {
    callbackServer?.close()
  }
}

// ── startClaudeOAuth ─────────────────────────────────────────────────────
// Override the channel-map stub: the server now returns authUrl without opening
// the browser. We open it locally so it works in remote mode.
// Claude OAuth is two-step: browser opens → user copies code → pastes in UI.
;(api as any).startClaudeOAuth = async (): Promise<{
  success: boolean
  authUrl?: string
  error?: string
}> => {
  try {
    const result = await client.invoke('onboarding:startClaudeOAuth')
    if (result.success && result.authUrl) {
      await shell.openExternal(result.authUrl)
    }
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Claude OAuth failed',
    }
  }
}

// ── performChatGptOAuth ──────────────────────────────────────────────────
// Same shape as performOAuth: callback server (port 1455) → chatgpt:startOAuth →
// browser → callback → chatgpt:completeOAuth.
// Overrides the startChatGptOAuth API method so the renderer call is unchanged.
;(api as any).startChatGptOAuth = async (
  connectionSlug: string,
): Promise<{ success: boolean; error?: string }> => {
  let callbackServer: Awaited<ReturnType<typeof createCallbackServer>> | null = null
  const abortController = new AbortController()
  let flowId: string | undefined
  let state: string | undefined

  try {
    cancelPendingChatGptOAuth = () => {
      abortController.abort()
    }

    // 1. Start callback server on ChatGPT's fixed port with /auth/callback path
    callbackServer = await createCallbackServer({
      appType: 'electron',
      port: CHATGPT_OAUTH_CONFIG.CALLBACK_PORT,
      callbackPaths: ['/auth/callback'],
    })

    // 2. Ask server to prepare the flow (PKCE, auth URL, store pending flow)
    const startResult = await client.invoke('chatgpt:startOAuth', connectionSlug)
    flowId = startResult.flowId
    state = startResult.state
    pendingChatGptOAuthState = state

    if (abortController.signal.aborted) {
      await client.invoke('chatgpt:cancelOAuth', { state })
      throw new Error('ChatGPT authentication cancelled')
    }

    // 3. Open browser for user consent
    await shell.openExternal(startResult.authUrl)

    // 4. Wait for OpenAI to redirect to our callback server
    const callback = await waitForOAuthCallback(callbackServer.promise, {
      timeoutMs: CHATGPT_OAUTH_CONFIG.FLOW_TIMEOUT_MS,
      signal: abortController.signal,
      timeoutMessage: 'ChatGPT authentication timed out. Please try again.',
      cancelMessage: 'ChatGPT authentication cancelled',
    })

    // 5. Check for errors from the provider
    if (callback.query.error) {
      const error = callback.query.error_description || callback.query.error
      await client.invoke('chatgpt:cancelOAuth', { state })
      return { success: false, error }
    }

    const code = callback.query.code
    if (!code) {
      await client.invoke('chatgpt:cancelOAuth', { state })
      return { success: false, error: 'No authorization code received' }
    }

    // 6. Send code to server for token exchange + credential storage
    const result = await client.invoke('chatgpt:completeOAuth', { flowId, code, state })
    return { success: result.success, error: result.error }
  } catch (err) {
    if (state) {
      client.invoke('chatgpt:cancelOAuth', { state }).catch(() => {})
    }
    if (isOAuthFlowCancelledError(err) || (err instanceof Error && err.message === 'ChatGPT authentication cancelled')) {
      return { success: false, error: 'ChatGPT authentication cancelled' }
    }
    if (err instanceof OAuthFlowTimedOutError) {
      return { success: false, error: err.message }
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'ChatGPT OAuth flow failed',
    }
  } finally {
    cancelPendingChatGptOAuth = null
    pendingChatGptOAuthState = undefined
    callbackServer?.close()
  }
}

;(api as any).cancelChatGptOAuth = async (): Promise<{ success: boolean }> => {
  cancelPendingChatGptOAuth?.()

  if (pendingChatGptOAuthState) {
    return client.invoke('chatgpt:cancelOAuth', { state: pendingChatGptOAuthState })
  }

  return { success: true }
}

// App lifecycle — direct IPC (not WS RPC) since it restarts the server itself
;(api as ElectronAPI).relaunchApp = () => ipcRenderer.invoke('app:relaunch')
;(api as ElectronAPI).removeWorkspace = (workspaceId: string) => ipcRenderer.invoke('workspace:remove', workspaceId)
;(api as ElectronAPI).invokeOnServer = (url: string, token: string, channel: string, ...args: any[]) =>
  ipcRenderer.invoke('server:invokeOnServer', url, token, channel, ...args)
;(api as ElectronAPI).transferSessionToWorkspace = (sessionId: string, targetWorkspaceId: string, sessionIndex?: number, sessionCount?: number) =>
  ipcRenderer.invoke('session:transferToWorkspace', sessionId, targetWorkspaceId, sessionIndex, sessionCount)
;(api as ElectronAPI).onTransferProgress = (cb: (progress: { sessionIndex: number; sessionCount: number; chunkSent: number; chunkTotal: number }) => void) => {
  const handler = (_e: any, progress: { sessionIndex: number; sessionCount: number; chunkSent: number; chunkTotal: number }) => cb(progress)
  ipcRenderer.on('transfer:progress', handler)
  return () => { ipcRenderer.removeListener('transfer:progress', handler) }
}

// SSH remote hosts + tunnels — direct IPC (Electron-only, not WS RPC)
;(api as ElectronAPI).sshListHosts = () => ipcRenderer.invoke('ssh:listHosts')
;(api as ElectronAPI).sshAddHost = (input) => ipcRenderer.invoke('ssh:addHost', input)
;(api as ElectronAPI).sshUpdateHost = (id: string, updates) =>
  ipcRenderer.invoke('ssh:updateHost', id, updates)
;(api as ElectronAPI).sshDeleteHost = (id: string) => ipcRenderer.invoke('ssh:deleteHost', id)
;(api as ElectronAPI).sshImportFromConfig = () => ipcRenderer.invoke('ssh:importFromConfig')
;(api as ElectronAPI).sshConnect = (hostId: string) => ipcRenderer.invoke('ssh:connect', hostId)
;(api as ElectronAPI).sshBootstrapConnect = (hostId: string) =>
  ipcRenderer.invoke('ssh:bootstrapConnect', hostId)
;(api as ElectronAPI).sshResolveWorkspaceConnection = (remoteServer) =>
  ipcRenderer.invoke('ssh:resolveWorkspaceConnection', remoteServer)
;(api as ElectronAPI).onSshBootstrapProgress = (cb) => {
  const handler = (_e: unknown, progress: SshBootstrapProgress) => cb(progress)
  ipcRenderer.on('ssh:bootstrapProgress', handler)
  return () => { ipcRenderer.removeListener('ssh:bootstrapProgress', handler) }
}
;(api as ElectronAPI).onSshConnectionStatus = (cb) => {
  const handler = (_e: unknown, status: SshConnectionStatus) => cb(status)
  ipcRenderer.on('ssh:connectionStatus', handler)
  return () => { ipcRenderer.removeListener('ssh:connectionStatus', handler) }
}

// Omnibox open from main when ⌘K hits embedded BrowserView page webContents
;(api as ElectronAPI).onOmniboxOpen = (cb) => {
  const handler = () => cb()
  ipcRenderer.on('omnibox:open', handler)
  return () => { ipcRenderer.removeListener('omnibox:open', handler) }
}

// System warnings — expose env-based flags set during main process startup
// (preload-only: reads env var directly, no IPC round-trip needed)
;(api as ElectronAPI).getSystemWarnings = async () => ({
  vcredistMissing: process.env.CRAFT_VCREDIST_MISSING === '1',
  downloadUrl: process.env.CRAFT_VCREDIST_URL,
})
;(api as ElectronAPI).exitMiniWindow = () => ipcRenderer.invoke('window:exit-mini')
;(api as ElectronAPI).onPanelFocusDirection = (callback) => {
  const handler = (_event: unknown, direction: unknown) => {
    if (direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down') callback(direction)
  }
  ipcRenderer.on('window:panel-focus-direction', handler)
  return () => ipcRenderer.removeListener('window:panel-focus-direction', handler)
}

// i18n: sync language changes to main process (for native menus/dialogs)
;(api as ElectronAPI).changeLanguage = (lang: string) => ipcRenderer.invoke('i18n:changeLanguage', lang)

;(api as ElectronAPI).remoteTlsInspect = (url: string) =>
  ipcRenderer.invoke('remoteTls:inspect', url)
;(api as ElectronAPI).remoteTlsDecide = (payload) =>
  ipcRenderer.invoke('remoteTls:decide', payload)

// Notes PDF export — direct ipcMain.handle (needs BrowserWindow.printToPDF, not WS RPC)
;(api as ElectronAPI).exportNotePdf = (opts: { html: string; defaultPath: string }) =>
  ipcRenderer.invoke('notes:exportPdf', opts)
;(api as ElectronAPI).saveTextFile = (opts: {
  content: string
  defaultPath: string
  filters?: Array<{ name: string; extensions: string[] }>
}) => ipcRenderer.invoke('file:saveText', opts)

// Local meeting recordings — direct IPC: microphone audio, files and the
// whisper.cpp transcriber are device-local (see main/meetings/local-ipc.ts).
{
  const M = MEETINGS_LOCAL_IPC
  const meetingsLocal: MeetingsLocalApi = {
    list: (workspaceId) => ipcRenderer.invoke(M.LIST, workspaceId),
    get: (id) => ipcRenderer.invoke(M.GET, id),
    create: (input) => ipcRenderer.invoke(M.CREATE, input),
    update: (id, patch) => ipcRenderer.invoke(M.UPDATE, id, patch),
    trash: (id) => ipcRenderer.invoke(M.TRASH, id),
    recStart: (input) => ipcRenderer.invoke(M.REC_START, input),
    recChunk: (id, chunk) => ipcRenderer.invoke(M.REC_CHUNK, id, chunk),
    recState: (id, state) => ipcRenderer.invoke(M.REC_STATE, id, state),
    recStop: (id, input) => ipcRenderer.invoke(M.REC_STOP, id, input),
    recover: () => ipcRenderer.invoke(M.RECOVER),
    importAudio: (input) => ipcRenderer.invoke(M.IMPORT_AUDIO, input),
    cancelImport: (requestId) => ipcRenderer.invoke(M.IMPORT_CANCEL, requestId),
    readAudio: (id) => ipcRenderer.invoke(M.READ_AUDIO, id),
    readTranscript: (id) => ipcRenderer.invoke(M.READ_TRANSCRIPT, id),
    readTranscriptRevision: (id, revision) => ipcRenderer.invoke(M.READ_TRANSCRIPT_REVISION, id, revision),
    restoreTranscriptRevision: (id, input) => ipcRenderer.invoke(M.RESTORE_TRANSCRIPT_REVISION, id, input),
    transcribe: (id) => ipcRenderer.invoke(M.TRANSCRIBE, id),
    cancelTranscription: (id) => ipcRenderer.invoke(M.TRANSCRIBE_CANCEL, id),
    updateTranscriptSegment: (id, input) => ipcRenderer.invoke(M.TRANSCRIPT_SEGMENT_UPDATE, id, input),
    engine: () => ipcRenderer.invoke(M.ENGINE),
    micAccess: (ask) => ipcRenderer.invoke(M.MIC_ACCESS, ask),
    attach: (id, paths) => ipcRenderer.invoke(M.ATTACH, id, paths),
    openDocument: (id, docId) => ipcRenderer.invoke(M.OPEN_DOC, id, docId),
    reveal: (id, docId) => ipcRenderer.invoke(M.REVEAL, id, docId),
    removeDocument: (id, docId) => ipcRenderer.invoke(M.REMOVE_DOC, id, docId),
    onChanged: (cb) => {
      const handler = (_e: unknown, event: { id: string }) => cb(event)
      ipcRenderer.on(M.CHANGED, handler)
      return () => { ipcRenderer.removeListener(M.CHANGED, handler) }
    },
  }
  ;(api as ElectronAPI).meetingsLocal = meetingsLocal
}

// Rox Mail — direct IPC: the mailbox credential and JMAP connection live in
// the main process (see main/mail/local-ipc.ts).
{
  const C = MAIL_IPC
  const mailLocal: MailLocalApi = {
    status: () => ipcRenderer.invoke(C.STATUS),
    ensureMailbox: () => ipcRenderer.invoke(C.ENSURE),
    setServer: (url) => ipcRenderer.invoke(C.SET_SERVER, url),
    folders: () => ipcRenderer.invoke(C.FOLDERS),
    list: (query) => ipcRenderer.invoke(C.LIST, query),
    get: (id) => ipcRenderer.invoke(C.GET, id),
    getThread: (threadId) => ipcRenderer.invoke(C.GET_THREAD, threadId),
    setFlags: (ids, flags) => ipcRenderer.invoke(C.SET_FLAGS, ids, flags),
    move: (ids, target) => ipcRenderer.invoke(C.MOVE, ids, target),
    remove: (ids) => ipcRenderer.invoke(C.REMOVE, ids),
    send: (input) => ipcRenderer.invoke(C.SEND, input),
    saveDraft: (input) => ipcRenderer.invoke(C.SAVE_DRAFT, input),
    pickFiles: () => ipcRenderer.invoke(C.PICK_FILES),
    saveAttachment: (emailId, attachment) => ipcRenderer.invoke(C.SAVE_ATTACHMENT, emailId, attachment),
    reveal: (path) => ipcRenderer.invoke(C.REVEAL, path),
    onChanged: (cb) => {
      const handler = (_e: unknown, event: { at: number; status?: Parameters<Parameters<MailLocalApi['onChanged']>[0]>[0]['status'] }) => cb(event)
      ipcRenderer.on(C.CHANGED, handler)
      return () => { ipcRenderer.removeListener(C.CHANGED, handler) }
    },
  }
  ;(api as ElectronAPI).mailLocal = mailLocal
}

// webUtils.getPathForFile: returns the absolute OS path of a File object obtained
// from <input type="file"> or OS drag-drop. Returns null for Files fabricated from
// Blobs (clipboard paste, web-drag) — those are content-only, no filesystem path.
;(api as ElectronAPI).getFilePath = (file: File) => {
  try {
    return webUtils.getPathForFile(file) || null
  } catch {
    return null
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
if (openClawHostControl) {
  contextBridge.exposeInMainWorld('openClawHostControl', openClawHostControl)
}
