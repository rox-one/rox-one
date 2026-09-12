import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FilePlus2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  applyNoteBaseView,
  createCanvasFileCard,
  dailyNoteDestination,
  graphFromLinks,
  outlineFromHeadings,
  parseJsonCanvas,
  projectNoteRows,
  restoreSavedViews,
  serializeJsonCanvas,
  type JsonCanvas,
  type NoteBaseView,
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
  const { t } = useTranslation()
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
        workspaceId={workspaceId}
        onOpenNote={onOpenNote}
        onCreateNote={onCreateNote}
      />
    )
  }
  if (view === 'outline') {
    const active = notes.find((note) => note.id === activeNoteId) ?? notes[0]
    const headings = active ? parseNoteDocument(active.markdown).headings : []
    const tree = active ? outlineFromHeadings(active.id, headings, new Set(), active.tags?.[0]) : null
    return (
      <div className="h-full overflow-y-auto p-6" data-testid="notes-outline-view">
        {tree ? (
          <OutlineTree node={tree} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('notes.views.outlineEmpty')}</p>
        )}
      </div>
    )
  }

  const graph = graphFromLinks(notes)
  return (
    <div className="flex h-full min-h-0" data-testid="notes-graph-view">
      <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-border/50 p-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('entityView.graph')}
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
      </div>
    </div>
  )
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
  const view = React.useMemo((): NoteBaseView => {
    const saved = restoreSavedViews(
      typeof localStorage === 'undefined' ? null : localStorage.getItem(`notes:views:${workspaceId}`),
    )[0]
    return (
      saved ?? {
        v: 1,
        id: 'vault-table',
        name: 'Vault',
        kind: 'table',
        filters: [],
        formulas: [{ name: 'open', expr: 'openTaskCount' }],
        sort: { field: 'title', dir: 'asc' },
        columns: ['title', 'folder', 'tags', 'openTasks'],
      }
    )
  }, [workspaceId])

  React.useEffect(() => {
    try {
      const key = `notes:views:${workspaceId}`
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([view]))
    } catch {
      /* ignore quota */
    }
  }, [view, workspaceId])

  const visible = applyNoteBaseView(rows, view)

  return (
    <div className="h-full overflow-auto p-4" data-testid="notes-table-view">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-2 py-1">{t('notes.views.colTitle')}</th>
            <th className="px-2 py-1">{t('notes.views.colFolder')}</th>
            <th className="px-2 py-1">{t('notes.views.colTags')}</th>
            <th className="px-2 py-1">{t('notes.views.colTasks')}</th>
            <th className="px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
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
              <td className="px-2 py-1.5">{row.openTasks}</td>
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
      </table>
      {visible.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">{t('notes.views.tableEmpty')}</p>
      ) : null}
    </div>
  )
}

function NotesCanvasView({
  notes,
  workspaceId,
  onOpenNote,
  onCreateNote,
}: {
  notes: NotesViewNote[]
  workspaceId: string
  onOpenNote: (noteId: string) => void
  onCreateNote: (folder?: string) => void
}) {
  const { t } = useTranslation()
  const storageKey = `notes:canvas:${workspaceId}:vault`
  const [canvas, setCanvas] = React.useState<JsonCanvas>(() =>
    parseJsonCanvas(typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey)),
  )

  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey, serializeJsonCanvas(canvas))
    } catch {
      /* ignore quota */
    }
  }, [canvas, storageKey])

  return (
    <div
      className="relative h-full min-h-0 bg-muted/10"
      data-testid="notes-canvas-view"
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
              x: event.nativeEvent.offsetX,
              y: event.nativeEvent.offsetY,
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
      {canvas.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          className="absolute rounded-lg border border-border/60 bg-card/90 p-2 text-left text-xs shadow-thin"
          style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
          onClick={() => node.noteId && onOpenNote(node.noteId)}
        >
          <div className="truncate font-medium">{node.text || node.file || node.id}</div>
          {node.noteId ? <div className="mt-1 font-mono text-[10px] text-muted-foreground">{node.noteId}</div> : null}
        </button>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="absolute bottom-3 right-3"
        onClick={() => onCreateNote(dailyNoteDestination().folder)}
      >
        <FilePlus2 className="h-3.5 w-3.5" />
        {t('notes.views.doubleClickCreate')}
      </Button>
    </div>
  )
}

function OutlineTree({ node }: { node: ReturnType<typeof outlineFromHeadings> }) {
  const [collapsed, setCollapsed] = React.useState(node.collapsed)
  return (
    <div className="pl-3">
      <div className="flex items-center gap-2 py-0.5 text-sm">
        {node.children.length > 0 ? (
          <button
            type="button"
            className="h-5 w-5 shrink-0 rounded-[4px] text-muted-foreground hover:bg-foreground/[0.06]"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? '+' : '–'}
          </button>
        ) : null}
        {node.supertag ? <span className="rounded bg-foreground/10 px-1.5 text-[10px]">#{node.supertag}</span> : null}
        <span>{node.title}</span>
      </div>
      {!collapsed
        ? node.children.map((child) => <OutlineTree key={child.id} node={child} />)
        : null}
    </div>
  )
}
