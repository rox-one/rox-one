import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  loadCollectionDisplay,
  saveCollectionDisplay,
  loadCollectionFiltersMap,
  saveCollectionFiltersMap,
  type CollectionDisplay,
  type CollectionFilters,
} from '@craft-agent/shared/sessions'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcCollectionActResult,
  rpcCollectionListResult,
  rpcCollectionReadResult,
} from '@craft-agent/core/rox2'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.collection.GET_DISPLAY,
  RPC_CHANNELS.collection.SET_DISPLAY,
  RPC_CHANNELS.collection.GET_FILTERS,
  RPC_CHANNELS.collection.SET_FILTERS,
] as const

export function registerCollectionHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.collection.GET_DISPLAY, async (_ctx, workspaceId: string) => {
    const listed = rpcCollectionListResult({ source: 'native', nativeIds: [workspaceId] })
    if (!isClaimableLive(listed.result)) throw new Error('collection display is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return loadCollectionDisplay(workspace.rootPath)
  })

  server.handle(
    RPC_CHANNELS.collection.SET_DISPLAY,
    async (_ctx, workspaceId: string, display: CollectionDisplay) => {
      const act = rpcCollectionActResult({ source: 'native', action: 'write', nativeId: workspaceId })
      if (!isClaimableLive(act)) throw new Error('collection display write is not live')
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      const saved = saveCollectionDisplay(workspace.rootPath, display)
      pushTyped(
        server,
        RPC_CHANNELS.collection.CHANGED,
        { to: 'workspace', workspaceId },
        workspaceId,
        saved,
      )
      log.info(`Collection display saved for workspace ${workspaceId}`)
      return saved
    },
  )

  server.handle(RPC_CHANNELS.collection.GET_FILTERS, async (_ctx, workspaceId: string) => {
    const read = rpcCollectionReadResult({ source: 'native', nativeId: workspaceId })
    if (!isClaimableLive(read.result)) throw new Error('collection filters are not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return loadCollectionFiltersMap(workspace.rootPath)
  })

  server.handle(
    RPC_CHANNELS.collection.SET_FILTERS,
    async (_ctx, workspaceId: string, filtersByKey: Record<string, CollectionFilters>) => {
      const act = rpcCollectionActResult({ source: 'native', action: 'write', nativeId: workspaceId })
      if (!isClaimableLive(act)) throw new Error('collection filters write is not live')
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      const saved = saveCollectionFiltersMap(workspace.rootPath, filtersByKey)
      pushTyped(
        server,
        RPC_CHANNELS.collection.FILTERS_CHANGED,
        { to: 'workspace', workspaceId },
        workspaceId,
        saved,
      )
      log.info(`Collection filters saved for workspace ${workspaceId}`)
      return saved
    },
  )
}
