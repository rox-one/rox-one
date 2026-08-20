/**
 * KnowledgeInspector — inspector sections for the active knowledge (SiYuan) ref (W2).
 *
 * Sections, each hidden when empty:
 * - PROPERTIES: node attributes (the provider already surfaces custom-* IAL keys only).
 * - BACKLINKS: provider backlinks; clicking navigates via routes.view.siyuan.
 * - OUTLINE: headings parsed locally from node markdown (./outline-parser — no new dep).
 *
 * Data flows through the P1 read-only RPC surface only
 * (window.electronAPI.knowledge.listConnections/get/getBacklinks) — no main-process
 * probing beyond the contracted channels. P1 ships a single SiYuan connection, so the
 * first connection from listConnections() wins; per-connection selection lands with the
 * navigator slice.
 *
 * Prop note: the prop is named `knowledgeRef`, not `ref` as the cross-slice contract
 * phrases it — this app runs React 18, which strips a prop literally named `ref`
 * before it reaches the component.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { KnowledgeAgentPanel } from './KnowledgeAgentPanel'
import { parseOutline } from './outline-parser'
import { useKnowledgeNode } from './use-knowledge-node'
import type { KnowledgeRef } from '../../shared/types'

export type { KnowledgeNodeState } from './use-knowledge-node'
export { useKnowledgeNode } from './use-knowledge-node'

export interface KnowledgeInspectorProps {
  knowledgeRef: KnowledgeRef | null
}

function InspectorShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </div>
  )
}

export function KnowledgeInspector({ knowledgeRef }: KnowledgeInspectorProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { node, backlinks, loading, error } = useKnowledgeNode(knowledgeRef)
  const agentPanel = knowledgeRef ? <KnowledgeAgentPanel knowledgeRef={knowledgeRef} /> : null

  if (!knowledgeRef) {
    return (
      <InspectorShell title={t('knowledge.inspector.title')}>
        <p className="text-xs text-muted-foreground">{t('knowledge.inspector.empty')}</p>
      </InspectorShell>
    )
  }

  if (loading && !node) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {agentPanel}
        <InspectorShell title={t('knowledge.inspector.title')}>
          <p className="text-xs text-muted-foreground">{t('knowledge.surface.loading')}</p>
        </InspectorShell>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {agentPanel}
        <InspectorShell title={t('knowledge.inspector.title')}>
          <p className="text-xs text-destructive">{t('knowledge.surface.error')}</p>
          <p className="break-words text-xs text-muted-foreground">{error}</p>
        </InspectorShell>
      </div>
    )
  }

  const outline = node?.markdown ? parseOutline(node.markdown) : []

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {agentPanel}
      <div className="flex flex-col gap-4 p-4">
        <h2 className="text-sm font-medium">{t('knowledge.inspector.title')}</h2>

      {node && node.attributes.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            {t('knowledge.inspector.properties')}
          </h3>
          <dl className="space-y-1">
            {node.attributes.map((attr) => (
              <div key={attr.key} className="flex items-baseline justify-between gap-2 text-xs">
                <dt className="shrink-0 text-muted-foreground">{attr.key}</dt>
                <dd className="truncate">{attr.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {backlinks.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            {t('knowledge.inspector.backlinks')}
          </h3>
          <ul className="space-y-0.5">
            {backlinks.map((backlink) => (
              <li key={`${backlink.ref.kind}/${backlink.ref.id}`}>
                <button
                  type="button"
                  className="w-full truncate text-left text-xs text-foreground hover:underline"
                  onClick={() =>
                    navigate(routes.view.siyuan({ kind: backlink.ref.kind, id: backlink.ref.id }))
                  }
                >
                  {backlink.title || backlink.ref.id}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outline.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            {t('knowledge.inspector.outline')}
          </h3>
          <ul className="space-y-0.5">
            {outline.map((heading) => (
              <li
                key={heading.line}
                className="truncate text-xs text-muted-foreground"
                style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}
              >
                {heading.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </div>
  )
}
