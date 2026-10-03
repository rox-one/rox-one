import type { ElectronAPI } from '../../shared/types'

/** Transport scope, not a desktop identity or native authority. */
export interface AuthenticatedWebTransportBootstrap {
  readonly kind: 'authenticated-web-transport'
  readonly workspaceId: string
}

export async function validateAuthenticatedWebBootstrap(
  api: Pick<ElectronAPI, 'getRuntimeEnvironment' | 'getWindowWorkspace'>,
  bootstrap: AuthenticatedWebTransportBootstrap,
): Promise<string> {
  if (api.getRuntimeEnvironment() !== 'web') {
    throw new Error('Authenticated web bootstrap requires a browser runtime')
  }
  if (bootstrap.kind !== 'authenticated-web-transport'
    || typeof bootstrap.workspaceId !== 'string'
    || !bootstrap.workspaceId
    || bootstrap.workspaceId.trim() !== bootstrap.workspaceId) {
    throw new Error('Authenticated web bootstrap has no valid workspace')
  }
  if (await api.getWindowWorkspace() !== bootstrap.workspaceId) {
    throw new Error('Authenticated web workspace binding changed')
  }
  return bootstrap.workspaceId
}

/** Finish the web startup callbacks without loading a host session inventory. */
export async function initializeAuthenticatedWebRenderer(
  api: Pick<ElectronAPI, 'getRuntimeEnvironment' | 'getWindowWorkspace'>,
  bootstrap: AuthenticatedWebTransportBootstrap,
  callbacks: {
    isCancelled(): boolean
    markHostSessionsUnavailable(): void
    onWorkspaceReady(workspaceId: string): void
  },
): Promise<void> {
  const workspaceId = await validateAuthenticatedWebBootstrap(api, bootstrap)
  if (callbacks.isCancelled()) return
  callbacks.markHostSessionsUnavailable()
  callbacks.onWorkspaceReady(workspaceId)
}
