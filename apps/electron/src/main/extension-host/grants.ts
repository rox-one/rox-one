/**
 * Extension grant resolution (sole authority for load-time grants).
 *
 * grants = workspace permissions.json `extensions[id].granted` minus `revoked`.
 * Renderer input is never consulted. Extracted to a leaf module so both the
 * RPC handler and the startup activation path can share it without a cycle;
 * `handlers/extension-host.ts` re-exports it for existing callers.
 */

import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { loadRawWorkspacePermissions } from '@rox/shared/agent'

/**
 * Resolve effective extension grants from workspace permissions.json.
 * grants = entry.granted filtered by not-in entry.revoked.
 * Missing workspace / missing entry → [].
 */
export function resolveExtensionGrantsFromPermissions(
  workspaceId: string | null | undefined,
  extensionId: string,
): string[] {
  const id = typeof extensionId === 'string' ? extensionId.trim() : ''
  if (!id) return []
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) return []
  try {
    const workspace = getWorkspaceByNameOrId(workspaceId.trim())
    if (!workspace?.rootPath) return []
    const raw = loadRawWorkspacePermissions(workspace.rootPath)
    const entry = raw?.extensions?.[id]
    if (!entry) return []
    const revoked = new Set(entry.revoked ?? [])
    return (entry.granted ?? []).filter((g) => typeof g === 'string' && !revoked.has(g))
  } catch {
    return []
  }
}