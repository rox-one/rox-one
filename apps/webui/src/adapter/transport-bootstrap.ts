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
  createAdapter(options: { serverUrl: string; workspaceId: string }): { api: ElectronAPI; client: Client }
}): Promise<{ api: ElectronAPI; client: Client; bootstrap: AuthenticatedWebTransportBootstrap }> {
  const { signal } = options
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
  const workspaceId = resolveDefaultWorkspace(await readConfig('/api/config/workspaces'), options.requestedWorkspace)
  assertActive(signal)
  const { api, client } = options.createAdapter({ serverUrl: wsUrl, workspaceId })
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
