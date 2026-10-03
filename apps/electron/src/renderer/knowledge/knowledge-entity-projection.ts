import type { KnowledgeRef } from '@rox/core/knowledge'
import { deriveKnowledgeMindMap, type MindMapGraph } from '@rox/core/mindmap'
import type { ElectronAPI } from '../../shared/types'

type KnowledgeApi = ElectronAPI['knowledge']
export type KnowledgeProjectionResult =
  | { status: 'ready'; graph: MindMapGraph }
  | { status: 'missing' }
  | { status: 'cancelled' }

/** Read the selected entity before optional context; never project a missing ID. */
export async function loadKnowledgeEntityGraph({
  api, workspaceId, ref, isCurrent, noConnectionMessage,
}: {
  api: Pick<KnowledgeApi, 'listConnections' | 'getBacklinks' | 'getContext'> & {
    get: (args: Parameters<KnowledgeApi['get']>[0]) => Promise<Awaited<ReturnType<KnowledgeApi['get']>> | null>
  }
  workspaceId: string
  ref: KnowledgeRef
  isCurrent: () => boolean
  noConnectionMessage: string
}): Promise<KnowledgeProjectionResult> {
  const connections = await api.listConnections()
  if (!isCurrent()) return { status: 'cancelled' }
  const connectionId = connections.find(connection => connection.id === 'siyuan-local')?.id
    ?? connections.find(connection => (connection.label ?? '').toLowerCase().includes('local'))?.id
    ?? connections[0]?.id
  if (!connectionId) throw new Error(noConnectionMessage)

  const args = { workspaceId, connectionId, ref }
  const node = await api.get(args)
  if (!isCurrent()) return { status: 'cancelled' }
  if (!node) return { status: 'missing' }

  const backlinks = await api.getBacklinks(args).catch(() => [])
  if (!isCurrent()) return { status: 'cancelled' }
  const context = await api.getContext({ ...args, mode: 'live-reference' }).catch(() => null)
  if (!isCurrent()) return { status: 'cancelled' }

  return {
    status: 'ready',
    graph: deriveKnowledgeMindMap({
      ref, title: node.title || ref.id, content: node.markdown ?? '',
      children: context?.children?.length ? context.children.map(child => ({ blockId: child.blockId, content: child.content })) : undefined,
      backlinks: (backlinks ?? []).map(backlink => ({ ref: backlink.ref, title: backlink.title || backlink.ref.id })),
    }),
  }
}
