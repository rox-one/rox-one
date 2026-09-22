import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FilePlus2, ScanSearch, ZoomIn, ZoomOut } from 'lucide-react'
import { PremiumMenuSelect } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  addFormula,
  applyNoteBaseView,
  availableFormulaExprs,
  canvasFitTransform,
  createCanvasFileCard,
  dailyNoteDestination,
  filterGraphByEdgeKind,
  isolateCanvasForNote,
  moveCanvasNode,
  formulaI18nKey,
  formulaValue,
  graphFromLinks,
  groupNoteRows,
  isolateNoteNeighborhood,
  loadSavedViews,
  NOTE_GRAPH_PAGE_SIZE,
  notesCanvasStorageKey,
  notesOnlyGraph,
  notesOutlineFoldsStorageKey,
  notesViewsStorageKey,
  outlineFromHeadings,
  parseJsonCanvas,
  parseOutlineFolds,
  progressiveGraph,
  projectNoteRows,
  removeFormula,
  serializeJsonCanvas,
  serializeOutlineFolds,
  tagFilterValue,
  toggleNoteViewSort,
  withTagFilter,
  type NoteViewFormulaExpr,
  type JsonCanvas,
  type NoteBaseView,
  type NoteGraphEdgeKindFilter,
  type NoteOutlineNode,
  type NoteProjectionRow,
} from './note-views'
import { parseNoteDocument } from './document-ia'

export type NotesViewNote = {
  id: string
  title: string
  markdown: string
  tags?: string[]
  properties?: Record<string, unknown>
  links?: Array<{ target: string }>
  backlinks?: Array<{ noteId: string; title?: string }>
}

export function NotesViewHost({
  view,
  notes,
  activeNoteId,
  workspaceId,
  onOpenNote,
  onCreateNote,
  onConvert,
}: {
  view: 'table' | 'canvas' | 'graph' | 'outline'
  notes: NotesViewNote[]
  activeNoteId: string | null
  workspaceId: string
  onOpenNote: (noteId: string) => void
  onCreateNote: (folder?: string) => void
  onConvert: (noteId: string, kind: 'session-draft' | 'task') => void
}) {
  const rows = React.useMemo(
    () =>
      projectNoteRows(
        notes.map((note) => ({
          ...note,
          tasks: parseNoteDocument(note.markdown).tasks,
        })),
      ),
    [notes],
  )

  if (view === 'table') {
    return (
      <NotesTableView
        rows={rows}
        workspaceId={workspaceId}
        activeNoteId={activeNoteId}
        onOpenNote={onOpenNote}
        onConvert={onConvert}
      />
    )
  }
  if (view === 'canvas') {
    return (
      <NotesCanvasView
        notes={notes}
        activeNoteId={activeNoteId}
        workspaceId={workspaceId}
        onOpenNote={onOpenNote}
        onCreateNote={onCreateNote}
      />
    )
  }
  if (view === 'outline') {
    return <NotesOutlineView notes={notes} activeNoteId={activeNoteId} workspaceId={workspaceId} />
  }

  return <NotesGraphView notes={notes} activeNoteId={activeNoteId} onOpenNote={onOpenNote} />
}

function NotesTableView({
  rows,
  workspaceId,
  activeNoteId,
  onOpenNote,
  onConvert,
}: {
  rows: NoteProjectionRow[]
  workspaceId: string
  activeNoteId: string | null
  onOpenNote: (noteId: string) => void
  onConvert: (noteId: string, kind: 'session-draft' | 'task') => void
}) {
  const { t } = useTranslation()
  const storageKey = notesViewsStorageKey(workspaceId)
  const [views, setViews] = React.useState<NoteBaseView[]>(() =>
    loadSavedViews(typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey)),
  )
  const [activeViewId, setActiveViewId] = React.useState(views[0]?.id ?? 'vault-table')
  const view = views.find((item) => item.id === activeViewId) ?? views[0]!

  React.useEffect(() => {
    try {
      if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify(views))
    } catch {
      /* ignore quota */
    }
  }, [storageKey, views])

  const persistViews = (next: NoteBaseView[]) => {
    setViews(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* ignore quota */
    }
  }

  const patchView = (next: NoteBaseView) => {
    persistViews(views.map((item) => (item.id === next.id ? next : item)))
  }

  const visible = applyNoteBaseView(rows, view)
  const groups = groupNoteRows(visible, view.groupBy, view.formulas)
  const unusedFormulas = availableFormulaExprs(view)
  const colSpan = 4 + view.formulas.length

  return (
    <div className="h-full overflow-auto p-4" data-testid="notes-table-view">
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="notes-table-toolbar">
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {t('notes.views.savedLayout')}
          <PremiumMenuSelect
            items={views.map((item) => ({ id: item.id, label: item.name }))}
            selectedId={view.id}
            placeholder={t('notes.views.savedLayout')}
            onSelect={(item) => setActiveViewId(item.id)}
            variant="compact"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {t('notes.views.groupBy')}
          <PremiumMenuSelect
            items={[
              { id: 'none', label: t('notes.views.groupNone') },
              { id: 'folder', label: t('notes.views.groupFolder') },
              { id: 'tags', label: t('notes.views.groupTags') },
              ...view.formulas.map((formula) => ({
                id: formula.expr,
                label: t(formulaI18nKey(formula.expr)),
              })),
            ]}
            selectedId={view.groupBy ?? 'none'}
            placeholder={t('notes.views.groupBy')}
            onSelect={(item) => patchView({ ...view, groupBy: item.id === 'none' ? undefined : item.id })}
            variant="compact"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {t('notes.views.filterTags')}
          <input
            className="h-7 w-36 rounded-[5px] border border-border/60 bg-background px-2 text-xs"
            value={tagFilterValue(view)}
            onChange={(event) => patchView(withTagFilter(view, event.target.value))}
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {t('notes.views.formula')}
          <span data-testid="notes-table-formula">
            <PremiumMenuSelect
              items={unusedFormulas.map((expr) => ({
                id: expr,
                label: t(formulaI18nKey(expr)),
              }))}
              placeholder={unusedFormulas.length === 0 ? t('notes.views.formulaNone') : t('notes.views.formulaAdd')}
              disabled={unusedFormulas.length === 0}
              onSelect={(item) => patchView(addFormula(view, item.id as NoteViewFormulaExpr))}
              variant="compact"
            />
          </span>
        </label>
        {view.formulas.map((formula) => (
          <button
            key={formula.expr}
            type="button"
            data-testid={`notes-table-formula-${formula.expr}`}
            className="inline-flex h-7 items-center gap-1 rounded-[5px] border border-border/60 px-2 text-[11px] hover:bg-foreground/[0.06]"
            onClick={() => patchView(removeFormula(view, formula.expr))}
            aria-label={t('notes.views.formulaRemove')}
          >
            {t(formulaI18nKey(formula.expr))}
            <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-2 py-1">{t('notes.views.colTitle')}</th>
            <th className="px-2 py-1">{t('notes.views.colFolder')}</th>
            <th className="px-2 py-1">{t('notes.views.colTags')}</th>
            {view.formulas.map((formula) => (
              <th key={formula.expr} className="px-2 py-1">
                <button
                  type="button"
                  className="uppercase tracking-wider hover:text-foreground"
                  aria-label={t('notes.views.formulaSort')}
                  data-testid={`notes-table-sort-${formula.expr}`}
                  onClick={() => patchView(toggleNoteViewSort(view, formula.expr))}
                >
                  {t(formulaI18nKey(formula.expr))}
                  {view.sort?.field === formula.expr ? (view.sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              </th>
            ))}
            <th className="px-2 py-1" />
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key || 'all'}>
            {view.groupBy ? (
              <tr>
                <td colSpan={colSpan} className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                  {group.key || t('notes.views.ungrouped')}
                </td>
              </tr>
            ) : null}
            {group.rows.map((row) => (
              <tr
                key={row.id}
                className={cn('border-t border-border/40 hover:bg-foreground/[0.03]', row.id === activeNoteId && 'bg-foreground/[0.06]')}
              >
                <td className="px-2 py-1.5">
                  <button type="button" className="truncate font-medium" onClick={() => onOpenNote(row.id)}>
                    {row.title}
                  </button>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{row.folder || '—'}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{row.tags.join(', ') || '—'}</td>
                {view.formulas.map((formula) => (
                  <td key={formula.expr} className="px-2 py-1.5" data-testid={`notes-formula-${formula.expr}`}>
                    {formulaValue(row, formula)}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right">
                  <button type="button" className="mr-2 text-muted-foreground hover:text-foreground" onClick={() => onConvert(row.id, 'session-draft')}>
                    {t('notes.views.convertSession')}
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onConvert(row.id, 'task')}>
                    {t('notes.views.convertTask')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      {visible.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">{t('notes.views.tableEmpty')}</p>
      ) : null}
    </div>
  )
}

function NotesCanvasView({
  notes,
  activeNoteId,
  workspaceId,
  onOpenNote,
  onCreateNote,
}: {
  notes: NotesViewNote[]
  activeNoteId: string | null
  workspaceId: string
  onOpenNote: (noteId: string) => void
  onCreateNote: (folder?: string) => void
}) {
  const { t } = useTranslation()
  const canvasId = activeNoteId || 'vault'
  const storageKey = notesCanvasStorageKey(workspaceId, canvasId)
  const seeded = React.useMemo(
    () => (activeNoteId ? isolateCanvasForNote(notes, activeNoteId) : { nodes: [], edges: [] }),
    [activeNoteId, notes],
  )
  const [canvas, setCanvas] = React.useState<JsonCanvas>(() => {
    const stored = parseJsonCanvas(typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey))
    return stored.nodes.length > 0 ? stored : seeded
  })
  const [fit, setFit] = React.useState({ scale: 1, x: 0, y: 0 })
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null)

  React.useEffect(() => {
    const stored = parseJsonCanvas(typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey))
    setCanvas(stored.nodes.length > 0 ? stored : seeded)
    setFit({ scale: 1, x: 0, y: 0 })
  }, [seeded, storageKey])

  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey, serializeJsonCanvas(canvas))
    } catch {
      /* ignore quota */
    }
  }, [canvas, storageKey])

  const applyFit = React.useCallback(() => {
    const viewport = viewportRef.current?.getBoundingClientRect()
    setFit(canvasFitTransform(canvas.nodes, { width: viewport?.width ?? 800, height: viewport?.height ?? 600 }))
  }, [canvas.nodes])

  const zoomBy = React.useCallback((factor: number) => {
    setFit((prev) => {
      const nextScale = Math.min(4, Math.max(0.25, prev.scale * factor))
      const viewport = viewportRef.current?.getBoundingClientRect()
      const cx = (viewport?.width ?? 800) / 2
      const cy = (viewport?.height ?? 600) / 2
      const ratio = nextScale / prev.scale
      return {
        scale: nextScale,
        x: cx - (cx - prev.x) * ratio,
        y: cy - (cy - prev.y) * ratio,
      }
    })
  }, [])

  const onCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable="true"]')) return
    const key = event.key
    if (key === 'f' || key === 'F' || key === '0') {
      event.preventDefault()
      applyFit()
      return
    }
    if (key === '=' || key === '+') {
      event.preventDefault()
      zoomBy(1.1)
      return
    }
    if (key === '-' || key === '_') {
      event.preventDefault()
      zoomBy(1 / 1.1)
    }
  }

  return (
    <div
      ref={viewportRef}
      className="relative h-full min-h-0 overflow-hidden bg-muted/10"
      data-testid="notes-canvas-view"
      tabIndex={0}
      role="application"
      aria-label={t('entityView.canvas')}
      onKeyDown={onCanvasKeyDown}
      onDoubleClick={(event) => {
        if (event.target !== event.currentTarget) return
        const dest = dailyNoteDestination()
        onCreateNote(dest.folder)
        setCanvas((prev) => ({
          ...prev,
          nodes: [
            ...prev.nodes,
            createCanvasFileCard({
              noteId: `${dest.folder}/${dest.title}`,
              title: dest.title,
              x: (event.nativeEvent.offsetX - fit.x) / fit.scale,
              y: (event.nativeEvent.offsetY - fit.y) / fit.scale,
            }),
          ],
        }))
      }}
    >
      {canvas.nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {t('notes.views.canvasEmpty')}
        </div>
      ) : null}
      <div
        className="absolute inset-0 origin-top-left"
        style={{ transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}
      >
        {canvas.nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className="absolute cursor-grab rounded-lg border border-border/60 bg-card/90 p-2 text-left text-xs shadow-thin active:cursor-grabbing"
            style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              dragRef.current = { id: node.id, dx: event.clientX - node.x * fit.scale, dy: event.clientY - node.y * fit.scale, moved: false }
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              if (!drag || drag.id !== node.id) return
              const x = (event.clientX - drag.dx) / fit.scale
              const y = (event.clientY - drag.dy) / fit.scale
              if (Math.abs(x - node.x) + Math.abs(y - node.y) > 2) drag.moved = true
              setCanvas((prev) => moveCanvasNode(prev, node.id, x, y))
            }}
            onPointerUp={() => {
              const drag = dragRef.current
              dragRef.current = null
              if (drag?.moved) return
              if (node.noteId) onOpenNote(node.noteId)
            }}
          >
            <div className="truncate font-medium">{node.text || node.file || node.id}</div>
            {node.noteId ? <div className="mt-1 font-mono text-[10px] text-muted-foreground">{node.noteId}</div> : null}
          </button>
        ))}
      </div>
      <div className="absolute bottom-3 right-3 flex gap-2">
        <Button type="button" size="sm" variant="outline" data-testid="notes-canvas-zoom-out" onClick={() => zoomBy(1 / 1.1)} title={t('menu.zoomOut')} aria-label={t('menu.zoomOut')}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="outline" data-testid="notes-canvas-zoom-in" onClick={() => zoomBy(1.1)} title={t('menu.zoomIn')} aria-label={t('menu.zoomIn')}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="outline" data-testid="notes-canvas-fit" onClick={applyFit} title={t('notes.canvas.fit')} aria-label={t('notes.canvas.fit')}>
          <ScanSearch className="h-3.5 w-3.5" />
          {t('notes.canvas.fit')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onCreateNote(dailyNoteDestination().folder)}
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          {t('notes.views.doubleClickCreate')}
        </Button>
      </div>
    </div>
  )
}

function NotesOutlineView({
  notes,
  activeNoteId,
  workspaceId,
}: {
  notes: NotesViewNote[]
  activeNoteId: string | null
  workspaceId: string
}) {
  const { t } = useTranslation()
  const active = notes.find((note) => note.id === activeNoteId) ?? notes[0]
  const storageKey = active ? notesOutlineFoldsStorageKey(workspaceId, active.id) : ''
  const [collapsedIds, setCollapsedIds] = React.useState<Set<string>>(
    () => parseOutlineFolds(typeof localStorage === 'undefined' || !storageKey ? null : localStorage.getItem(storageKey)),
  )

  React.useEffect(() => {
    setCollapsedIds(parseOutlineFolds(typeof localStorage === 'undefined' || !storageKey ? null : localStorage.getItem(storageKey)))
  }, [storageKey])

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        if (storageKey) localStorage.setItem(storageKey, serializeOutlineFolds(next))
      } catch {
        /* ignore quota */
      }
      return next
    })
  }

  const headings = active ? parseNoteDocument(active.markdown).headings : []
  const tree = active ? outlineFromHeadings(active.id, headings, collapsedIds, active.tags?.[0]) : null
  return (
    <div className="h-full overflow-y-auto p-6" data-testid="notes-outline-view">
      {tree ? (
        <OutlineTree node={tree} onToggle={toggleCollapsed} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('notes.views.outlineEmpty')}</p>
      )}
    </div>
  )
}

function NotesGraphView({
  notes,
  activeNoteId,
  onOpenNote,
}: {
  notes: NotesViewNote[]
  activeNoteId: string | null
  onOpenNote: (noteId: string) => void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = React.useState<NoteGraphEdgeKindFilter>('all')
  const [nearby, setNearby] = React.useState(Boolean(activeNoteId))
  const [limit, setLimit] = React.useState(NOTE_GRAPH_PAGE_SIZE)
  const graph = React.useMemo(() => {
    let next = notesOnlyGraph(graphFromLinks(notes))
    next = filterGraphByEdgeKind(next, kind)
    if (nearby && activeNoteId) next = isolateNoteNeighborhood(next, activeNoteId)
    return progressiveGraph(next, limit)
  }, [activeNoteId, kind, limit, nearby, notes])
  return (
    <div className="flex h-full min-h-0" data-testid="notes-graph-view">
      <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-border/50 p-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('entityView.graph')}
        </div>
        <div className="mb-3 flex flex-col gap-1" data-testid="notes-graph-kind">
          {(['all', 'wikilink', 'backlink'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={cn(
                'rounded-[5px] px-2 py-1 text-left text-[11px] hover:bg-foreground/[0.06]',
                kind === value && 'bg-foreground/[0.08]',
              )}
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value)
                setLimit(NOTE_GRAPH_PAGE_SIZE)
              }}
            >
              {value === 'all'
                ? t('notes.views.graphAll')
                : value === 'wikilink'
                  ? t('notes.views.graphWikilinks')
                  : t('notes.views.graphBacklinks')}
            </button>
          ))}
          <button
            type="button"
            className={cn(
              'rounded-[5px] px-2 py-1 text-left text-[11px] hover:bg-foreground/[0.06]',
              nearby && 'bg-foreground/[0.08]',
            )}
            aria-pressed={nearby}
            data-testid="notes-graph-nearby"
            onClick={() => {
              setNearby((prev) => !prev)
              setLimit(NOTE_GRAPH_PAGE_SIZE)
            }}
          >
            {t('notes.views.graphNearby')}
          </button>
        </div>
        {graph.nodes.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t('notes.views.graphEmpty')}</p>
        ) : (
          graph.nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className={cn(
                'mb-0.5 w-full truncate rounded-[5px] px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]',
                node.id === activeNoteId && 'bg-foreground/[0.08]',
              )}
              onClick={() => onOpenNote(node.id)}
            >
              {node.title}
            </button>
          ))
        )}
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {graph.edges.map((edge) => (
          <div key={`${edge.from}->${edge.to}:${edge.kind}`} className="mb-1 font-mono text-[11px] text-muted-foreground">
            {edge.from} → {edge.to} · {edge.kind}
          </div>
        ))}
        {graph.hidden > 0 ? (
          <button
            type="button"
            className="mt-2 rounded-[5px] border border-border/60 px-2 py-1 text-[11px] hover:bg-foreground/[0.06]"
            data-testid="notes-graph-more"
            onClick={() => setLimit((prev) => prev + NOTE_GRAPH_PAGE_SIZE)}
          >
            {t('notes.views.graphMore')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function OutlineTree({ node, onToggle }: { node: NoteOutlineNode; onToggle: (id: string) => void }) {
  return (
    <div className="pl-3">
      <div className="flex items-center gap-2 py-0.5 text-sm">
        {node.children.length > 0 ? (
          <button
            type="button"
            className="h-5 w-5 shrink-0 rounded-[4px] text-muted-foreground hover:bg-foreground/[0.06]"
            aria-expanded={!node.collapsed}
            onClick={() => onToggle(node.id)}
          >
            {node.collapsed ? '+' : '–'}
          </button>
        ) : null}
        {node.supertag ? <span className="rounded bg-foreground/10 px-1.5 text-[10px]">#{node.supertag}</span> : null}
        <span>{node.title}</span>
      </div>
      {!node.collapsed
        ? node.children.map((child) => <OutlineTree key={child.id} node={child} onToggle={onToggle} />)
        : null}
    </div>
  )
}
