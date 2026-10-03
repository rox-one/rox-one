import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcStatusesActResult,
  rpcStatusesListResult,
  rpcStatusesReadResult,
} from '@rox/core/rox2'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.statuses.LIST,
  RPC_CHANNELS.statuses.REORDER,
] as const

export function registerStatusesHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // List all statuses for a workspace
  server.handle(RPC_CHANNELS.statuses.LIST, async (_ctx, workspaceId: string) => {
    const listed = rpcStatusesListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('statuses list is not live')
    const read = rpcStatusesReadResult({ source: 'native', nativeId: workspaceId })
    if (!isClaimableLive(read.result)) throw new Error('statuses list is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listStatuses } = await import('@rox/shared/statuses')
    return listStatuses(workspace.rootPath)
  })

  // Reorder statuses (drag-and-drop). Receives new ordered array of status IDs.
  // Config watcher will detect the file change and broadcast STATUSES_CHANGED.
  server.handle(RPC_CHANNELS.statuses.REORDER, async (_ctx, workspaceId: string, orderedIds: string[]) => {
    const act = rpcStatusesActResult({ source: 'native', action: 'write', nativeId: workspaceId })
    if (!isClaimableLive(act)) throw new Error('statuses reorder is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { reorderStatuses } = await import('@rox/shared/statuses')
    reorderStatuses(workspace.rootPath, orderedIds)
  })
}
