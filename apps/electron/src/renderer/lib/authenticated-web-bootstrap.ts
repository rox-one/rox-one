import type { ElectronAPI, Workspace } from '../../shared/types'

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

/** Display metadata for the bound web scope, never a host roster or authority. */
export async function loadAuthenticatedWebWorkspaceMetadata(
  api: Pick<ElectronAPI, 'getRuntimeEnvironment' | 'getWindowWorkspace' | 'getWorkspaces'>,
  bootstrap: AuthenticatedWebTransportBootstrap,
): Promise<Workspace[]> {
  const workspaceId = await validateAuthenticatedWebBootstrap(api, bootstrap)
  const rows: unknown = await api.getWorkspaces()
  if (api.getRuntimeEnvironment() !== 'web' || await api.getWindowWorkspace() !== workspaceId) {
    throw new Error('Authenticated web workspace binding changed while reading metadata')
  }
  if (!Array.isArray(rows)) throw new Error('Authenticated web workspace metadata is unavailable')
  const matching = rows.filter((row): row is { id: string; name: string } => Boolean(
    row && typeof row === 'object' && row.id === workspaceId
      && typeof row.name === 'string' && row.name.trim().length > 0,
  ))
  if (matching.length > 1) throw new Error('Authenticated web workspace metadata is ambiguous')
  const workspace = matching[0]
  return workspace ? [{ id: workspaceId, name: workspace.name, slug: workspaceId, rootPath: '', createdAt: 0 }] : []
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
