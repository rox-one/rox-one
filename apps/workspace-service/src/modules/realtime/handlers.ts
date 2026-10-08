/**
 * W1-03 (#1500) — `realtime:subscribe` / `realtime:unsubscribe` on the
 * authenticated workspace WS. Same workspace/actor checks as the domain RPC.
 */

import type { WsRpcServer } from '../../../../../packages/server-core/src/transport/server.ts'
import type { RequestContext } from '../../../../../packages/server-core/src/transport/index.ts'
import { REALTIME_RPC } from '../../../../../packages/core/src/events/index.ts'
import { IdentityDomainError } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import type { RealtimeGateway } from './gateway.ts'

export function registerRealtimeHandlers(server: Pick<WsRpcServer, 'handle'>, gateway: RealtimeGateway): void {
  const context = (ctx: RequestContext, args: unknown[]) => {
    if (args.length !== 2) throw new IdentityDomainError('INVALID_PAYLOAD')
    const workspaceId = requireUuid(args[0])
    if (ctx.workspaceId !== workspaceId) throw new IdentityDomainError('WORKSPACE_MISMATCH')
    const actor = requireActor(ctx.actor, workspaceId)
    return { clientId: ctx.clientId, workspaceId, principalId: actor.principalId }
  }
  server.handle(REALTIME_RPC.SUBSCRIBE, async (ctx: RequestContext, ...args: unknown[]) =>
    gateway.subscribe(context(ctx, args), args[1]), { access: 'authenticatedWorkspace' })
  server.handle(REALTIME_RPC.UNSUBSCRIBE, async (ctx: RequestContext, ...args: unknown[]) =>
    gateway.unsubscribe(context(ctx, args), args[1]), { access: 'authenticatedWorkspace' })
}
