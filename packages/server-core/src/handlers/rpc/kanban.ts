import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  loadKanbanBoardConfig,
  saveKanbanBoardConfig,
  type KanbanBoardConfig,
} from '@craft-agent/shared/kanban'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcKanbanActResult,
  rpcKanbanListResult,
  rpcKanbanReadResult,
} from '@craft-agent/core/rox2'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.kanban.GET_CONFIG,
  RPC_CHANNELS.kanban.SET_CONFIG,
] as const

export function registerKanbanHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.kanban.GET_CONFIG, async (_ctx, workspaceId: string) => {
    const listed = rpcKanbanListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('kanban config is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const read = rpcKanbanReadResult({ source: 'native', nativeId: 'board' })
    if (!isClaimableLive(read.result)) throw new Error('kanban config is not live')
    return loadKanbanBoardConfig(workspace.rootPath)
  })

  server.handle(
    RPC_CHANNELS.kanban.SET_CONFIG,
    async (_ctx, workspaceId: string, config: KanbanBoardConfig) => {
      const act = rpcKanbanActResult({ source: 'native', action: 'write', nativeId: 'board' })
      if (!isClaimableLive(act)) throw new Error('kanban config write is not live')
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      const saved = saveKanbanBoardConfig(workspace.rootPath, config)
      pushTyped(
        server,
        RPC_CHANNELS.kanban.CHANGED,
        { to: 'workspace', workspaceId },
        workspaceId,
        saved,
      )
      log.info(`Kanban board config saved for workspace ${workspaceId}`)
      return saved
    },
  )
}
