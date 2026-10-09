/**
 * SEC-03 — shared client-workspace scope guard.
 *
 * A request may name a workspace in its arguments. The scope it must match is
 * the workspace the server bound to the authenticated client, regardless of
 * which identity kind authenticated it: a NativePrincipal (native/local RPC),
 * a verified shared-workspace Actor (`access: 'authenticatedWorkspace'`), or a
 * cookie-authenticated web UI session. The historical per-handler checks only
 * fired when `ctx.principal` was present, so an actor- or web-authenticated
 * client naming a foreign workspace slipped through — a latent mine, not a live
 * hole (those handlers are not currently reachable by those clients).
 *
 * The guard runs AFTER the requested workspace is resolved so an unknown id
 * still answers `Workspace not found` instead of a scoping error.
 */
import { CodedError } from '@rox/shared/protocol'
import type { RequestContext } from '../../transport/types.ts'

/**
 * Which identity kinds the guard covers. `any` covers every server-verified
 * identity (principal, actor, web UI session); `principal` restricts it to a
 * NativePrincipal and is the explicit cross-workspace-read exception used by
 * `entities:resolve`, which legitimately serves several workspaces for
 * actor-authenticated clients while still refusing native principals.
 */
export type WorkspaceScopeIdentity = 'any' | 'principal'

/**
 * Reject a request whose argument workspace differs from the workspace bound to
 * the authenticated client. A local client with no bound identity is a no-op.
 */
export function assertWorkspaceScope(
  ctx: RequestContext,
  workspaceId: string,
  message = 'Workspace access denied',
  identities: WorkspaceScopeIdentity = 'any',
): void {
  const bound = identities === 'principal'
    ? Boolean(ctx.principal)
    : Boolean(ctx.principal || ctx.actor || ctx.webUiAuthenticated)
  if (bound && workspaceId !== ctx.workspaceId) throw new CodedError('FORBIDDEN', message)
}