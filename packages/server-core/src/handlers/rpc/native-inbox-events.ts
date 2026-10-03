import type { NativeAuthority, NativePrincipal } from '../../authority/native-authority'
import { readNativeWorkspaceRegistry } from './native-workspace-registry'

/** Queue events carry only a scoped invalidation, never shared-host entries. */
export function projectNativeInboxChanged(authority: NativeAuthority, args: readonly unknown[], workspaceId: string, principal: NativePrincipal): readonly unknown[] | null {
  const workspace = readNativeWorkspaceRegistry(workspaceId)
  return args[0] === workspaceId && workspace && authority.authorize(principal, workspaceId, 'read', workspace.rootPath) ? [workspaceId] : null
}
