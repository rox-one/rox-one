/**
 * «Доска» (Canvas) surface page: board list + editor.
 *
 * Boards live in <workspace>/canvas (main process, `canvas-ipc.ts`). The
 * editor keeps a Y.Doc in the renderer: it is seeded from main's state and
 * every local change is sent back as a Yjs update, so the renderer and the
 * persisted doc are one CRDT (and other windows receive the same updates).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import * as Y from 'yjs'
import { ArrowLeft, Circle, MousePointer2, Pencil, Plus, Square, StickyNote, Trash2, Type, ZoomIn } from 'lucide-react'
import { actorOrigin, CanvasDoc, createUndoManager, SpatialIndex, type CanvasObject } from '@rox/canvas-core'
import { Button } from '@/components/ui/button'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type { SurfacePageProps } from '@/platform/SurfaceHost'
import type { CanvasBoardSummary, CanvasBridge } from '../../../shared/types'

const MAIN_ORIGIN = 'main'
const LOCAL = actorOrigin('user', 'local')

function bridge(): CanvasBridge | undefined {
  return (window as unknown as { electronAPI?: { canvas?: CanvasBridge } }).electronAPI?.canvas
}

export function CanvasSurfacePage(_props: SurfacePageProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const [openId, setOpenId] = useState<string | null>(null)
  if (!workspace) {
    return <div className="flex h-full items-center justify-center bg-background text-text-muted" data-testid="canvas-no-workspace">{t('canvas.noWorkspace')}</div>
  }
  return openId
    ? <BoardEditor workspaceId={workspace.id} boardId={openId} onBack={() => setOpenId(null)} />
    : <BoardList workspaceId={workspace.id} onOpen={setOpenId} />
}

function BoardList({ workspaceId, onOpen }: { workspaceId: string; onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation()
  const [boards, setBoards] = useState<CanvasBoardSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try { setBoards(await bridge()!.list(workspaceId)); setError(null) } catch { setError(t('canvas.error.load')) }
  }, [workspaceId, t])
  useEffect(() => { void refresh() }, [refresh])

  const create = async () => {
    try {
      const b = await bridge()!.create(workspaceId, t('canvas.boards.untitled'))
      onOpen(b.id)
    } catch { setError(t('canvas.error.save')) }
  }
  const rename = async (id: string, title: string) => {
    setRenaming(null)
    if (!title.trim()) return
    try { await bridge()!.rename(workspaceId, id, title); await refresh() } catch { setError(t('canvas.error.save')) }
  }
  const trash = async (b: CanvasBoardSummary) => {
    if (!window.confirm(t('canvas.boards.trashConfirm', { title: b.title }))) return
    try { await bridge()!.trash(workspaceId, b.id); await refresh() } catch { setError(t('canvas.error.save')) }
  }
  const fmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }), [i18n.language])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="canvas-board-list">
      <div className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold">{t('canvas.boards.title')}</h1>
        <Button onClick={create} data-testid="canvas-new-board"><Plus />{t('canvas.boards.new')}</Button>
      </div>
      {error && <div className="mx-6 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</div>}
      {boards && boards.length === 0 && <div className="flex flex-1 items-center justify-center text-text-muted">{t('canvas.boards.empty')}</div>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 overflow-auto px-6 pb-6">
        {boards?.map(b => (
          <div key={b.id} className="group flex flex-col rounded-lg border border-border bg-foreground/[0.02] hover:bg-surface-hover" data-testid="canvas-board-card">
            <button className="h-28 rounded-t-lg bg-foreground/5 text-left" onClick={() => onOpen(b.id)} aria-label={b.title} />
            <div className="flex items-center gap-1 px-3 py-2">
              {renaming === b.id ? (
                <input autoFocus defaultValue={b.title} className="min-w-0 flex-1 rounded border border-border bg-background px-1 text-sm"
                  onBlur={e => void rename(b.id, e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }} />
              ) : (
                <button className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => onOpen(b.id)}>{b.title}</button>
              )}
              <button className="rounded p-1 text-text-muted opacity-0 hover:bg-foreground/10 group-hover:opacity-100" title={t('canvas.boards.rename')} aria-label={t('canvas.boards.rename')} onClick={() => setRenaming(b.id)}><Pencil className="size-3.5" /></button>
              <button className="rounded p-1 text-text-muted opacity-0 hover:bg-foreground/10 group-hover:opacity-100" title={t('canvas.boards.trash')} aria-label={t('canvas.boards.trash')} onClick={() => void trash(b)}><Trash2 className="size-3.5" /></button>
            </div>
            <div className="px-3 pb-2 text-xs text-text-muted">{fmt.format(b.updatedAt)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

type Tool = 'select' | 'sticky' | 'rect' | 'ellipse' | 'text'

function useBoard(workspaceId: string, boardId: string) {
  const [board, setBoard] = useState<CanvasDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const api = bridge()!
    const doc = new Y.Doc()
    let alive = true
    let offRemote = () => {}
    // Off the render path: outgoing updates are merged and sent once per frame,
    // incoming ones applied in one transaction per frame, React re-renders once per frame.
    let outbox: Uint8Array[] = []
    let inbox: Uint8Array[] = []
    let frame = 0
    const pump = () => {
      frame = 0
      if (inbox.length) {
        const merged = inbox.length === 1 ? inbox[0]! : Y.mergeUpdates(inbox)
        inbox = []
        Y.applyUpdate(doc, merged, MAIN_ORIGIN)
      }
      if (outbox.length) {
        const merged = outbox.length === 1 ? outbox[0]! : Y.mergeUpdates(outbox)
        outbox = []
        api.apply(workspaceId, boardId, merged).catch(() => setError('save'))
      }
      setVersion(v => v + 1)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(pump) }
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== MAIN_ORIGIN) outbox.push(update)
      schedule()
    }
    api.open(workspaceId, boardId).then(state => {
      if (!alive) return
      Y.applyUpdate(doc, state, MAIN_ORIGIN)
      doc.on('update', onUpdate)
      offRemote = api.onUpdate((ws, id, u) => { if (ws === workspaceId && id === boardId) { inbox.push(u); schedule() } })
      setBoard(new CanvasDoc(doc))
    }).catch(() => alive && setError('load'))
    return () => {
      alive = false
      offRemote()
      if (frame) cancelAnimationFrame(frame)
      if (outbox.length) api.apply(workspaceId, boardId, Y.mergeUpdates(outbox)).catch(() => {})
      doc.off('update', onUpdate)
      doc.destroy()
    }
  }, [workspaceId, boardId])
  return { board, error, version }
}

function BoardEditor({ workspaceId, boardId, onBack }: { workspaceId: string; boardId: string; onBack: () => void }) {
  const { t } = useTranslation()
  const { board, error, version } = useBoard(workspaceId, boardId)
  const [tool, setTool] = useState<Tool>('select')
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ kind: 'move' | 'pan'; id?: string; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const undo = useMemo(() => (board ? createUndoManager(board, LOCAL) : null), [board])
  const index = useMemo(() => (board ? new SpatialIndex(board) : null), [board])
  useEffect(() => () => index?.dispose(), [index])
  const [size, setSize] = useState({ w: 1600, h: 1000 })
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [board])
  const all = useMemo(() => board?.list() ?? [], [board, version])
  // Viewport culling: only objects whose boxes intersect the visible area (+ margin) render.
  const objects = useMemo(() => {
    if (!index) return []
    const m = 200 / view.zoom
    const visible = index.query({ minX: -view.x / view.zoom - m, minY: -view.y / view.zoom - m, maxX: (size.w - view.x) / view.zoom + m, maxY: (size.h - view.y) / view.zoom + m })
    return all.filter(o => !o.hidden && (visible.has(o.id) || o.id === selected || o.id === editing))
  }, [all, index, view, size, selected, editing])
  const title = board?.getMeta().title ?? ''

  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || !board) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { board.delete([selected], LOCAL); setSelected(null) }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) undo?.redo(); else undo?.undo() }
      if (e.key === 'Escape') { setSelected(null); setTool('select') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [board, selected, editing, undo])

  const onCanvasDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!board) return
    if (tool !== 'select') {
      const p = toWorld(e.clientX, e.clientY)
      const base = { x: p.x, y: p.y, rotation: 0 }
      const input =
        tool === 'sticky' ? { ...base, type: 'sticky', w: 180, h: 140, props: { text: '' } } :
        tool === 'text' ? { ...base, type: 'text', w: 220, h: 40, props: { text: '' } } :
        { ...base, type: 'shape', w: 160, h: 100, props: { kind: tool === 'rect' ? 'rect' : 'ellipse' } }
      const [id] = board.add([input], LOCAL)
      setSelected(id!)
      if (tool === 'sticky' || tool === 'text') setEditing(id!)
      setTool('select')
      return
    }
    setSelected(null)
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onObjectDown = (e: ReactPointerEvent, o: CanvasObject) => {
    if (tool !== 'select') return
    e.stopPropagation()
    setSelected(o.id)
    if (o.locked) return
    drag.current = { kind: 'move', id: o.id, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y }
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || !board) return
    if (d.kind === 'pan') setView(v => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy }))
    else board.update(d.id!, { x: d.ox + (e.clientX - d.sx) / view.zoom, y: d.oy + (e.clientY - d.sy) / view.zoom }, LOCAL)
  }
  const onUp = () => { drag.current = null; undo?.stopCapturing() }
  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    setView(v => {
      const zoom = Math.min(4, Math.max(0.2, v.zoom * Math.exp(-e.deltaY * 0.001)))
      return { zoom, x: mx - ((mx - v.x) * zoom) / v.zoom, y: my - ((my - v.y) * zoom) / v.zoom }
    })
  }

  const tools: Array<{ id: Tool; icon: typeof Square; label: string }> = [
    { id: 'select', icon: MousePointer2, label: t('canvas.tool.select') },
    { id: 'sticky', icon: StickyNote, label: t('canvas.tool.sticky') },
    { id: 'rect', icon: Square, label: t('canvas.tool.rect') },
    { id: 'ellipse', icon: Circle, label: t('canvas.tool.ellipse') },
    { id: 'text', icon: Type, label: t('canvas.tool.text') },
  ]
  const editingObj = editing ? all.find(o => o.id === editing) : undefined

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="canvas-editor">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="canvas-back"><ArrowLeft />{t('canvas.action.back')}</Button>
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="ml-auto text-xs text-text-muted">{t('canvas.objects', { count: all.length })}</div>
        <Button variant="ghost" size="sm" onClick={() => setView({ x: 0, y: 0, zoom: 1 })} title={t('canvas.action.resetZoom')}><ZoomIn />{Math.round(view.zoom * 100)}%</Button>
      </div>
      {error && <div className="absolute left-1/2 top-14 z-10 -translate-x-1/2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{t(error === 'load' ? 'canvas.error.load' : 'canvas.error.save')}</div>}
      <div className="absolute left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-lg border border-border bg-background p-1 shadow-sm" role="toolbar">
        {tools.map(({ id, icon: Icon, label }) => (
          <button key={id} title={label} aria-label={label} aria-pressed={tool === id} data-testid={`canvas-tool-${id}`}
            className={`rounded-md p-2 ${tool === id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-surface-hover'}`} onClick={() => setTool(id)}>
            <Icon className="size-4" />
          </button>
        ))}
        <button title={t('canvas.action.delete')} aria-label={t('canvas.action.delete')} disabled={!selected}
          className="rounded-md p-2 text-text-muted hover:bg-surface-hover disabled:opacity-40" onClick={() => { if (selected && board) { board.delete([selected], LOCAL); setSelected(null) } }}>
          <Trash2 className="size-4" />
        </button>
      </div>
      <svg ref={svgRef} className={`min-h-0 flex-1 touch-none select-none ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
        onPointerDown={onCanvasDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} data-testid="canvas-stage">
        <defs>
          <pattern id="canvas-grid" width={24 * view.zoom} height={24 * view.zoom} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={1} className="fill-foreground/15" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#canvas-grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {objects.map(o => <ObjectView key={o.id} o={o} selected={o.id === selected} onDown={e => onObjectDown(e, o)} onEdit={() => (o.type === 'sticky' || o.type === 'text') && setEditing(o.id)} />)}
        </g>
      </svg>
      {editingObj && board && (
        <textarea autoFocus defaultValue={String(editingObj.props.text ?? '')} data-testid="canvas-text-editor"
          className="absolute resize-none rounded border border-accent bg-background p-2 text-sm text-foreground outline-none"
          style={{ left: view.x + editingObj.x * view.zoom, top: view.y + editingObj.y * view.zoom + 44, width: editingObj.w * view.zoom, height: editingObj.h * view.zoom }}
          onBlur={e => { board.update(editingObj.id, { props: { text: e.currentTarget.value } }, LOCAL); setEditing(null) }}
          onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur() }} />
      )}
    </div>
  )
}

function ObjectView({ o, selected, onDown, onEdit }: { o: CanvasObject; selected: boolean; onDown: (e: ReactPointerEvent) => void; onEdit: () => void }) {
  const text = typeof o.props.text === 'string' ? o.props.text : ''
  const sel = selected ? 'stroke-accent' : 'stroke-border'
  const common = { onPointerDown: onDown, onDoubleClick: onEdit, opacity: o.opacity, 'data-object-id': o.id, 'data-object-type': o.type }
  const transform = o.rotation ? `rotate(${o.rotation} ${o.x + o.w / 2} ${o.y + o.h / 2})` : undefined
  if (o.type === 'sticky' || o.type === 'text') {
    return (
      <g {...common} transform={transform}>
        <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={o.type === 'sticky' ? 6 : 2}
          className={`${o.type === 'sticky' ? 'fill-accent/15' : 'fill-transparent'} ${sel}`} strokeWidth={selected ? 2 : o.type === 'sticky' ? 1 : 0} />
        <foreignObject x={o.x} y={o.y} width={o.w} height={o.h} pointerEvents="none">
          <div className="h-full w-full overflow-hidden whitespace-pre-wrap break-words p-2 text-sm text-foreground">{text}</div>
        </foreignObject>
      </g>
    )
  }
  if (o.type === 'shape') {
    const ellipse = o.props.kind === 'ellipse'
    return (
      <g {...common} transform={transform}>
        {ellipse
          ? <ellipse cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} className={`fill-foreground/5 ${sel}`} strokeWidth={selected ? 2 : 1.5} />
          : <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={4} className={`fill-foreground/5 ${sel}`} strokeWidth={selected ? 2 : 1.5} />}
      </g>
    )
  }
  // Types without a renderer yet (later phases) still show and stay movable.
  return (
    <g {...common} transform={transform}>
      <rect x={o.x} y={o.y} width={Math.max(o.w, 40)} height={Math.max(o.h, 24)} rx={4} className={`fill-foreground/5 ${sel}`} strokeDasharray="4 3" strokeWidth={1} />
      <text x={o.x + 6} y={o.y + 16} className="fill-text-muted text-xs">{o.type}</text>
    </g>
  )
}

export default CanvasSurfacePage
