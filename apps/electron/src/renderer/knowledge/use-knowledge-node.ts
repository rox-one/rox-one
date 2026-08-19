/**
 * Shared knowledge-node loader for Inspector + AgentPanel.
 * Extracted so those surfaces can compose without a circular import.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type { ContextPayload, KnowledgeNode, KnowledgeRef } from '../../shared/types'

export interface KnowledgeNodeState {
  node: KnowledgeNode | null
  backlinks: ContextPayload['backlinks']
  loading: boolean
  error: string | null
}

const EMPTY_STATE: KnowledgeNodeState = { node: null, backlinks: [], loading: false, error: null }

/**
 * Loads node + backlinks for a knowledge ref through the P1 read-only RPC.
 * Deps are the ref's primitives (not the object) so route-derived ref objects
 * re-created per render cannot retrigger the fetch loop.
 */
export function useKnowledgeNode(knowledgeRef: KnowledgeRef | null): KnowledgeNodeState {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id
  const scheme = knowledgeRef?.scheme
  const kind = knowledgeRef?.kind
  const id = knowledgeRef?.id
  const provider = knowledgeRef?.provider
  const [state, setState] = React.useState<KnowledgeNodeState>(EMPTY_STATE)

  React.useEffect(() => {
    if (!scheme || !kind || !id || !workspaceId) {
      setState(EMPTY_STATE)
      return
    }
    const ref: KnowledgeRef = { scheme, kind, id, ...(provider ? { provider } : {}) }
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))
    void (async () => {
      try {
        const connections = await window.electronAPI.knowledge.listConnections()
        const connectionId = connections[0]?.id
        if (!connectionId) throw new Error(t('knowledge.inspector.noConnection'))
        const args = { workspaceId, connectionId, ref }
        const [node, backlinks] = await Promise.all([
          window.electronAPI.knowledge.get(args),
          window.electronAPI.knowledge.getBacklinks(args),
        ])
        if (!cancelled) setState({ node, backlinks, loading: false, error: null })
      } catch (error) {
        if (!cancelled) {
          setState({
            node: null,
            backlinks: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [scheme, kind, id, provider, workspaceId, t])

  return state
}
