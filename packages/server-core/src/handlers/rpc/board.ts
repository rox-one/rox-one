/**
 * Board widget RPC handlers (wave 3, row b2.3).
 *
 * The frozen `board:*` channels are classified like `pages:*` (workspace content
 * on the workspace-owning server), while write authority is enforced with the
 * SAME actor seam as the workspace-work / workboard surface: the workspace and
 * capability are derived from trusted transport/window state, never from the
 * request, and `createdBy` is taken from the resolved actor — a client can never
 * supply it.
 *
 * The handlers are a thin shell over `WidgetStore` (bytes on disk) and the
 * per-workspace `WidgetTicketRegistry` (render capabilities). They push
 * `board:changed` after every accepted put so a browser path can refresh.
 */

import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import type { WidgetKind } from '@rox/shared/widgets/types'
import { pushTyped, type RpcServer, type RequestContext } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { WidgetStore } from '../../board/widget-store.ts'
import { widgetTicketRegistryFor } from '../../board/widget-tickets.ts'
import { workspaceWorkContext } from './workspace-work.ts'

export const BOARD_HANDLED_CHANNELS = [
  RPC_CHANNELS.board.WIDGET_PUT,
  RPC_CHANNELS.board.WIDGET_GET,
  RPC_CHANNELS.board.WIDGET_MOUNT,
  RPC_CHANNELS.board.WIDGET_RELEASE,
] as const

interface BoardPutArgs {
  workspaceId?: string | null
  title: string
  widgetCode: string
  kind: string
  name: string
  netOrigins?: string[]
}
interface BoardWidgetRefArgs { workspaceId?: string | null; widgetId: string }
interface BoardReleaseArgs { workspaceId?: string | null; ticket: string }

/** The request workspace is explicit, else the transport/window-bound one. */
function resolveWorkspaceId(ctx: RequestContext, args: { workspaceId?: string | null } | undefined, deps: HandlerDeps): string {
  const bound = ctx.workspaceId ?? (ctx.webContentsId === null ? undefined : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId))
  return args?.workspaceId ?? bound ?? ''
}

/** Reuses the workspace-work actor seam verbatim; the board only adds its store. */
function boardContext(ctx: RequestContext, workspaceId: string, deps: HandlerDeps, server: RpcServer) {
  const { actor } = workspaceWorkContext(ctx, workspaceId, deps, server)
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace || workspace.id !== workspaceId) throw new CodedError('NOT_FOUND', 'Workspace unavailable')
  return { actor, store: new WidgetStore(workspace.rootPath, workspaceId), tickets: widgetTicketRegistryFor(workspace.rootPath) }
}

export function registerBoardHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.board.WIDGET_PUT, (ctx, args: BoardPutArgs) => {
    const workspaceId = resolveWorkspaceId(ctx, args, deps)
    const { actor, store, tickets } = boardContext(ctx, workspaceId, deps, server)
    if (!actor.canWrite) throw new CodedError('FORBIDDEN', 'Board widget action denied')
    actor.assertCurrent('write')
    const record = store.put({
      name: args?.name,
      title: args?.title,
      kind: args?.kind as WidgetKind, // wire input; WidgetStore.put validates the kind at runtime
      widgetCode: args?.widgetCode,
      netOrigins: args?.netOrigins,
      createdBy: actor.actorId,
    })
    tickets.rotate(record.widgetId)
    pushTyped(server, RPC_CHANNELS.board.CHANGED, { to: 'workspace', workspaceId }, { widgetId: record.widgetId, revision: record.revision })
    return { widgetId: record.widgetId, name: record.name, revision: record.revision }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })

  server.handle(RPC_CHANNELS.board.WIDGET_GET, (ctx, args: BoardWidgetRefArgs) => {
    const workspaceId = resolveWorkspaceId(ctx, args, deps)
    const { actor, store } = boardContext(ctx, workspaceId, deps, server)
    actor.assertCurrent('read')
    const record = store.read(args?.widgetId)
    if (!record) throw new CodedError('NOT_FOUND', 'Board widget unavailable')
    return { widgetId: record.widgetId, name: record.name, kind: record.kind, revision: record.revision, content: store.readDocument(record.name) }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  server.handle(RPC_CHANNELS.board.WIDGET_MOUNT, (ctx, args: BoardWidgetRefArgs) => {
    const workspaceId = resolveWorkspaceId(ctx, args, deps)
    const { actor, store, tickets } = boardContext(ctx, workspaceId, deps, server)
    actor.assertCurrent('read')
    const record = store.read(args?.widgetId)
    if (!record) throw new CodedError('NOT_FOUND', 'Board widget unavailable')
    const content = store.readDocument(record.name)
    const ticket = tickets.mount({ widgetId: record.widgetId, revision: record.revision })
    return { ticket: ticket.nonce, content, revision: record.revision }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  server.handle(RPC_CHANNELS.board.WIDGET_RELEASE, (ctx, args: BoardReleaseArgs) => {
    const workspaceId = resolveWorkspaceId(ctx, args, deps)
    const { actor, tickets } = boardContext(ctx, workspaceId, deps, server)
    actor.assertCurrent('read')
    return { released: tickets.release(args?.ticket ?? '') }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })
}