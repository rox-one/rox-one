import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcLabelsActResult,
  rpcLabelsListResult,
  rpcLabelsReadResult,
} from '@craft-agent/core/rox2'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.labels.LIST,
  RPC_CHANNELS.labels.CREATE,
  RPC_CHANNELS.labels.UPDATE,
  RPC_CHANNELS.labels.DELETE,
] as const

export function registerLabelsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // List all labels for a workspace
  server.handle(RPC_CHANNELS.labels.LIST, async (_ctx, workspaceId: string) => {
    const listed = rpcLabelsListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listLabels } = await import('@craft-agent/shared/labels/storage')
    return listLabels(workspace.rootPath)
  })

  // Create a new label in a workspace
  server.handle(RPC_CHANNELS.labels.CREATE, async (_ctx, workspaceId: string, input: import('@craft-agent/shared/labels').CreateLabelInput) => {
    const act = rpcLabelsActResult({ source: 'native', action: 'write', nativeId: 'label' })
    if (!isClaimableLive(act)) throw new Error('label create is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createLabel } = await import('@craft-agent/shared/labels/crud')
    const label = createLabel(workspace.rootPath, input)
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return label
  })

  // Update an existing label (name, color, valueType)
  server.handle(RPC_CHANNELS.labels.UPDATE, async (
    _ctx,
    workspaceId: string,
    labelId: string,
    updates: import('@craft-agent/shared/labels').UpdateLabelInput,
  ) => {
    const read = rpcLabelsReadResult({ source: 'native', nativeId: labelId })
    if (!isClaimableLive(read.result)) throw new Error('label is not live')
    const act = rpcLabelsActResult({ source: 'native', action: 'write', nativeId: labelId })
    if (!isClaimableLive(act)) throw new Error('label update is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { updateLabel } = await import('@craft-agent/shared/labels/crud')
    const label = updateLabel(workspace.rootPath, labelId, updates)
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return label
  })

  // Delete a label (and descendants) from a workspace
  server.handle(RPC_CHANNELS.labels.DELETE, async (_ctx, workspaceId: string, labelId: string) => {
    if (!labelId) throw new Error('labels.delete: labelId is required')
    const act = rpcLabelsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: labelId })
    if (!isClaimableLive(act)) throw new Error('label destroy is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)

    const { deleteLabel } = await import('@craft-agent/shared/labels/crud')
    const result = deleteLabel(workspace.rootPath, labelId)
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return result
  })
}
