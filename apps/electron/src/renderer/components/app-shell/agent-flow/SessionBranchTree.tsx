/**
 * SessionBranchTree — dialogue branch tree (#15). Shown under the chat header
 * whenever the current session has a parent or branches; lists the whole
 * family as a navigable ARIA tree.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { navigate, routes } from '@/lib/navigate'
import { buildBranchTree, flattenBranchTree, type BranchNode } from './branch-tree'

export function SessionBranchTree({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const metas = useAtomValue(sessionMetaMapAtom)
  const tree = React.useMemo(() => buildBranchTree(metas.values(), sessionId), [metas, sessionId])
  const [open, setOpen] = React.useState(false)
  const listRef = React.useRef<HTMLUListElement>(null)
  const flat = React.useMemo(() => (tree ? flattenBranchTree(tree.root) : []), [tree])
  const [focusId, setFocusId] = React.useState<string>(sessionId)
  React.useEffect(() => { setFocusId(sessionId) }, [sessionId])

  if (!tree) return null
  const go = (id: string) => { if (id !== sessionId) navigate(routes.view.allSessions(id)) }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const i = flat.findIndex((n) => n.id === focusId)
    let next = i
    if (event.key === 'ArrowDown') next = Math.min(flat.length - 1, i + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, i - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = flat.length - 1
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(focusId); return }
    else return
    event.preventDefault()
    const id = flat[next]!.id
    setFocusId(id)
    listRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.focus()
  }

  const renderNode = (node: BranchNode): React.ReactNode => (
    <li key={node.id} role="none">
      <div
        role="treeitem"
        aria-level={node.depth + 1}
        aria-current={node.isCurrent ? 'page' : undefined}
        aria-expanded={node.children.length > 0 ? true : undefined}
        tabIndex={node.id === focusId ? 0 : -1}
        data-node-id={node.id}
        onClick={() => go(node.id)}
        className={cn('flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-surface-hover', node.isCurrent && 'bg-surface-selected text-foreground')}
        style={{ paddingInlineStart: `${0.375 + node.depth * 0.875}rem` }}
      >
        <GitBranch className="icon-caption shrink-0" aria-hidden />
        <span className="truncate">{node.title || t('chat.branchTree.untitled')}</span>
      </div>
      {node.children.length > 0 && <ul role="group">{node.children.map(renderNode)}</ul>}
    </li>
  )

  return (
    <div className="shrink-0 border-b border-border/40 px-3 py-1.5 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 hover:text-foreground">
          {open ? <ChevronDown className="icon-caption" aria-hidden /> : <ChevronRight className="icon-caption" aria-hidden />}
          {t('chat.branchTree.summary', { count: tree.size })}
        </button>
      </div>
      {open && (
        <ul ref={listRef} role="tree" aria-label={t('chat.branchTree.label')} className="mt-1 max-h-48 overflow-auto" onKeyDown={onKeyDown}>
          {renderNode(tree.root)}
        </ul>
      )}
    </div>
  )
}
