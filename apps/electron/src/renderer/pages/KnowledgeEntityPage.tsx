/**
 * Craft-side EntityViewTabs around a knowledge document/block.
 * Standard/Graph → embedded SiYuan surface; Map/Outline → Craft mind-map projection.
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { KnowledgeRef } from '@rox/core/knowledge'
import type { MindMapGraph } from '@rox/core/mindmap'
import {
  defaultKnowledgeEntityCapabilities,
  EntityViewTabs,
  useEntityView,
  type EntityViewId,
} from '@/components/app-shell/EntityViewTabs'
import { featureUnifiedShellAtom } from '@/atoms/unified-shell'
import { useAppShellContext } from '@/context/AppShellContext'
import { useSiyuanConnected } from '@/hooks/useSiyuanConnected'
import { MindMapHost } from '@/mindmap/MindMapHost'
import { KnowledgeInspector } from '@/knowledge/KnowledgeInspector'
import { knowledgeEntityCompanionRef } from '@/knowledge/knowledge-entity-ref'
import { loadKnowledgeEntityGraph } from '@/knowledge/knowledge-entity-projection'
import KnowledgeSurfacePage from '@/pages/KnowledgeSurfacePage'
import type { SiyuanSurfaceRef } from '@/knowledge/siyuan-url'

export interface KnowledgeEntityPageProps {
  kind: SiyuanSurfaceRef['kind']
  id: string
  panelId?: string
}

export default function KnowledgeEntityPage({ kind, id, panelId }: KnowledgeEntityPageProps) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const unifiedShellEnabled = useAtomValue(featureUnifiedShellAtom)
  const siyuanConnected = useSiyuanConnected()
  const capabilities = React.useMemo(
    () => defaultKnowledgeEntityCapabilities({ siyuanConnected: siyuanConnected ?? false }),
    [siyuanConnected],
  )
  const [view, setView] = useEntityView(`knowledge:${kind}:${id}`, capabilities, 'standard')

  const [attempt, setAttempt] = React.useState(0)
  const identity = JSON.stringify([activeWorkspaceId, kind, id, attempt])
  const [projection, setProjection] = React.useState<{
    identity: string
    status: 'loading' | 'ready' | 'missing' | 'error'
    graph?: MindMapGraph
    error?: string
  }>({ identity, status: 'loading' })
  const currentProjection: typeof projection = projection.identity === identity ? projection : { identity, status: 'loading' }

  React.useEffect(() => {
    if (view !== 'map' && view !== 'outline') {
      return
    }
    if (!activeWorkspaceId) {
      setProjection({ identity, status: 'error', error: t('knowledge.inspector.noConnection') })
      return
    }

    let cancelled = false
    const run = async () => {
      setProjection({ identity, status: 'loading' })
      try {
        const result = await loadKnowledgeEntityGraph({
          api: window.electronAPI.knowledge, workspaceId: activeWorkspaceId,
          ref: { scheme: 'siyuan', kind: kind as KnowledgeRef['kind'], id },
          isCurrent: () => !cancelled, noConnectionMessage: t('knowledge.inspector.noConnection'),
        })
        if (cancelled) return
        if (result.status !== 'cancelled') setProjection({ identity, ...result })
      } catch (e) {
        if (!cancelled) {
          setProjection({ identity, status: 'error', error: e instanceof Error ? e.message : String(e) })
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [view, kind, id, activeWorkspaceId, identity, t])

  const companionRef = knowledgeEntityCompanionRef(kind, id)

  let body: React.ReactNode
  if (view === 'map' || view === 'outline') {
    body = currentProjection.status === 'missing' || currentProjection.status === 'error' ? (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground" data-testid="knowledge-entity-unavailable" data-entity-id={id}>
        <p className="text-sm">{currentProjection.status === 'missing' ? t('common.unavailable') : currentProjection.error || t('common.unavailable')}</p>
        <button type="button" className="rounded-md border border-border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setAttempt(value => value + 1)}>
          {t('common.retry')}
        </button>
      </div>
    ) : (
      <MindMapHost
        entity={{ type: 'knowledge', ref: { scheme: 'siyuan', kind: kind as KnowledgeRef['kind'], id } }}
        graph={currentProjection.graph ?? null}
        loading={currentProjection.status === 'loading'}
        mode={view}
        workspaceId={activeWorkspaceId || undefined}
      />
    )
  } else if (view === 'graph') {
    body = <KnowledgeSurfacePage kind={kind} id={id} panelId={panelId} mode="graph" />
  } else {
    body = <KnowledgeSurfacePage kind={kind} id={id} panelId={panelId} mode="editor" />
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <EntityViewTabs
        value={view}
        onChange={setView as (id: EntityViewId) => void}
        capabilities={capabilities}
      />
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-h-0">{body}</div>
        {companionRef && !unifiedShellEnabled ? (
          <aside
            className="w-[320px] shrink-0 overflow-y-auto border-l border-border/60 bg-muted/[0.12]"
            aria-label={t('knowledge.inspector.title')}
          >
            <KnowledgeInspector knowledgeRef={companionRef} />
          </aside>
        ) : null}
      </div>
    </div>
  )
}
