import type { ElectronAPI } from '../../../electron/src/shared/types'
import type { TransportConnectionState } from '../../../electron/src/transport/client'
import { validateAuthenticatedWebBootstrap, type AuthenticatedWebTransportBootstrap } from '../../../electron/src/renderer/lib/authenticated-web-bootstrap'

interface BootstrapClient {
  getAcknowledgedWorkspaceId(): string | null
  getConnectionState(): TransportConnectionState
  onConnectionStateChanged(listener: (state: TransportConnectionState) => void): () => void
  connect(): void
  destroy(): void
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('WebUI connection cancelled')
}

interface HandoffFragmentSource {
  hash: string
  pathname: string
  search: string
}

const HANDOFF_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/

/**
 * Extract a pairing handoff token from a URL fragment. The fragment never
 * reaches the server, so the token cannot appear in request URLs or access
 * logs; any other fragment shape (e.g. `#some-anchor`) yields null.
 */
export function readHandoffToken(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const token = raw.startsWith('handoff=') ? raw.slice('handoff='.length) : raw
  return HANDOFF_TOKEN_RE.test(token) ? token : null
}

/**
 * Redeem a handoff token via `GET /handoff`, sending it in a request header so
 * it is never part of the URL. The server sets the session cookie on success.
 */
export async function redeemHandoffToken(options: {
  fetch: typeof fetch
  token: string
  signal: AbortSignal
}): Promise<void> {
  const response = await options.fetch('/handoff', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { 'X-Handoff-Token': options.token },
    signal: options.signal,
  })
  if (!response.ok) {
    const message = response.status === 401
      ? 'Pairing handoff token was rejected or expired'
      : `Pairing handoff failed (${response.status})`
    throw Object.assign(new Error(message), { status: response.status })
  }
}

/**
 * Redeem a `#handoff=<token>` / `#<token>` fragment if present, then strip it
 * from the address bar and history so the one-time secret is not left behind.
 * Returns false without touching the network when no token is present.
 */
export async function redeemHandoffFragment(options: {
  fetch: typeof fetch
  signal: AbortSignal
  location?: HandoffFragmentSource
  replaceUrl?: (url: string) => void
}): Promise<boolean> {
  const source = options.location ?? (typeof globalThis.location !== 'undefined' ? globalThis.location : undefined)
  const token = source ? readHandoffToken(source.hash) : null
  if (!source || !token) return false
  assertActive(options.signal)
  await redeemHandoffToken({ fetch: options.fetch, token, signal: options.signal })
  assertActive(options.signal)
  const replace = options.replaceUrl ?? defaultReplaceUrl()
  replace?.(source.pathname + source.search)
  return true
}

function defaultReplaceUrl(): ((url: string) => void) | undefined {
  if (typeof globalThis.history === 'undefined') return undefined
  return (url: string) => globalThis.history.replaceState(null, '', url)
}

export function resolveDefaultWorkspace(config: unknown, requestedWorkspace: string | null): string {
  const workspaceId = config && typeof config === 'object'
    ? (config as { defaultWorkspaceId?: unknown }).defaultWorkspaceId : undefined
  if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.trim() !== workspaceId) {
    throw new Error('Server has no configured default workspace; configure it using the desktop or host tools')
  }
  if (requestedWorkspace !== null && requestedWorkspace !== workspaceId) {
    throw new Error('Requested workspace does not match the server default workspace')
  }
  return workspaceId
}

export function waitForWorkspaceAck(
  client: BootstrapClient,
  workspaceId: string,
  signal: AbortSignal,
  timeoutMs = 12_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', cancelled)
      unsubscribe?.()
      error ? reject(error) : resolve()
    }
    const cancelled = () => finish(new Error('WebUI connection cancelled'))
    const timer = setTimeout(() => finish(new Error('Timed out waiting for the authenticated WebSocket handshake')), timeoutMs)
    signal.addEventListener('abort', cancelled, { once: true })
    if (signal.aborted) { cancelled(); return }
    unsubscribe = client.onConnectionStateChanged(state => {
      if (state.status === 'connected') {
        finish(client.getAcknowledgedWorkspaceId() === workspaceId
          ? undefined : new Error('Server acknowledged workspace does not match the configured workspace'))
      } else if (state.status === 'failed' || state.status === 'disconnected') {
        finish(new Error(state.lastError?.message ?? 'WebSocket handshake refused'))
      }
    })
    // The subscription immediately publishes its current state.
    if (settled) unsubscribe()
  })
}

export async function initializeAuthenticatedWebTransport<Client extends BootstrapClient>(options: {
  fetch: typeof fetch
  requestedWorkspace: string | null
  signal: AbortSignal
  location?: HandoffFragmentSource
  replaceUrl?: (url: string) => void
  createAdapter(options: { serverUrl: string; workspaceId: string; workspaceName?: string }): { api: ElectronAPI; client: Client }
}): Promise<{ api: ElectronAPI; client: Client; bootstrap: AuthenticatedWebTransportBootstrap }> {
  const { signal } = options
  // A pairing link (`/handoff#<token>`) must be redeemed before any
  // cookie-authenticated request, so the session cookie exists for /api/config.
  // When no fragment token is present this stays synchronous — the first config
  // fetch begins in the same tick.
  const handoffLocation = options.location ?? (typeof globalThis.location !== 'undefined' ? globalThis.location : undefined)
  if (handoffLocation && readHandoffToken(handoffLocation.hash)) {
    await redeemHandoffFragment({ fetch: options.fetch, signal, location: handoffLocation, replaceUrl: options.replaceUrl })
  }
  const readConfig = async (url: string) => {
    assertActive(signal)
    const response = await options.fetch(url, { credentials: 'same-origin', signal })
    assertActive(signal)
    if (!response.ok) throw Object.assign(new Error(`Failed to fetch server config: ${response.status}`), { status: response.status })
    const config: unknown = await response.json()
    assertActive(signal)
    return config
  }
  const config = await readConfig('/api/config')
  const wsUrl = config && typeof config === 'object' ? (config as { wsUrl?: unknown }).wsUrl : undefined
  if (typeof wsUrl !== 'string' || !/^wss?:\/\//.test(wsUrl)) throw new Error('Server did not return a valid WebSocket URL')
  const workspaceConfig = await readConfig('/api/config/workspaces')
  const workspaceId = resolveDefaultWorkspace(workspaceConfig, options.requestedWorkspace)
  const summary = workspaceConfig && typeof workspaceConfig === 'object'
    ? (workspaceConfig as { workspace?: { id?: unknown; name?: unknown } }).workspace : undefined
  const workspaceName = summary?.id === workspaceId && typeof summary.name === 'string' ? summary.name : undefined
  assertActive(signal)
  const { api, client } = options.createAdapter({ serverUrl: wsUrl, workspaceId, workspaceName })
  try {
    client.connect()
    await waitForWorkspaceAck(client, workspaceId, signal)
    assertActive(signal)
    const bootstrap: AuthenticatedWebTransportBootstrap = { kind: 'authenticated-web-transport', workspaceId }
    await validateAuthenticatedWebBootstrap(api, bootstrap)
    assertActive(signal)
    return { api, client, bootstrap }
  } catch (error) {
    client.destroy()
    throw error
  }
}
