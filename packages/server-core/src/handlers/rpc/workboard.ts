import { RPC_CHANNELS } from '@rox/shared/protocol'
import { pushTyped, type RpcServer, type RequestContext } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { WorkboardService } from '../../workboard/service.ts'
import { workspaceWorkContext } from './workspace-work.ts'

export const WORKBOARD_HANDLED_CHANNELS = [RPC_CHANNELS.workboard.READ, RPC_CHANNELS.workboard.MOVE] as const

interface WorkboardReadRequest { workspaceId?: string | null; sinceRevision?: number }
interface WorkboardMoveRequest {
  workspaceId?: string | null
  expectedRevision: number
  taskId: string
  column: string
  rank?: string
}

/** The request workspace is explicit, else the transport/window-bound one. */
function resolveWorkspaceId(ctx: RequestContext, args: { workspaceId?: string | null } | undefined, deps: HandlerDeps): string {
  const bound = ctx.workspaceId ?? (ctx.webContentsId === null ? undefined : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId))
  return args?.workspaceId ?? bound ?? ''
}

/** Reuses the workspace-work actor seam verbatim; the board only adds its projection. */
export function workboardContext(ctx: RequestContext, workspaceId: string, deps: HandlerDeps, server?: RpcServer) {
  const { service, actor } = workspaceWorkContext(ctx, workspaceId, deps, server)
  return { actor, board: new WorkboardService(service.store) }
}

export function registerWorkboardHandlers(server: RpcServer, deps: HandlerDeps): void {
  const changed = (workspaceId: string, revision: number) =>
    pushTyped(server, RPC_CHANNELS.workboard.CHANGED, { to: 'workspace', workspaceId }, { revision })
  server.handle(RPC_CHANNELS.workboard.READ, (ctx, args?: WorkboardReadRequest) => {
    const workspaceId = resolveWorkspaceId(ctx, args, deps)
    const { board, actor } = workboardContext(ctx, workspaceId, deps, server)
    return board.readBoard(actor, { sinceRevision: args?.sinceRevision })
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })
  server.handle(RPC_CHANNELS.workboard.MOVE, (ctx, args: WorkboardMoveRequest) => {
    const workspaceId = resolveWorkspaceId(ctx, args, deps)
    const { board, actor } = workboardContext(ctx, workspaceId, deps, server)
    const result = board.move(actor, { expectedRevision: args.expectedRevision, taskId: args.taskId, column: args.column, rank: args.rank })
    changed(workspaceId, result.revision)
    return result
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })
}