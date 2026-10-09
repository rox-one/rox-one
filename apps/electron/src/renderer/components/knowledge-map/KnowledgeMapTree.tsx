/**
 * KnowledgeMapTree — collapsible area → document list for the knowledge map.
 * Pure presentation over the DTO; the panel owns the query and selection.
 */

import * as React from 'react'
import { ChevronRight, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import type { KnowledgeMapEdge, KnowledgeMapNode } from '@rox/shared/knowledge/knowledge-map-types'
import { buildTree, degreeOf, nodeMatchesQuery } from './knowledge-map-model'

interface KnowledgeMapTreeProps {
  nodes: KnowledgeMapNode[]
  edges: KnowledgeMapEdge[]
  query: string
  selectedId: string | null
  onSelectNode: (id: string) => void
  onOpenNode: (id: string) => void
}

export function KnowledgeMapTree({
  nodes,
  edges,
  query,
  selectedId,
  onSelectNode,
  onOpenNode,
}: KnowledgeMapTreeProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())

  const groups = React.useMemo(() => {
    const needle = query.trim()
    const docs = needle ? nodes.filter((node) => nodeMatchesQuery(node, needle)) : nodes
    return buildTree(docs)
  }, [nodes, query])

  const toggle = (area: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(area)) next.delete(area)
      else next.add(area)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const open = !collapsed.has(group.area)
        return (
          <div key={group.area} className="rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/40 transition-colors motion-reduce:transition-none"
              aria-expanded={open}
              onClick={() => toggle(group.area)}
            >
              <ChevronRight
                className={`icon-caption shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
                aria-hidden
              />
              <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: group.color }} aria-hidden />
              <span className="truncate">{t(group.labelKey)}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{group.nodes.length}</span>
            </button>
            {open && (
              <ul className="divide-y divide-border border-t border-border">
                {group.nodes.map((node) => (
                  <li key={node.id} className="flex items-stretch">
                    <button
                      type="button"
                      className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-2 pl-8 text-left text-sm hover:bg-muted/40 transition-colors motion-reduce:transition-none ${
                        node.id === selectedId ? 'bg-muted/50' : ''
                      }`}
                      onClick={() => onSelectNode(node.id)}
                      onDoubleClick={() => onOpenNode(node.id)}
                    >
                      <span className="truncate">{node.label}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                        {degreeOf(node.id, edges)}
                      </span>
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="shrink-0 px-3 text-muted-foreground hover:text-foreground transition-colors motion-reduce:transition-none"
                          aria-label={t('knowledgeMap.node.open')}
                          onClick={() => onOpenNode(node.id)}
                        >
                          <FileText className="icon-caption" aria-hidden />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t('knowledgeMap.node.open')}</TooltipContent>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default KnowledgeMapTree