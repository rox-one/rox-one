/**
 * «Доска» (Canvas) surface page: contextual sidebar + board list + editor.
 *
 * Boards live in <workspace>/canvas (main process, `canvas-ipc.ts`). The
 * editor keeps a Y.Doc in the renderer seeded from main's state; local changes
 * go back as Yjs updates, main forwards every change (incl. its own, e.g.
 * rename) to the other renderers that have the board open.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import * as Y from 'yjs'
import { ArrowLeft, Circle, Clock, LayoutGrid, Link2, Minus, MousePointer2, Pencil, Plus, RotateCcw, Search, Share2, Square, Star, StickyNote, Trash2, Type, ZoomIn } from 'lucide-react'
import {
  actorOrigin, CanvasDoc, createUndoManager, guardEntityCards, linkEntityCard, removeEntityCards, SpatialIndex, watchEntityLinks,
  type CanvasObject, type EntityCardContext, type EntityRef, type ResolvedEntity,
} from '@rox/canvas-core'
import { ENTITY_KINDS, kindDescriptor, type EntityKind } from '@rox/core/entities'
import {
  CREATABLE_KINDS, createEntity, createEntityLinker, createEntityRegistry, createPreviewBatcher, seedCreatedCardPreview, watchEntityChanges, deleteEntity, EntitySnapshotResolver, searchExisting, unlinkMyBoardLinks, relinkMyBoardLinks, canDeleteCardEntity, type CreatableKind,
} from './entity-wiring'
import { onCanvasTarget, takeCanvasTarget, type CanvasTarget } from './canvas-target'
import { resizeRotated } from './geometry'
import {
  isTinyStroke, lineFromEndpoints, pushStrokeSample, readPoints, scaleLocalPoints, strokeBounds,
  toPolylineAttr, toSmoothPath,
} from './ink-path'
import { bindTextArea } from './live-text'
import { StyleInspector } from './StyleInspector'
import { applyStyleField, type FieldValue, type StyleField } from './style-model'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { ShellSidebarPortal } from '@/components/app-shell/ShellSidebarPortal'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type { SurfacePageProps } from '@/platform/SurfaceHost'
import type { CanvasBoardSummary, CanvasBridge, CanvasTrashedBoard } from '../../../shared/types'

const MAIN_ORIGIN = 'main'
const LOCAL = actorOrigin('user', 'local')
/** MIME for dragging an entity ref onto the board (picker list, other surfaces). */
export const ENTITY_DRAG_MIME = 'application/x-rox-entity'

function bridge(): CanvasBridge | undefined {
  return (window as unknown as { electronAPI?: { canvas?: CanvasBridge } }).electronAPI?.canvas
}

/** Parse a dropped entity: JSON `{kind,id}` (our MIME) or a `kind:id` / route-ish text. */
export function parseEntityDrop(data: { mime?: string; text?: string }): EntityRef | null {
  const known = new Set<string>(ENTITY_KINDS)
  try {
    if (data.mime) {
      const v = JSON.parse(data.mime) as { kind?: unknown; id?: unknown }
      if (typeof v.kind === 'string' && typeof v.id === 'string' && known.has(v.kind) && v.id) return { kind: v.kind, id: v.id }
    }
  } catch { /* fall through */ }
  const m = /^([a-z][a-z-]*):([^\s:]+)$/.exec(data.text?.trim() ?? '')
  return m && known.has(m[1]!) ? { kind: m[1]!, id: m[2]! } : null
}

const lsGet = (k: string): string[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] } }
const lsSet = (k: string, v: string[]) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* quota */ } }
export const pushRecent = (list: string[], id: string, max = 8) => [id, ...list.filter(x => x !== id)].slice(0, max)

export function CanvasSurfacePage(_props: SurfacePageProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const [target, setTarget] = useState<CanvasTarget | null>(() => takeCanvasTarget())
  const [openId, setOpenId] = useState<string | null>(target?.boardId ?? null)
  useEffect(() => onCanvasTarget(() => { const tg = takeCanvasTarget(); if (tg) { setTarget(tg); setOpenId(tg.boardId) } }), [])
  if (!workspace) {
    return <div data-glass-slot="empty" className="flex h-full items-center justify-center bg-background text-text-muted" data-testid="canvas-no-workspace">{t('canvas.noWorkspace')}</div>
  }
  return <CanvasWorkspace key={workspace.id} workspaceId={workspace.id} openId={openId} setOpenId={id => { setTarget(null); setOpenId(id) }} focusObjectId={target?.boardId === openId ? target?.objectId : undefined} />
}

function CanvasWorkspace({ workspaceId, openId, setOpenId, focusObjectId }: { workspaceId: string; openId: string | null; setOpenId: (id: string | null) => void; focusObjectId?: string }) {
  const { t } = useTranslation()
  const [boards, setBoards] = useState<CanvasBoardSummary[] | null>(null)
  const [trashed, setTrashed] = useState<CanvasTrashedBoard[]>([])
  const [error, setError] = useState<string | null>(null)
  const favKey = `rox.canvas.fav.${workspaceId}`, recentKey = `rox.canvas.recent.${workspaceId}`
  const [favs, setFavs] = useState(() => lsGet(favKey))
  const [recent, setRecent] = useState(() => lsGet(recentKey))
  const refresh = useCallback(async () => {
    try {
      const api = bridge()!
      const [b, tr] = await Promise.all([api.list(workspaceId), api.listTrash(workspaceId).catch(() => [])])
      setBoards(b); setTrashed(tr); setError(null)
    } catch { setError(t('canvas.error.load')) }
  }, [workspaceId, t])
  useEffect(() => { void refresh() }, [refresh, openId])
  useEffect(() => { if (openId) setRecent(r => { const n = pushRecent(r, openId); lsSet(recentKey, n); return n }) }, [openId, recentKey])
  const toggleFav = (id: string) => setFavs(f => { const n = f.includes(id) ? f.filter(x => x !== id) : [...f, id]; lsSet(favKey, n); return n })
  const trash = async (b: CanvasBoardSummary) => {
    if (!window.confirm(t('canvas.boards.trashConfirm', { title: b.title }))) return
    try {
      // Our own embeds links from this board go first (others' stay; reconcile never touches them).
      await unlinkMyBoardLinks(createEntityLinker(workspaceId), b.id, workspaceId).catch(e => console.warn('[canvas] unlink on trash', e))
      await bridge()!.trash(workspaceId, b.id)
      if (openId === b.id) setOpenId(null)
      await refresh()
    } catch { setError(t('canvas.error.save')) }
  }
  const restore = async (b: CanvasTrashedBoard) => {
    try { await bridge()!.restore(workspaceId, b.id, b.stamp); await refresh() } catch { setError(t('canvas.error.save')); return }
    // Re-link this user's own cards that were unlinked when the board was trashed.
    try {
      const api = bridge()!
      const doc = new Y.Doc()
      Y.applyUpdate(doc, await api.open(workspaceId, b.id), MAIN_ORIGIN)
      await api.close(workspaceId, b.id).catch(() => {})
      const restored = new CanvasDoc(doc)
      const reg = createEntityRegistry(workspaceId)
      await relinkMyBoardLinks(createEntityLinker(workspaceId), workspaceId, b.id, {
        cardExists: (id, ref) => { const o = restored.get(id); return !!o && o.type === 'entity' && String(o.props.kind) === ref.kind && String(o.props.entityId) === ref.id },
        canView: async ref => { const a = reg.get(ref.kind); return !!a && (a.canView ? a.canView(ref) : true) },
      })
      doc.destroy()
    } catch (e) { console.warn('[canvas] relink on restore', e) }
  }
  return (
    <>
      <CanvasSidebar boards={boards ?? []} trashed={trashed} favs={favs} recent={recent} openId={openId} onOpen={setOpenId} onRestore={b => void restore(b)} />
      {openId
        ? <BoardEditor workspaceId={workspaceId} boardId={openId} focusObjectId={focusObjectId} onBack={() => setOpenId(null)} />
        : <BoardList workspaceId={workspaceId} boards={boards} error={error} setError={setError} favs={favs} onToggleFav={toggleFav} onOpen={setOpenId} onTrash={b => void trash(b)} refresh={refresh} />}
    </>
  )
}

function CanvasSidebar({ boards, trashed, favs, recent, openId, onOpen, onRestore }: {
  boards: CanvasBoardSummary[]; trashed: CanvasTrashedBoard[]; favs: string[]; recent: string[]; openId: string | null
  onOpen: (id: string | null) => void; onRestore: (b: CanvasTrashedBoard) => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const byId = new Map(boards.map(b => [b.id, b]))
  const match = (title: string) => !q.trim() || title.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())
  const row = (b: CanvasBoardSummary, testid: string) => (
    <button key={`${testid}-${b.id}`} data-testid={testid} onClick={() => onOpen(b.id)} aria-current={openId === b.id ? 'page' : undefined} data-glass-slot="row" data-state={openId === b.id ? 'selected' : undefined}
      className={`flex w-full items-center gap-2 truncate rounded-md px-2 py-1 text-left text-sm ${openId === b.id ? 'bg-accent/15 text-accent' : 'text-foreground hover:bg-surface-hover'}`}>
      <span className="truncate">{b.title}</span>
    </button>
  )
  const section = (icon: React.ReactNode, label: string, body: React.ReactNode, testid: string) => (
    <div className="mt-2" data-testid={testid}>
      <div className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium uppercase tracking-wide text-text-muted">{icon}{label}</div>
      {body}
    </div>
  )
  const empty = (s: string) => <div className="px-2 py-1 text-xs text-text-muted">{s}</div>
  const favBoards = favs.map(id => byId.get(id)).filter((b): b is CanvasBoardSummary => !!b && match(b.title))
  const recentBoards = recent.map(id => byId.get(id)).filter((b): b is CanvasBoardSummary => !!b && match(b.title))
  return (
    <ShellSidebarPortal className="hidden" data-testid="canvas-sidebar">
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
        <Search className="icon-caption text-text-muted" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('canvas.sidebar.search')} aria-label={t('canvas.sidebar.search')}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none" data-testid="canvas-sidebar-search" />
      </div>
      {section(<LayoutGrid className="icon-caption" />, t('canvas.sidebar.all'), <>
        <button data-glass-slot="row" data-state={openId === null ? 'selected' : undefined} className={`w-full rounded-md px-2 py-1 text-left text-sm ${openId === null ? 'bg-accent/15 text-accent' : 'hover:bg-surface-hover'}`} onClick={() => onOpen(null)}>{t('canvas.boards.title')}</button>
        {boards.filter(b => match(b.title)).map(b => row(b, 'canvas-sidebar-board'))}
      </>, 'canvas-sidebar-all')}
      {section(<Star className="icon-caption" />, t('canvas.sidebar.favorites'), favBoards.length ? favBoards.map(b => row(b, 'canvas-sidebar-fav')) : empty(t('canvas.sidebar.favoritesEmpty')), 'canvas-sidebar-favorites')}
      {section(<Clock className="icon-caption" />, t('canvas.sidebar.recent'), recentBoards.length ? recentBoards.map(b => row(b, 'canvas-sidebar-recent')) : empty(t('canvas.sidebar.recentEmpty')), 'canvas-sidebar-recent')}
      {section(<Share2 className="icon-caption" />, t('canvas.sidebar.shared'), empty(t('canvas.sidebar.sharedEmpty')), 'canvas-sidebar-shared')}
      {section(<Trash2 className="icon-caption" />, t('canvas.sidebar.trash'), trashed.filter(b => match(b.title)).length
        ? trashed.filter(b => match(b.title)).map(b => (
          <div key={`${b.id}-${b.stamp}`} className="group flex items-center gap-1 px-2 py-1 text-sm text-text-muted" data-testid="canvas-sidebar-trashed">
            <span className="min-w-0 flex-1 truncate">{b.title}</span>
            <Tip label={t('canvas.sidebar.restore')}><button className="rounded p-0.5 hover:bg-surface-hover" aria-label={t('canvas.sidebar.restore')} onClick={() => onRestore(b)}><RotateCcw className="icon-caption" /></button></Tip>
          </div>))
        : empty(t('canvas.sidebar.trashEmpty')), 'canvas-sidebar-trash')}
    </ShellSidebarPortal>
  )
}

function BoardList({ workspaceId, boards, error, setError, favs, onToggleFav, onOpen, onTrash, refresh }: {
  workspaceId: string; boards: CanvasBoardSummary[] | null; error: string | null; setError: (e: string | null) => void
  favs: string[]; onToggleFav: (id: string) => void; onOpen: (id: string) => void; onTrash: (b: CanvasBoardSummary) => void; refresh: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const [renaming, setRenaming] = useState<string | null>(null)
  const create = async () => {
    try { const b = await bridge()!.create(workspaceId, t('canvas.boards.untitled')); onOpen(b.id) } catch { setError(t('canvas.error.save')) }
  }
  const rename = async (id: string, title: string) => {
    setRenaming(null)
    if (!title.trim()) return
    try { await bridge()!.rename(workspaceId, id, title); await refresh() } catch { setError(t('canvas.error.save')) }
  }
  const fmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }), [i18n.language])
  const iconBtn = 'rounded p-1 text-text-muted opacity-0 hover:bg-surface-hover group-hover:opacity-100 focus-visible:opacity-100'
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="canvas-board-list">
      <div className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold">{t('canvas.boards.title')}</h1>
        <Button onClick={create} data-testid="canvas-new-board"><Plus />{t('canvas.boards.new')}</Button>
      </div>
      {error && <div className="mx-6 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</div>}
      {boards && boards.length === 0 && <div data-glass-slot="empty" className="flex flex-1 items-center justify-center text-text-muted">{t('canvas.boards.empty')}</div>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 overflow-auto px-6 pb-6">
        {boards?.map(b => (
          <div key={b.id} data-glass-slot="card" className="group flex flex-col rounded-lg border border-border bg-surface-hover/40 hover:bg-surface-hover" data-testid="canvas-board-card">
            <button className="h-28 rounded-t-lg bg-surface-selected text-left" onClick={() => onOpen(b.id)} aria-label={b.title} />
            <div className="flex items-center gap-1 px-3 py-2">
              {renaming === b.id ? (
                <input autoFocus defaultValue={b.title} className="min-w-0 flex-1 rounded border border-border bg-background px-1 text-sm"
                  onBlur={e => void rename(b.id, e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }} />
              ) : (
                <button className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => onOpen(b.id)}>{b.title}</button>
              )}
              <Tip label={t(favs.includes(b.id) ? 'canvas.sidebar.unfavorite' : 'canvas.sidebar.favorite')}><button className={favs.includes(b.id) ? 'rounded p-1 text-accent' : iconBtn}
                aria-label={t(favs.includes(b.id) ? 'canvas.sidebar.unfavorite' : 'canvas.sidebar.favorite')} aria-pressed={favs.includes(b.id)} onClick={() => onToggleFav(b.id)} data-testid="canvas-board-fav">
                <Star className={`icon-caption ${favs.includes(b.id) ? 'fill-current' : ''}`} />
              </button></Tip>
              <Tip label={t('canvas.boards.rename')}><button className={iconBtn} aria-label={t('canvas.boards.rename')} onClick={() => setRenaming(b.id)}><Pencil className="icon-caption" /></button></Tip>
              <Tip label={t('canvas.boards.trash')}><button className={iconBtn} aria-label={t('canvas.boards.trash')} onClick={() => onTrash(b)}><Trash2 className="icon-caption" /></button></Tip>
            </div>
            <div className="px-3 pb-2 text-xs text-text-muted">{fmt.format(b.updatedAt)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

type Tool = 'select' | 'sticky' | 'rect' | 'ellipse' | 'text' | 'line' | 'ink'

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
    // Listen before opening: updates main forwards between subscribing us and the
    // open reply resolving would otherwise be lost (Yjs dedupes overlap with `state`).
    let loaded = false
    offRemote = api.onUpdate((ws, id, u) => { if (ws === workspaceId && id === boardId) { inbox.push(u); if (loaded) schedule() } })
    api.open(workspaceId, boardId).then(state => {
      if (!alive) return
      Y.applyUpdate(doc, state, MAIN_ORIGIN)
      doc.on('update', onUpdate)
      loaded = true
      if (inbox.length) schedule()
      setBoard(new CanvasDoc(doc))
    }).catch(() => alive && setError('load'))
    return () => {
      alive = false
      offRemote()
      if (frame) cancelAnimationFrame(frame)
      if (outbox.length) api.apply(workspaceId, boardId, Y.mergeUpdates(outbox)).catch(() => {})
      doc.off('update', onUpdate)
      void api.close?.(workspaceId, boardId).catch(() => {})
      doc.destroy()
    }
  }, [workspaceId, boardId])
  return { board, error, version }
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'move'; id: string; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'resize'; id: string; corner: 'nw' | 'ne' | 'sw' | 'se'; sx: number; sy: number; rotation: number; o: { x: number; y: number; w: number; h: number }; points?: number[] }
  | { kind: 'rotate'; id: string; cx: number; cy: number }
  | { kind: 'draw-line'; id: string; x0: number; y0: number; undoLen: number }
  | { kind: 'draw-ink'; id: string; undoLen: number; abs: number[] }

export { resizeBox } from './geometry'

function BoardEditor({ workspaceId, boardId, focusObjectId, onBack }: { workspaceId: string; boardId: string; focusObjectId?: string; onBack: () => void }) {
  const { t } = useTranslation()
  const { board, error, version } = useBoard(workspaceId, boardId)
  const [tool, setTool] = useState<Tool>('select')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [picker, setPicker] = useState(false)
  const [cardDelete, setCardDelete] = useState<CanvasObject | null>(null)
  /** 'Delete entity' only for cards this user created on this board (link createdBy === me). */
  const [cardDeleteAllowed, setCardDeleteAllowed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const undo = useMemo(() => (board ? createUndoManager(board, LOCAL) : null), [board])
  useEffect(() => () => { if (undo) undo.captureTimeout = 400 }, [undo])
  const index = useMemo(() => (board ? new SpatialIndex(board) : null), [board])
  useEffect(() => () => index?.dispose(), [index])
  // Entity cards: doc holds only {kind, entityId, origin}; previews batched per frame, per viewer.
  const batcher = useMemo(() => createPreviewBatcher(workspaceId), [workspaceId])
  const registry = useMemo(() => createEntityRegistry(workspaceId, batcher), [workspaceId, batcher])
  const resolver = useMemo(() => new EntitySnapshotResolver(registry), [registry])
  const linker = useMemo(() => createEntityLinker(workspaceId), [workspaceId])
  useEffect(() => {
    setCardDeleteAllowed(false)
    if (!cardDelete) return
    let alive = true
    void canDeleteCardEntity(linker, boardId, cardDelete).then(ok => { if (alive) setCardDeleteAllowed(ok) })
    return () => { alive = false }
  }, [cardDelete, linker, boardId])
  const [resolved, setResolved] = useState<Record<string, ResolvedEntity>>({})
  useEffect(() => {
    const off = resolver.onChange((k, r) => setResolved(prev => ({ ...prev, [k]: r })))
    return () => { off(); resolver.dispose() }
  }, [resolver])
  const ctx = useMemo<EntityCardContext | null>(() => (board ? { board, boardId, workspaceId, registry, linker, origin: LOCAL } : null), [board, boardId, workspaceId, registry, linker])
  useEffect(() => {
    if (!board || !ctx) return
    const unguard = guardEntityCards(board)
    let watch: { stop(): void } | null = null, alive = true
    // Our actor id comes from the server's auth context; until it is known nothing counts as "mine".
    void linker.ready().then(() => {
      if (!alive) return
      watch = watchEntityLinks(ctx, { debounceMs: 250, onError: e => console.warn('[canvas] entity links', e) })
    })
    return () => { alive = false; watch?.stop(); unguard() }
  }, [board, ctx, linker])
  // Entity changes elsewhere in Rox: drop cached previews and re-resolve every card on this board.
  useEffect(() => {
    if (!board) return
    return watchEntityChanges(workspaceId, batcher, () => {
      for (const o of board.list()) {
        if (o.type !== 'entity') continue
        const ref = { kind: String(o.props.kind), id: String(o.props.entityId) }
        resolver.invalidate(ref)
        void resolver.resolve(ref)
      }
    })
  }, [board, workspaceId, batcher, resolver])
  const [size, setSize] = useState({ w: 1600, h: 1000 })
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [board])
  const all = useMemo(() => board?.list() ?? [], [board, version])
  // Deep link `canvas/board/{id}#{objectId}`: select + center the fragment object once it exists.
  const focused = useRef<string | null>(null)
  useEffect(() => {
    if (!board || !focusObjectId || focused.current === focusObjectId) return
    const o = board.get(focusObjectId)
    if (!o) return
    focused.current = focusObjectId
    setSelectedIds([o.id])
    setView(v => ({ ...v, x: size.w / 2 - (o.x + o.w / 2) * v.zoom, y: size.h / 2 - (o.y + o.h / 2) * v.zoom }))
  }, [board, focusObjectId, version, size])
  const objects = useMemo(() => {
    if (!index) return []
    const m = 200 / view.zoom
    const visible = index.query({ minX: -view.x / view.zoom - m, minY: -view.y / view.zoom - m, maxX: (size.w - view.x) / view.zoom + m, maxY: (size.h - view.y) / view.zoom + m })
    const sel = new Set(selectedIds)
    return all.filter(o => !o.hidden && (visible.has(o.id) || sel.has(o.id) || o.id === editing))
  }, [all, index, view, size, selectedIds, editing])
  const title = board?.getMeta().title ?? ''
  useEffect(() => {
    for (const o of objects) if (o.type === 'entity') {
      const ref = { kind: String(o.props.kind), id: String(o.props.entityId) }
      if (!resolver.get(ref)) void resolver.resolve(ref)
    }
  }, [objects, resolver])

  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom }
  }
  const center = () => ({ x: (size.w / 2 - view.x) / view.zoom - 120, y: (size.h / 2 - view.y) / view.zoom - 60 })
  const requestDelete = (id: string) => {
    const o = board?.get(id)
    if (!o || !board) return
    if (o.type === 'entity') { setCardDelete(o); return }
    board.delete([id], LOCAL)
    setSelectedIds([])
  }
  const placeRef = async (ref: EntityRef, at = center()) => {
    if (!ctx) return
    try { const id = await linkEntityCard(ctx, ref, at); setSelectedIds([id]) } catch (e) { console.warn('[canvas] link', e); setNotice(t('canvas.picker.failed')) }
  }
  const createAndPlace = async (kind: CreatableKind, name: string) => {
    if (!ctx) return
    let ref: EntityRef | null = null
    const title = name.trim() || t('canvas.boards.untitled')
    try {
      ref = await createEntity(workspaceId, kind, title)
      // Paint the real title immediately — entitiesResolve often returns
      // `unavailable` (no note owner resolver), which used to show «Удалено».
      seedCreatedCardPreview(batcher, ref, title)
      resolver.invalidate(ref)
      const id = await linkEntityCard(ctx, ref, center())
      setSelectedIds([id])
      setPicker(false)
      void resolver.resolve(ref)
    } catch (e) {
      console.warn('[canvas] create', e)
      // The entity only existed for this card: don't leave an orphan behind.
      if (ref) await deleteEntity(workspaceId, ref).catch(() => {})
      setNotice(t('canvas.picker.failed'))
    }
  }
  const confirmCardDelete = async (deleteEntities: boolean) => {
    const o = cardDelete
    if (!o || !ctx) { setCardDelete(null); return }
    if (deleteEntities) {
      if (!cardDeleteAllowed) return
      const ref = { kind: String(o.props.kind), id: String(o.props.entityId) }
      const r = resolver.get(ref)
      const title = r?.state === 'ok' ? r.snapshot.title : ref.id
      if (!window.confirm(t('canvas.cardDelete.confirmDelete', { title }))) return
    }
    setCardDelete(null)
    setSelectedIds([])
    try { await removeEntityCards(ctx, [o.id], { deleteEntities }) } catch (e) { console.warn('[canvas] card delete', e); setNotice(t('canvas.error.save')) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || !board || cardDelete) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length) {
        // Entity cards keep the confirm dialog (one at a time); plain objects delete as a batch.
        const entities = selectedIds.map(id => board.get(id)).filter((o): o is NonNullable<typeof o> => !!o && o.type === 'entity')
        const plain = selectedIds.filter(id => { const o = board.get(id); return o && o.type !== 'entity' })
        if (entities.length === 1 && plain.length === 0) requestDelete(entities[0]!.id)
        else if (plain.length) {
          board.delete(plain, LOCAL)
          setSelectedIds(ids => ids.filter(id => !plain.includes(id)))
        } else if (entities[0]) requestDelete(entities[0].id)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) undo?.redo(); else undo?.undo() }
      if (e.key === 'Escape') { setSelectedIds([]); setTool('select'); setPicker(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onCanvasDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!board) return
    if (tool === 'line' || tool === 'ink') {
      const p = toWorld(e.clientX, e.clientY)
      const stroke = { stroke: { color: 'currentColor', width: 2 } }
      // Capture stack length BEFORE add: post-add undoLen makes tiny-stroke rollback a no-op
      // when add+updates merge into one UndoManager item (default captureTimeout 400).
      const undoLen = undo?.undoStack.length ?? 0
      // Keep the whole gesture in one undo item even if the pointer pauses mid-stroke.
      if (undo) undo.captureTimeout = 60_000
      if (tool === 'line') {
        const b = lineFromEndpoints(p.x, p.y, p.x, p.y)
        const [id] = board.add([{ type: 'line', x: b.x, y: b.y, w: b.w, h: b.h, rotation: 0, style: stroke, props: { points: b.points } }], LOCAL)
        setSelectedIds([id!])
        drag.current = { kind: 'draw-line', id: id!, x0: p.x, y0: p.y, undoLen }
      } else {
        const abs = [p.x, p.y]
        const b = strokeBounds(abs)
        const [id] = board.add([{ type: 'ink', x: b.x, y: b.y, w: b.w, h: b.h, rotation: 0, style: stroke, props: { points: b.points } }], LOCAL)
        setSelectedIds([id!])
        drag.current = { kind: 'draw-ink', id: id!, undoLen, abs }
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (tool !== 'select') {
      const p = toWorld(e.clientX, e.clientY)
      const base = { x: p.x, y: p.y, rotation: 0 }
      const input =
        tool === 'sticky' ? { ...base, type: 'sticky', w: 180, h: 140, props: { text: '' } } :
        tool === 'text' ? { ...base, type: 'text', w: 220, h: 40, props: { text: '' } } :
        { ...base, type: 'shape', w: 160, h: 100, props: { kind: tool === 'rect' ? 'rect' : 'ellipse' } }
      const [id] = board.add([input], LOCAL)
      setSelectedIds([id!])
      if (tool === 'sticky' || tool === 'text') setEditing(id!)
      setTool('select')
      return
    }
    setSelectedIds([])
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onObjectDown = (e: ReactPointerEvent, o: CanvasObject) => {
    if (tool !== 'select') return
    e.stopPropagation()
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    if (additive) {
      setSelectedIds(ids => ids.includes(o.id) ? ids.filter(id => id !== o.id) : [...ids, o.id])
      return // additive click does not start a move
    }
    setSelectedIds([o.id])
    if (o.locked) return
    drag.current = { kind: 'move', id: o.id, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y }
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onHandleDown = (e: ReactPointerEvent, o: CanvasObject, h: 'nw' | 'ne' | 'sw' | 'se' | 'rotate') => {
    e.stopPropagation()
    if (o.locked) return
    drag.current = h === 'rotate'
      ? { kind: 'rotate', id: o.id, cx: o.x + o.w / 2, cy: o.y + o.h / 2 }
      : {
          kind: 'resize', id: o.id, corner: h, sx: e.clientX, sy: e.clientY, rotation: o.rotation ?? 0,
          o: { x: o.x, y: o.y, w: o.w, h: o.h },
          points: (o.type === 'line' || o.type === 'ink') ? readPoints(o.props) : undefined,
        }
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || !board) return
    if (d.kind === 'pan') setView(v => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy }))
    else if (d.kind === 'move') board.update(d.id, { x: d.ox + (e.clientX - d.sx) / view.zoom, y: d.oy + (e.clientY - d.sy) / view.zoom }, LOCAL)
    else if (d.kind === 'resize') {
      const minSize = d.points && d.points.length >= 2 ? 1 : undefined
      const box = resizeRotated(d.o, d.rotation, d.corner, (e.clientX - d.sx) / view.zoom, (e.clientY - d.sy) / view.zoom, minSize)
      if (d.points && d.points.length >= 2) {
        board.update(d.id, { ...box, props: { points: scaleLocalPoints(d.points, d.o, box) } }, LOCAL)
      } else {
        board.update(d.id, box, LOCAL)
      }
    } else if (d.kind === 'draw-line') {
      const p = toWorld(e.clientX, e.clientY)
      const b = lineFromEndpoints(d.x0, d.y0, p.x, p.y)
      board.update(d.id, { x: b.x, y: b.y, w: b.w, h: b.h, props: { points: b.points } }, LOCAL)
    } else if (d.kind === 'draw-ink') {
      const p = toWorld(e.clientX, e.clientY)
      // Mutate the gesture buffer in place — re-reading Yjs + spreading every move is O(n²).
      if (!pushStrokeSample(d.abs, p.x, p.y)) return
      const b = strokeBounds(d.abs)
      board.update(d.id, { x: b.x, y: b.y, w: b.w, h: b.h, props: { points: b.points } }, LOCAL)
    } else {
      const p = toWorld(e.clientX, e.clientY)
      let deg = (Math.atan2(p.y - d.cy, p.x - d.cx) * 180) / Math.PI + 90
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      board.update(d.id, { rotation: ((deg % 360) + 360) % 360 }, LOCAL)
    }
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d && (d.kind === 'draw-line' || d.kind === 'draw-ink')) {
      if (undo) undo.captureTimeout = 400
      if (!board) { undo?.stopCapturing(); setTool('select'); return }
      const o = board.get(d.id)
      const pts = o ? readPoints(o.props) : []
      undo?.stopCapturing()
      if (!o || isTinyStroke(o, pts.length / 2)) {
        // Roll back the in-progress stroke so Undo is not left with a stub.
        while (undo && undo.undoStack.length > d.undoLen) undo.undo()
        // undo() parks the stub on redoStack — clear it or Ctrl+Shift+Z cannot resurrect crumbs.
        undo?.clear(false, true)
        setSelectedIds([])
      } else {
        setSelectedIds([d.id])
      }
      setTool('select')
      return
    }
    undo?.stopCapturing()
  }
  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    setView(v => {
      const zoom = Math.min(4, Math.max(0.2, v.zoom * Math.exp(-e.deltaY * 0.001)))
      return { zoom, x: mx - ((mx - v.x) * zoom) / v.zoom, y: my - ((my - v.y) * zoom) / v.zoom }
    })
  }
  const onDrop = (e: React.DragEvent) => {
    const ref = parseEntityDrop({ mime: e.dataTransfer.getData(ENTITY_DRAG_MIME), text: e.dataTransfer.getData('text/plain') })
    if (!ref) return
    e.preventDefault()
    void placeRef(ref, toWorld(e.clientX, e.clientY))
  }

  const tools: Array<{ id: Tool; icon: typeof Square; label: string }> = [
    { id: 'select', icon: MousePointer2, label: t('canvas.tool.select') },
    { id: 'sticky', icon: StickyNote, label: t('canvas.tool.sticky') },
    { id: 'rect', icon: Square, label: t('canvas.tool.rect') },
    { id: 'ellipse', icon: Circle, label: t('canvas.tool.ellipse') },
    { id: 'text', icon: Type, label: t('canvas.tool.text') },
    { id: 'line', icon: Minus, label: t('canvas.tool.line') },
    { id: 'ink', icon: Pencil, label: t('canvas.tool.ink') },
  ]
  const editingObj = editing ? all.find(o => o.id === editing) : undefined
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedObjects = useMemo(() => all.filter(o => selectedSet.has(o.id)), [all, selectedSet])
  const selectedObj = selectedObjects.length === 1 ? selectedObjects[0] : undefined
  const onStyleChange = (field: StyleField, value: FieldValue) => {
    if (!board || selectedIds.length === 0) return
    applyStyleField(board, selectedIds, field, value, LOCAL)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="canvas-editor">
      <div data-glass-slot="toolbar" className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="canvas-back"><ArrowLeft />{t('canvas.action.back')}</Button>
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="ml-auto text-xs text-text-muted">{t('canvas.objects', { count: all.length })}</div>
        <Tip label={t('canvas.action.resetZoom')}><Button variant="ghost" size="sm" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}><ZoomIn />{Math.round(view.zoom * 100)}%</Button></Tip>
      </div>
      {/* Stage container: overlays (text editor, picker) are positioned relative to it, so no header offset is assumed. */}
      <div className="relative min-h-0 flex-1" data-testid="canvas-stage-wrap">
        {(error || notice) && <div className="absolute left-1/2 top-3 z-chrome -translate-x-1/2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" onClick={() => setNotice(null)}>{notice ?? t(error === 'load' ? 'canvas.error.load' : 'canvas.error.save')}</div>}
        <div data-glass-slot="toolbar" className="absolute left-3 top-1/2 z-sticky flex -translate-y-1/2 flex-col gap-1 rounded-lg border border-border bg-background p-1 shadow-sm" role="toolbar">
          {tools.map(({ id, icon: Icon, label }) => (
            <button key={id} title={label} aria-label={label} aria-pressed={tool === id} data-testid={`canvas-tool-${id}`}
              className={`rounded-md p-2 ${tool === id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-surface-hover'}`} onClick={() => setTool(id)}>
              <Icon className="icon-toolbar" />
            </button>
          ))}
          <Tip label={t('canvas.tool.entity')}><button aria-label={t('canvas.tool.entity')} aria-pressed={picker} data-testid="canvas-tool-entity"
            className={`rounded-md p-2 ${picker ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-surface-hover'}`} onClick={() => setPicker(p => !p)}>
            <Link2 className="icon-toolbar" />
          </button></Tip>
          <Tip label={t('canvas.action.delete')}><button aria-label={t('canvas.action.delete')} disabled={selectedIds.length === 0}
            className="rounded-md p-2 text-text-muted hover:bg-surface-hover disabled:opacity-40" onClick={() => {
              if (selectedIds.length === 1) requestDelete(selectedIds[0]!)
              else if (selectedIds.length > 1 && board) {
                const plain = selectedIds.filter(id => board.get(id)?.type !== 'entity')
                if (plain.length) { board.delete(plain, LOCAL); setSelectedIds(ids => ids.filter(id => !plain.includes(id))) }
                else if (selectedIds[0]) requestDelete(selectedIds[0])
              }
            }}>
            <Trash2 className="icon-toolbar" />
          </button></Tip>
        </div>
        <svg ref={svgRef} className={`h-full w-full touch-none select-none ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
          onPointerDown={onCanvasDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
          onDragOver={e => { if ([...e.dataTransfer.types].some(x => x === ENTITY_DRAG_MIME || x === 'text/plain')) e.preventDefault() }} onDrop={onDrop} data-testid="canvas-stage">
          <defs>
            <pattern id="canvas-grid" width={24 * view.zoom} height={24 * view.zoom} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
              <circle cx={1} cy={1} r={1} className="fill-border-strong" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#canvas-grid)" />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
            {objects.map(o => o.type === 'entity'
              ? <EntityCardView key={o.id} o={o} selected={selectedSet.has(o.id)} r={resolved[`${String(o.props.kind)}:${String(o.props.entityId)}`]}
                  onDown={e => onObjectDown(e, o)} onOpen={() => registry.get(String(o.props.kind))?.open({ kind: String(o.props.kind), id: String(o.props.entityId) })} />
              : <ObjectView key={o.id} o={o} selected={selectedSet.has(o.id)} editing={o.id === editing} placeholder={t('canvas.text.placeholder')}
                  onDown={e => onObjectDown(e, o)} onEdit={() => (o.type === 'sticky' || o.type === 'text') && setEditing(o.id)} />)}
            {selectedObj && !editing && <SelectionHandles o={selectedObj} zoom={view.zoom} onDown={(e, h) => onHandleDown(e, selectedObj, h)} />}
          </g>
        </svg>
        {editingObj && board && <LiveTextEditor board={board} o={editingObj} view={view} placeholder={t('canvas.text.placeholder')} onDone={() => { undo?.stopCapturing(); setEditing(null) }} />}
        {picker && <EntityPicker workspaceId={workspaceId} onCreate={(k, n) => void createAndPlace(k, n)} onPick={ref => void placeRef(ref)} onClose={() => setPicker(false)} />}
        {selectedObjects.length > 0 && !editing && (
          <StyleInspector objects={selectedObjects} onChange={onStyleChange} />
        )}
        {cardDelete && (
          <div className="absolute inset-0 z-sash flex items-center justify-center bg-black/30" role="dialog" aria-modal="true" aria-labelledby="canvas-card-delete-title" data-testid="canvas-card-delete">
            <div data-glass-slot="dialog" className="w-[360px] rounded-lg border border-border bg-background p-4 shadow-lg">
              <h2 id="canvas-card-delete-title" className="text-sm font-semibold">{t('canvas.cardDelete.title')}</h2>
              <p className="mt-1 text-sm text-text-muted">{t('canvas.cardDelete.body')}</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCardDelete(null)}>{t('canvas.cardDelete.cancel')}</Button>
                {cardDeleteAllowed && registry.get(String(cardDelete.props.kind))?.delete && (
                  <Button variant="ghost" size="sm" className="text-destructive"
                    onClick={() => void confirmCardDelete(true)} data-testid="canvas-card-delete-entity">{t('canvas.cardDelete.delete')}</Button>
                )}
                <Button size="sm" autoFocus onClick={() => void confirmCardDelete(false)} data-testid="canvas-card-unlink">{t('canvas.cardDelete.unlink')}</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Uncontrolled textarea bound live to the object's Y.Text (see live-text.ts: remote deltas keep the caret, IME applies on compositionend). */
function LiveTextEditor({ board, o, view, placeholder, onDone }: { board: CanvasDoc; o: CanvasObject; view: { x: number; y: number; zoom: number }; placeholder: string; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const yt = board.textOf(o.id)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (yt) return bindTextArea(el, yt, LOCAL)
    // Legacy object without a Y.Text: plain prop writes.
    el.value = String(o.props.text ?? '')
    const onInput = () => board.update(o.id, { props: { text: el.value } }, LOCAL)
    el.addEventListener('input', onInput)
    return () => el.removeEventListener('input', onInput)
  }, [board, o.id, yt])
  return (
    <textarea ref={ref} autoFocus defaultValue={yt ? yt.toString() : String(o.props.text ?? '')} placeholder={placeholder} data-testid="canvas-text-editor" data-glass-slot="editor"
      className="absolute z-sticky resize-none rounded border border-accent bg-background p-2 text-sm text-foreground outline-none"
      style={{ left: view.x + o.x * view.zoom, top: view.y + o.y * view.zoom, width: o.w * view.zoom, height: o.h * view.zoom, transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined }}
      onBlur={onDone}
      onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur() }} />
  )
}

function SelectionHandles({ o, zoom, onDown }: { o: CanvasObject; zoom: number; onDown: (e: ReactPointerEvent, h: 'nw' | 'ne' | 'sw' | 'se' | 'rotate') => void }) {
  const s = 8 / zoom
  const corners = [['nw', o.x, o.y], ['ne', o.x + o.w, o.y], ['sw', o.x, o.y + o.h], ['se', o.x + o.w, o.y + o.h]] as const
  const cursor = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' } as const
  return (
    <g transform={o.rotation ? `rotate(${o.rotation} ${o.x + o.w / 2} ${o.y + o.h / 2})` : undefined} data-testid="canvas-selection">
      <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="none" className="stroke-accent" strokeWidth={1 / zoom} pointerEvents="none" />
      <line x1={o.x + o.w / 2} y1={o.y} x2={o.x + o.w / 2} y2={o.y - 24 / zoom} className="stroke-accent" strokeWidth={1 / zoom} />
      <circle cx={o.x + o.w / 2} cy={o.y - 24 / zoom} r={s / 1.6} className="fill-background stroke-accent" strokeWidth={1.5 / zoom} style={{ cursor: 'grab' }}
        onPointerDown={e => onDown(e, 'rotate')} data-handle="rotate" />
      {corners.map(([h, x, y]) => (
        <rect key={h} x={x - s / 2} y={y - s / 2} width={s} height={s} rx={2 / zoom} className="fill-background stroke-accent" strokeWidth={1.5 / zoom}
          style={{ cursor: cursor[h] }} onPointerDown={e => onDown(e, h)} data-handle={h} />
      ))}
    </g>
  )
}

function EntityPicker({ workspaceId, onCreate, onPick, onClose }: { workspaceId: string; onCreate: (k: CreatableKind, title: string) => void; onPick: (ref: EntityRef) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'create' | 'existing'>('create')
  const [kind, setKind] = useState<CreatableKind>('note')
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Array<{ ref: EntityRef; title: string }> | null>(null)
  useEffect(() => {
    if (tab !== 'existing') return
    let alive = true
    const h = setTimeout(() => { void searchExisting(workspaceId, q).then(r => alive && setItems(r)).catch(() => alive && setItems([])) }, 150)
    return () => { alive = false; clearTimeout(h) }
  }, [tab, q, workspaceId])
  const tabBtn = (id: 'create' | 'existing') => (
    <button aria-pressed={tab === id} onClick={() => setTab(id)} data-testid={`canvas-picker-tab-${id}`}
      className={`flex-1 rounded-md px-2 py-1 text-sm ${tab === id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-surface-hover'}`}>{t(`canvas.picker.${id}`)}</button>
  )
  return (
    <div data-glass-slot="popover" className="absolute left-16 top-3 z-chrome flex max-h-[70%] w-[320px] flex-col rounded-lg border border-border bg-background p-2 shadow-lg" data-testid="canvas-picker"
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="flex gap-1" role="group">{tabBtn('create')}{tabBtn('existing')}</div>
      {tab === 'create' ? (
        <form className="mt-2 flex flex-col gap-2" onSubmit={e => { e.preventDefault(); onCreate(kind, name) }}>
          <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={t('canvas.picker.kind')}>
            {CREATABLE_KINDS.map(k => (
              <button type="button" key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} data-testid={`canvas-picker-kind-${k}`}
                className={`truncate rounded-md border px-1 py-1 text-xs ${kind === k ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted hover:bg-surface-hover'}`}>{t(`canvas.picker.kind.${k}`)}</button>
            ))}
          </div>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={t('canvas.picker.titlePlaceholder')} aria-label={t('canvas.picker.titlePlaceholder')}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent" data-testid="canvas-picker-title" />
          <Button type="submit" size="sm" data-testid="canvas-picker-create"><Plus />{t('canvas.picker.createButton')}</Button>
        </form>
      ) : (
        <div className="mt-2 flex min-h-0 flex-col gap-1">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('canvas.picker.search')} aria-label={t('canvas.picker.search')}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent" data-testid="canvas-picker-search" />
          <div className="min-h-0 overflow-auto">
            {items?.length === 0 && <div className="px-2 py-2 text-xs text-text-muted">{t('canvas.picker.empty')}</div>}
            {items?.map(it => (
              <button key={`${it.ref.kind}:${it.ref.id}`} draggable data-testid="canvas-picker-item"
                onDragStart={e => { e.dataTransfer.setData(ENTITY_DRAG_MIME, JSON.stringify(it.ref)); e.dataTransfer.setData('text/plain', `${it.ref.kind}:${it.ref.id}`) }}
                onClick={() => onPick(it.ref)} data-glass-slot="row" className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-surface-hover">
                <span className="w-16 shrink-0 truncate text-xs text-text-muted">{kindLabel(t, it.ref.kind)}</span>
                <span className="truncate">{it.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function kindLabel(t: (k: string) => string, kind: string): string {
  return (ENTITY_KINDS as readonly string[]).includes(kind) ? t(kindDescriptor(kind as EntityKind).labelKey) : kind
}

function EntityCardView({ o, selected, r, onDown, onOpen }: { o: CanvasObject; selected: boolean; r: ResolvedEntity | undefined; onDown: (e: ReactPointerEvent) => void; onOpen: () => void }) {
  const { t } = useTranslation()
  const label = !r ? t('canvas.entity.loading')
    : r.state === 'ok' ? r.snapshot.title
    : r.state === 'forbidden' ? t('canvas.entity.noAccess')
    : r.state === 'deleted' ? t('canvas.entity.deleted') : t('canvas.entity.unknown')
  const transform = o.rotation ? `rotate(${o.rotation} ${o.x + o.w / 2} ${o.y + o.h / 2})` : undefined
  return (
    <g onPointerDown={onDown} onDoubleClick={onOpen} data-object-id={o.id} data-object-type="entity" data-entity-state={r?.state ?? 'loading'} transform={transform}>
      <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={10} className={`fill-background ${selected ? 'stroke-accent' : 'stroke-border'}`} strokeWidth={selected ? 2 : 1} />
      <rect x={o.x} y={o.y} width={4} height={o.h} rx={2} className="fill-accent" />
      <foreignObject x={o.x} y={o.y} width={o.w} height={o.h} pointerEvents="none">
        <div className="flex h-full w-full flex-col gap-1 p-3 pl-4 text-foreground">
          <div className="text-xs uppercase tracking-wide text-text-muted">{kindLabel(t, String(o.props.kind))}</div>
          <div className="line-clamp-3 text-sm font-medium">{label}</div>
          {r?.state === 'ok' && r.snapshot.status && <div className="text-xs text-text-muted">{r.snapshot.status}</div>}
        </div>
      </foreignObject>
    </g>
  )
}

function solidFill(o: CanvasObject): string | undefined {
  const f = o.style?.fill
  return f && f.type === 'solid' && typeof f.color === 'string' ? f.color : undefined
}
function strokeColor(o: CanvasObject): string | undefined {
  const c = o.style?.stroke?.color
  return typeof c === 'string' && c && c !== 'currentColor' ? c : undefined
}
function strokeWidthOf(o: CanvasObject, fallback: number): number {
  const w = o.style?.stroke?.width
  return typeof w === 'number' && Number.isFinite(w) ? w : fallback
}
function cornerRadiusOf(o: CanvasObject, fallback: number): number {
  const r = o.props.radius
  return typeof r === 'number' && Number.isFinite(r) ? r : fallback
}

function ObjectView({ o, selected, editing, placeholder, onDown, onEdit }: { o: CanvasObject; selected: boolean; editing: boolean; placeholder: string; onDown: (e: ReactPointerEvent) => void; onEdit: () => void }) {
  const text = typeof o.props.text === 'string' ? o.props.text : ''
  const sel = selected ? 'stroke-accent' : 'stroke-border'
  const common = { onPointerDown: onDown, onDoubleClick: onEdit, opacity: o.opacity, 'data-object-id': o.id, 'data-object-type': o.type }
  const transform = o.rotation ? `rotate(${o.rotation} ${o.x + o.w / 2} ${o.y + o.h / 2})` : undefined
  const fill = solidFill(o)
  const stroke = strokeColor(o)
  const fontSize = typeof o.style?.font?.size === 'number' ? o.style.font.size : undefined
  const fontWeight = typeof o.style?.font?.weight === 'number' ? o.style.font.weight : undefined
  if (o.type === 'sticky' || o.type === 'text') {
    const sticky = o.type === 'sticky'
    const rx = sticky ? 8 : 4
    return (
      <g {...common} transform={transform}>
        <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={rx}
          fill={fill ?? (sticky ? undefined : 'transparent')}
          className={`${fill ? '' : sticky ? 'fill-accent/15' : 'fill-transparent'} ${selected ? 'stroke-accent' : stroke ? '' : sticky ? sel : 'stroke-transparent hover:stroke-border'}`}
          stroke={selected ? undefined : stroke}
          strokeWidth={selected ? 2 : strokeWidthOf(o, 1)} />
        {!editing && (
          <foreignObject x={o.x} y={o.y} width={o.w} height={o.h} pointerEvents="none">
            <div
              className={`h-full w-full overflow-hidden whitespace-pre-wrap break-words p-2 ${text ? 'text-foreground' : 'italic text-text-muted'} ${fontSize ? '' : 'text-sm'}`}
              style={{ fontSize: fontSize ? `${fontSize}px` : undefined, fontWeight: fontWeight || undefined }}
            >{text || placeholder}</div>
          </foreignObject>
        )}
      </g>
    )
  }
  if (o.type === 'shape') {
    const ellipse = o.props.kind === 'ellipse'
    const sw = strokeWidthOf(o, 1.5)
    const strokeCls = selected ? 'stroke-accent' : stroke ? '' : 'stroke-border-strong'
    const fillCls = fill ? '' : 'fill-accent/5'
    return (
      <g {...common} transform={transform}>
        {ellipse
          ? <ellipse cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2}
              fill={fill} className={`${fillCls} ${strokeCls}`} stroke={selected ? undefined : stroke} strokeWidth={selected ? 2 : sw} />
          : <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={cornerRadiusOf(o, 6)}
              fill={fill} className={`${fillCls} ${strokeCls}`} stroke={selected ? undefined : stroke} strokeWidth={selected ? 2 : sw} />}
      </g>
    )
  }
  if (o.type === 'line' || o.type === 'ink') {
    const pts = readPoints(o.props)
    const sw = strokeWidthOf(o, 2)
    const strokeCls = selected ? 'stroke-accent' : stroke ? '' : 'stroke-foreground'
    const hit = Math.max(12, sw + 8)
    const poly = toPolylineAttr(pts, o.x, o.y)
    const path = o.type === 'ink' ? toSmoothPath(pts, o.x, o.y) : ''
    return (
      <g {...common} transform={transform} data-testid={o.type === 'ink' ? 'canvas-ink' : 'canvas-line'}>
        {o.type === 'line'
          ? <>
              <polyline points={poly} fill="none" stroke="transparent" strokeWidth={hit} strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={poly} fill="none" className={strokeCls} stroke={selected ? undefined : stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
            </>
          : <>
              <path d={path} fill="none" stroke="transparent" strokeWidth={hit} strokeLinecap="round" strokeLinejoin="round" />
              <path d={path} fill="none" className={strokeCls} stroke={selected ? undefined : stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
            </>}
      </g>
    )
  }
  // Types without a renderer yet (later phases) still show and stay movable.
  return (
    <g {...common} transform={transform}>
      <rect x={o.x} y={o.y} width={Math.max(o.w, 40)} height={Math.max(o.h, 24)} rx={4} className={`fill-surface-hover ${sel}`} strokeDasharray="4 3" strokeWidth={1} />
      <text x={o.x + 6} y={o.y + 16} className="fill-text-muted text-xs">{o.type}</text>
    </g>
  )
}

export default CanvasSurfacePage

/** Tooltip primitive around an icon button (native titles are slow and invisible to keyboard users). */
function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
