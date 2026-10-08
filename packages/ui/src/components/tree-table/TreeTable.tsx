/**
 * TreeTable (W1-08; Work Map / goal trees / task hierarchies).
 *
 * ARIA `treegrid`: rows carry `aria-level`, `aria-expanded`, `aria-posinset`.
 * Keyboard: ↑ ↓ move between rows, → expands (or moves into the first
 * child), ← collapses (or moves to the parent), Enter activates.
 *
 * Hosts attach per-row behaviour (X-13 drag source, common row context
 * menu) through `rowProps`, so the table stays entity-agnostic.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { FOCUS_RING, HOVER_TINT, MOTION_FAST } from '../primitives/tokens'

export interface TreeRow {
  id: string
  /** Accessible title for expand/collapse labels. */
  title: string
  cells: Record<string, React.ReactNode>
  children?: TreeRow[]
}

export interface TreeColumn {
  id: string
  header: React.ReactNode
  width?: number | string
}

export interface FlatTreeRow {
  row: TreeRow
  level: number
  parentId: string | null
  posInSet: number
  setSize: number
  hasChildren: boolean
  expanded: boolean
}

/** Depth-first flattening honouring the expanded set (pure). */
export function flattenTree(rows: readonly TreeRow[], expanded: ReadonlySet<string>): FlatTreeRow[] {
  const out: FlatTreeRow[] = []
  const walk = (list: readonly TreeRow[], level: number, parentId: string | null) => {
    list.forEach((row, index) => {
      const hasChildren = (row.children?.length ?? 0) > 0
      const isExpanded = hasChildren && expanded.has(row.id)
      out.push({ row, level, parentId, posInSet: index + 1, setSize: list.length, hasChildren, expanded: isExpanded })
      if (isExpanded) walk(row.children!, level + 1, row.id)
    })
  }
  walk(rows, 1, null)
  return out
}

export interface TreeTableProps {
  rows: readonly TreeRow[]
  columns: readonly TreeColumn[]
  /** Accessible name of the grid. */
  label: string
  defaultExpandedIds?: readonly string[]
  expandedIds?: ReadonlySet<string>
  onExpandedChange?: (next: Set<string>) => void
  onActivate?: (row: TreeRow) => void
  rowProps?: (row: TreeRow) => React.HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string>
  className?: string
}

export function TreeTable({ rows, columns, label, defaultExpandedIds, expandedIds, onExpandedChange, onActivate, rowProps, className }: TreeTableProps) {
  const { t } = useTranslation()
  const [internal, setInternal] = React.useState<Set<string>>(() => new Set(defaultExpandedIds ?? []))
  const expanded = expandedIds ?? internal
  const flat = React.useMemo(() => flattenTree(rows, expanded), [rows, expanded])
  const [focusId, setFocusId] = React.useState<string | null>(null)
  const rowRefs = React.useRef(new Map<string, HTMLTableRowElement>())
  const currentFocus = focusId && flat.some((f) => f.row.id === focusId) ? focusId : flat[0]?.row.id ?? null

  const setExpanded = (id: string, value: boolean) => {
    const next = new Set(expanded)
    if (value) next.add(id); else next.delete(id)
    if (!expandedIds) setInternal(next)
    onExpandedChange?.(next)
  }
  const focusRow = (id: string | null | undefined) => {
    if (!id) return
    setFocusId(id)
    rowRefs.current.get(id)?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const item = flat[index]!
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusRow(flat[index + 1]?.row.id); break
      case 'ArrowUp': event.preventDefault(); focusRow(flat[index - 1]?.row.id); break
      case 'ArrowRight':
        event.preventDefault()
        if (item.hasChildren && !item.expanded) setExpanded(item.row.id, true)
        else if (item.expanded) focusRow(flat[index + 1]?.row.id)
        break
      case 'ArrowLeft':
        event.preventDefault()
        if (item.expanded) setExpanded(item.row.id, false)
        else focusRow(item.parentId)
        break
      case 'Enter': event.preventDefault(); onActivate?.(item.row); break
    }
  }

  if (rows.length === 0) return <div className={cn('py-3 text-[12px] text-text-muted', className)}>{t('entities.ui.tree.empty')}</div>

  return (
    <table role="treegrid" aria-label={label} className={cn('w-full border-collapse text-[13px]', className)}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.id} scope="col" style={{ width: col.width }} className="h-8 border-b border-border px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {flat.map((item, index) => {
          const extra = rowProps?.(item.row) ?? {}
          return (
            <tr
              key={item.row.id}
              {...extra}
              ref={(el) => { if (el) rowRefs.current.set(item.row.id, el); else rowRefs.current.delete(item.row.id) }}
              tabIndex={item.row.id === currentFocus ? 0 : -1}
              aria-level={item.level}
              aria-posinset={item.posInSet}
              aria-setsize={item.setSize}
              aria-expanded={item.hasChildren ? item.expanded : undefined}
              data-row-id={item.row.id}
              onFocus={() => setFocusId(item.row.id)}
              onKeyDown={(e) => { extra.onKeyDown?.(e); if (!e.defaultPrevented) onKeyDown(e, index) }}
              onDoubleClick={() => onActivate?.(item.row)}
              className={cn('h-9 border-b border-border/60', HOVER_TINT, MOTION_FAST, FOCUS_RING, extra.className)}
            >
              {columns.map((col, ci) => (
                <td key={col.id} role="gridcell" className="px-2">
                  {ci === 0 ? (
                    <span className="flex min-w-0 items-center gap-1" style={{ paddingLeft: (item.level - 1) * 16 }}>
                      {item.hasChildren ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={item.expanded ? t('entities.ui.tree.collapse', { title: item.row.title }) : t('entities.ui.tree.expand', { title: item.row.title })}
                          onClick={() => setExpanded(item.row.id, !item.expanded)}
                          className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-text-muted', HOVER_TINT, FOCUS_RING)}
                        >
                          <span aria-hidden="true" className={cn('inline-block transition-transform duration-[120ms] motion-reduce:transition-none', item.expanded && 'rotate-90')}>›</span>
                        </button>
                      ) : <span aria-hidden="true" className="inline-block size-5 shrink-0" />}
                      <span className="min-w-0 truncate">{item.row.cells[col.id]}</span>
                    </span>
                  ) : item.row.cells[col.id]}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
