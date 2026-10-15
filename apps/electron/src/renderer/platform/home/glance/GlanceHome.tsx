/**
 * Glance-style Home pages (clean-room). Page tabs live next to the built-in
 * «Обзор» dashboard; each page renders small/full columns of widget cards.
 * Edit mode: drag cards within/between columns (dnd-kit), add/remove/resize
 * columns, per-widget settings, groups, presets and JSON import/export.
 * Widget bodies are lazy chunks mounted only when the card nears the viewport.
 */
import * as React from 'react'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AppWindow, Bookmark, ChevronDown, ChevronLeft, ChevronRight, Clock, Columns3, FileText, GitBranch, GripVertical, Layers, LayoutGrid, ListChecks, MessageSquare, Newspaper, Play, Plus, Radio, Rss, Settings2, Tag, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  GLANCE_MAX_HEIGHT,
  GLANCE_MIN_HEIGHT,
  addColumn,
  addGroupChild,
  addWidgetInstance,
  findWidget,
  moveColumn,
  moveWidgetInstance,
  removeColumn,
  removePage,
  removeWidgetInstance,
  resizeColumnByDrag,
  setColumnSize,
  shiftGroupChild,
  shiftWidgetInstance,
  updatePage,
  updateWidgetInstance,
  type GlanceColumn,
  type GlanceConfig,
  type GlanceLayout,
  type GlancePage,
  type GlanceWidgetInstance,
} from './model'
import { GLANCE_CATEGORIES, getGlanceWidget, glanceWidgetTitle, listGlanceWidgets, resolveConfig, type GlanceField, type GlanceWidgetDef } from './registry'
import { registerBuiltinGlanceWidgets } from './builtin'

/** Category labels reuse existing generic catalogue keys where the English text is identical. */
const CATEGORY_LABEL_KEY: Record<string, string> = {'rox': 'onboarding.providerSelect.rox', 'news': 'feed.tab.news', 'media': 'rovers.category.media', 'dev': 'label.default.development', 'system': 'inspector.context.system', 'advanced': 'settings.workspace.advanced'}


registerBuiltinGlanceWidgets()

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'layout-grid': LayoutGrid,
  clock: Clock,
  'list-checks': ListChecks,
  bookmark: Bookmark,
  'app-window': AppWindow,
  'file-text': FileText,
  layers: Layers,
  rss: Rss,
  newspaper: Newspaper,
  'message-square': MessageSquare,
  play: Play,
  radio: Radio,
  tag: Tag,
  'git-branch': GitBranch,
}

export function glanceIcon(name: string): React.ComponentType<{ className?: string }> {
  return ICONS[name] ?? LayoutGrid
}

export function IconButton({ label, onClick, children, pressed, testId, danger }: { label: string; onClick: () => void; children: React.ReactNode; pressed?: boolean; testId?: string; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-glance-action={testId}
      className={cn('flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-control)] px-1 text-muted-foreground hover:bg-surface-pressed', danger ? 'hover:text-destructive' : 'hover:text-foreground', pressed && 'bg-surface-pressed text-foreground')}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Page view
// ---------------------------------------------------------------------------

const PAGE_MAX_WIDTH: Record<GlancePage['width'], number> = { slim: 1100, default: 1600, wide: 1920 }
const SMALL_COLUMN_PX = 300

export function GlancePageView({
  layout,
  page,
  onChange,
  editing,
  onDeleted,
}: {
  layout: GlanceLayout
  page: GlancePage
  onChange: (next: GlanceLayout) => void
  editing: boolean
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const containerRef = useRef<HTMLDivElement>(null)
  const narrow = useNarrow(containerRef, 900)

  const onDragEnd = (event: DragEndEvent) => {
    const active = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (!overId || active === overId) return
    const targetColumn = page.columns.find((c) => c.id === overId || `drop:${c.id}` === overId)
    if (targetColumn) {
      onChange(moveWidgetInstance(layout, active, { pageId: page.id, columnId: targetColumn.id, index: targetColumn.widgets.length }))
      return
    }
    const over = findWidget(layout, overId)
    if (!over || over.at.groupId || over.at.pageId !== page.id) return
    onChange(moveWidgetInstance(layout, active, { pageId: page.id, columnId: over.at.columnId, index: over.at.index }))
  }

  const settingsTarget = settingsFor ? findWidget(layout, settingsFor) : null

  return (
    <div ref={containerRef} className="mx-auto flex w-full min-w-0 flex-col gap-2" style={{ maxWidth: PAGE_MAX_WIDTH[page.width] }} data-glance-page={page.id}>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-glance-page-toolbar="">
          <input
            value={page.title}
            onChange={(e) => onChange(updatePage(layout, page.id, { title: e.target.value }))}
            aria-label={t('glance.pageTitle')}
            placeholder={t('notes.untitled')}
            className="h-7 w-48 rounded-[var(--radius-control)] bg-surface-hover px-2 text-sm font-bold outline-none focus:bg-surface-pressed"
          />
          <GlanceSelect
            label={t('glance.pageWidth')}
            value={page.width}
            onChange={(v) => onChange(updatePage(layout, page.id, { width: v as GlancePage['width'] }))}
            options={(['slim', 'default', 'wide'] as const).map((w) => ({ value: w, label: t(w === 'default' ? 'common.default' : w === 'slim' ? 'glance.column.small' : 'glance.column.full') }))}
            className="w-32"
          />
          <IconButton label={t('kanban.column.add')} onClick={() => onChange(addColumn(layout, page.id))} testId="add-column"><Columns3 className="icon-toolbar" /></IconButton>
          <span className="flex-1" />
          <IconButton
            label={t('common.delete')}
            danger
            testId="delete-page"
            onClick={() => {
              onChange(removePage(layout, page.id))
              onDeleted()
            }}
          >
            <Trash2 className="icon-toolbar" />
          </IconButton>
        </div>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div
          className={cn('grid min-w-0', narrow ? 'grid-cols-1' : '')}
          style={narrow ? undefined : { gridTemplateColumns: page.columns.map((c) => (c.size === 'small' ? `${SMALL_COLUMN_PX}px` : 'minmax(0, 1fr)')).join(' ') }}
          data-glance-columns={page.columns.length}
        >
          {page.columns.map((column, ci) => (
            <GlanceColumnView
              key={column.id}
              layout={layout}
              page={page}
              column={column}
              index={ci}
              editing={editing}
              onChange={onChange}
              onSettings={setSettingsFor}
              onAdd={() => setPickerFor(column.id)}
              last={ci === page.columns.length - 1}
            />
          ))}
        </div>
      </DndContext>
      {pickerFor ? (
        <GlanceWidgetPicker
          onClose={() => setPickerFor(null)}
          onPick={(def) => {
            onChange(addWidgetInstance(layout, page.id, pickerFor, { type: def.type, config: { ...def.defaultConfig } }))
            setPickerFor(null)
          }}
          onPickGroup={() => {
            onChange(addWidgetInstance(layout, page.id, pickerFor, { type: 'group', config: {}, children: [] }))
            setPickerFor(null)
          }}
        />
      ) : null}
      {settingsTarget ? (
        <GlanceSettingsDialog
          key={settingsTarget.widget.id}
          widget={settingsTarget.widget}
          onClose={() => setSettingsFor(null)}
          onSave={(patch) => {
            onChange(updateWidgetInstance(layout, settingsTarget.widget.id, patch))
            setSettingsFor(null)
          }}
          onAddChild={settingsTarget.widget.type === 'group' ? (def) => onChange(addGroupChild(layout, settingsTarget.widget.id, { type: def.type, config: { ...def.defaultConfig } })) : undefined}
          onShiftChild={settingsTarget.widget.type === 'group' ? (childId, delta) => onChange(shiftGroupChild(layout, settingsTarget.widget.id, childId, delta)) : undefined}
          onChildSettings={settingsTarget.widget.type === 'group' ? (childId) => setSettingsFor(childId) : undefined}
          onRemoveChild={settingsTarget.widget.type === 'group' ? (childId) => onChange(removeWidgetInstance(layout, childId)) : undefined}
        />
      ) : null}
    </div>
  )
}

function useNarrow(ref: React.RefObject<HTMLElement | null>, breakpoint: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => setNarrow((entries[0]?.contentRect.width ?? breakpoint) < breakpoint))
    ro.observe(el)
    return () => ro.disconnect()
  }, [breakpoint, ref])
  return narrow
}

function GlanceColumnView({
  layout,
  page,
  column,
  index,
  editing,
  onChange,
  onSettings,
  onAdd,
  last,
}: {
  layout: GlanceLayout
  page: GlancePage
  column: GlanceColumn
  index: number
  editing: boolean
  onChange: (next: GlanceLayout) => void
  onSettings: (id: string) => void
  onAdd: () => void
  last: boolean
}) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${column.id}`, disabled: !editing })
  const fulls = page.columns.filter((c) => c.size === 'full').length
  return (
    <section
      ref={setNodeRef}
      className={cn('rox-grid-tile relative flex min-w-0 flex-col', !last && 'pr-px', isOver && 'bg-surface-hover')}
      aria-label={t('glance.columnN', { n: index + 1 })}
      data-glance-column={column.size}
    >
      {editing ? (
        <div className="flex h-7 items-center gap-1 px-2 text-xs text-muted-foreground" data-glance-column-toolbar="">
          <GlanceSelect
            label={t('glance.columnSize')}
            value={column.size}
            onChange={(v) => onChange(setColumnSize(layout, page.id, column.id, v as GlanceColumn['size']))}
            options={[
              { value: 'small', label: t('glance.column.small'), disabled: column.size === 'full' && fulls <= 1 },
              { value: 'full', label: t('glance.column.full'), disabled: column.size === 'small' && fulls >= 2 },
            ]}
            className="w-28"
          />
          <IconButton label={t('glance.moveLeft')} onClick={() => onChange(moveColumn(layout, page.id, column.id, -1))}><ChevronLeft className="icon-caption" /></IconButton>
          <IconButton label={t('glance.moveRight')} onClick={() => onChange(moveColumn(layout, page.id, column.id, 1))}><ChevronRight className="icon-caption" /></IconButton>
          <span className="flex-1" />
          {page.columns.length > 1 ? (
            <IconButton label={t('kanban.column.remove')} danger onClick={() => onChange(removeColumn(layout, page.id, column.id))}><X className="icon-caption" /></IconButton>
          ) : null}
        </div>
      ) : null}
      <SortableContext items={column.widgets.map((w) => w.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-w-0 flex-col">
          {column.widgets.map((widget) => (
            <GlanceCard key={widget.id} layout={layout} widget={widget} column={column.size} editing={editing} onChange={onChange} onSettings={onSettings} />
          ))}
        </div>
      </SortableContext>
      {column.widgets.length === 0 && !editing ? <p className="px-3 py-6 text-sm text-muted-foreground">{t('glance.emptyColumn')}</p> : null}
      {editing ? (
        <button type="button" onClick={onAdd} className="rox-home-add-cell m-2 flex h-12 items-center justify-center gap-1 rounded-[var(--radius-control)] text-sm font-bold text-muted-foreground hover:text-foreground" data-glance-add-widget={column.id}>
          <Plus className="icon-toolbar" />
          {t('workbench.home.edit.addWidget')}
        </button>
      ) : null}
      {editing && !last ? <ColumnResizeHandle size={column.size} onResize={(dx) => onChange(resizeColumnByDrag(layout, page.id, column.id, dx))} /> : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

class CardBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('[home/glance] widget crashed', error)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const lazyCache = new Map<string, React.LazyExoticComponent<React.ComponentType<import('./registry').GlanceWidgetProps>>>()
function lazyBody(def: GlanceWidgetDef) {
  let C = lazyCache.get(def.type)
  if (!C) {
    C = React.lazy(def.load)
    lazyCache.set(def.type, C)
  }
  return C
}

/** Mount children only once the element is near the viewport. */
function useNearViewport<T extends HTMLElement>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (seen) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true)
        io.disconnect()
      }
    }, { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen]
}

function useWidth<T extends HTMLElement>(ref: React.RefObject<T | null>): number {
  const [w, setW] = useState(320)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth || 320)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (next) setW(next)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

function GlanceCard({
  layout,
  widget,
  column,
  editing,
  onChange,
  onSettings,
}: {
  layout: GlanceLayout
  widget: GlanceWidgetInstance
  column: 'small' | 'full'
  editing: boolean
  onChange: (next: GlanceLayout) => void
  onSettings: (id: string) => void
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id, disabled: !editing })
  const [viewRef, near] = useNearViewport<HTMLDivElement>()
  const [previewHeight, setPreviewHeight] = useState<number | undefined>(undefined)
  const width = useWidth(viewRef)
  const def = widget.type === 'group' ? null : getGlanceWidget(widget.type)
  const title = widget.title ?? (widget.type === 'group' ? t('sidebar.group') : def ? glanceWidgetTitle(def, t) : widget.type)
  const frameless = !!def?.frameless && !editing
  const chrome = (
    <header className="flex h-7 shrink-0 items-center gap-1 px-3">
      {editing ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="-ml-1 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-pressed hover:text-foreground active:cursor-grabbing"
          aria-label={t('workbench.home.edit.drag', { name: title })}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') { event.preventDefault(); onChange(shiftWidgetInstance(layout, widget.id, -1)) }
            else if (event.key === 'ArrowDown') { event.preventDefault(); onChange(shiftWidgetInstance(layout, widget.id, 1)) }
          }}
        >
          <GripVertical className="icon-toolbar" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onChange(updateWidgetInstance(layout, widget.id, { collapsed: !widget.collapsed }))}
        className="group flex min-w-0 items-center gap-0.5 text-sm font-bold uppercase caps-label text-muted-foreground hover:text-foreground"
        aria-expanded={!widget.collapsed}
      >
        <span className="truncate" title={title}>{title}</span>
        <ChevronDown className={cn('icon-caption shrink-0 opacity-0 transition group-hover:opacity-100', widget.collapsed && '-rotate-90 opacity-100')} />
      </button>
      <span className="flex-1" />
      {editing ? (
        <>
          <IconButton label={t('glance.settings', { name: title })} onClick={() => onSettings(widget.id)} testId="settings"><Settings2 className="icon-toolbar" /></IconButton>
          <IconButton label={t('workbench.home.edit.remove', { name: title })} danger onClick={() => onChange(removeWidgetInstance(layout, widget.id))} testId="remove"><X className="icon-toolbar" /></IconButton>
        </>
      ) : null}
    </header>
  )
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('rox-grid-tile relative min-w-0', isDragging && 'z-raised opacity-80')}
      data-glance-widget={widget.type}
      data-glance-id={widget.id}
      data-glass-slot={def?.frameless ? undefined : 'card'}
      aria-label={title}
    >
      {frameless ? null : chrome}
      <div
        ref={viewRef}
        className={cn('min-w-0', !frameless && 'px-3 pb-3', widget.collapsed && 'hidden', (previewHeight ?? widget.height) !== undefined && 'overflow-y-auto')}
        style={(previewHeight ?? widget.height) !== undefined ? { height: previewHeight ?? widget.height } : undefined}
      >
        {widget.collapsed ? null : near ? (
          widget.type === 'group' ? (
            <GroupBody group={widget} column={column} width={width} layout={layout} onChange={onChange} />
          ) : def ? (
            <WidgetBody def={def} widget={widget} column={column} width={width} layout={layout} onChange={onChange} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('glance.unknownWidget')}</p>
          )
        ) : (
          <div className="h-24 animate-pulse rounded-[var(--radius-control)] bg-surface-hover" aria-hidden />
        )}
      </div>
      {editing && !widget.collapsed ? (
        <HeightResizeHandle
          bodyRef={viewRef}
          onPreview={setPreviewHeight}
          onCommit={(h) => { setPreviewHeight(undefined); onChange(updateWidgetInstance(layout, widget.id, { height: h })) }}
        />
      ) : null}
    </article>
  )
}

/** Drag the column's right edge: right → full, left → small (snap, column rules apply). */
function ColumnResizeHandle({ size, onResize }: { size: 'small' | 'full'; onResize: (dx: number) => void }) {
  const { t } = useTranslation()
  const start = useRef<number | null>(null)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('glance.resizeColumn')}
      aria-valuetext={t(size === 'small' ? 'glance.column.small' : 'glance.column.full')}
      title={`${t('glance.resizeColumn')}: ${t(size === 'small' ? 'glance.column.small' : 'glance.column.full')}`}
      tabIndex={0}
      data-glance-column-resize={size}
      className="absolute inset-y-0 -right-1 z-raised w-2 cursor-col-resize hover:bg-surface-pressed focus-visible:bg-surface-pressed"
      onPointerDown={(e) => { start.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerUp={(e) => { if (start.current !== null) onResize(e.clientX - start.current); start.current = null }}
      onPointerCancel={() => { start.current = null }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); onResize(1000) }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); onResize(-1000) }
      }}
    />
  )
}

/** Drag the bottom edge to set a fixed body height; double-click (or Delete) resets. */
function HeightResizeHandle({ bodyRef, onPreview, onCommit }: { bodyRef: React.RefObject<HTMLDivElement | null>; onPreview: (h: number | undefined) => void; onCommit: (h: number | null) => void }) {
  const { t } = useTranslation()
  const drag = useRef<{ y: number; h: number; last: number } | null>(null)
  const clampH = (h: number) => Math.round(Math.min(GLANCE_MAX_HEIGHT, Math.max(GLANCE_MIN_HEIGHT, h)))
  const current = () => bodyRef.current?.getBoundingClientRect().height ?? GLANCE_MIN_HEIGHT
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('glance.resizeWidget')}
      title={t('glance.resizeWidget')}
      tabIndex={0}
      data-glance-height-resize=""
      className="h-2 w-full cursor-row-resize hover:bg-surface-pressed focus-visible:bg-surface-pressed"
      onPointerDown={(e) => { const h = current(); drag.current = { y: e.clientY, h, last: h }; e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; d.last = clampH(d.h + e.clientY - d.y); onPreview(d.last) }}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d && Math.abs(d.last - d.h) >= 4) onCommit(d.last); else onPreview(undefined) }}
      onPointerCancel={() => { drag.current = null; onPreview(undefined) }}
      onDoubleClick={() => onCommit(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); onCommit(clampH(current() + (e.key === 'ArrowDown' ? 40 : -40))) }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onCommit(null) }
      }}
    />
  )
}

function WidgetBody({ def, widget, column, width, layout, onChange }: { def: GlanceWidgetDef; widget: GlanceWidgetInstance; column: 'small' | 'full'; width: number; layout: GlanceLayout; onChange: (next: GlanceLayout) => void }) {
  const { t } = useTranslation()
  const Body = lazyBody(def)
  const config = useMemo(() => resolveConfig(def, widget.config), [def, widget.config])
  return (
    <CardBoundary fallback={<p className="text-sm text-muted-foreground">{t('workbench.home.widgetFailed')}</p>}>
      <Suspense fallback={<div className="h-16 animate-pulse rounded-[var(--radius-control)] bg-surface-hover" aria-busy="true" />}>
        <Body instance={widget} config={config} width={width} column={column} onConfig={(next: GlanceConfig) => onChange(updateWidgetInstance(layout, widget.id, { config: next }))} />
      </Suspense>
    </CardBoundary>
  )
}

function GroupBody({ group, column, width, layout, onChange }: { group: GlanceWidgetInstance; column: 'small' | 'full'; width: number; layout: GlanceLayout; onChange: (next: GlanceLayout) => void }) {
  const { t } = useTranslation()
  const kids = group.children ?? []
  const [active, setActive] = useState(0)
  if (kids.length === 0) return <p className="text-sm text-muted-foreground">{t('glance.emptyGroup')}</p>
  const current = kids[Math.min(active, kids.length - 1)]!
  const def = getGlanceWidget(current.type)
  return (
    <div className="flex min-w-0 flex-col gap-2" data-glance-group="">
      {/* eslint-disable-next-line rox/prefer-primitives -- compact in-card tab strip; Tabs primitive needs one content panel per tab, bodies here are lazily mounted one at a time */}
      <div className="flex flex-wrap gap-1" role="tablist">
        {kids.map((kid, i) => {
          const kidDef = getGlanceWidget(kid.type)
          const label = kid.title ?? (kidDef ? glanceWidgetTitle(kidDef, t) : kid.type)
          return (
            // eslint-disable-next-line rox/prefer-primitives -- see tablist above
            <button key={kid.id} type="button" role="tab" aria-selected={i === active} onClick={() => setActive(i)} className={cn('h-6 rounded-[var(--radius-control)] px-2 text-xs font-bold', i === active ? 'bg-surface-selected text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          )
        })}
      </div>
      {def ? <WidgetBody key={current.id} def={def} widget={current} column={column} width={width} layout={layout} onChange={onChange} /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

function GlanceWidgetPicker({ onPick, onPickGroup, onClose }: { onPick: (def: GlanceWidgetDef) => void; onPickGroup: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const all = listGlanceWidgets()
  const q = query.trim().toLowerCase()
  const match = (def: GlanceWidgetDef) => !q || glanceWidgetTitle(def, t).toLowerCase().includes(q) || def.type.includes(q)
  return (
    <Modal title={t('workbench.home.picker.title')} onClose={onClose} testId="glance-picker">
      <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('glance.searchWidgets')} aria-label={t('glance.searchWidgets')} className="h-8 w-full rounded-[var(--radius-control)] bg-surface-hover px-2 text-sm outline-none" />
      <div className="mt-2 flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
        {GLANCE_CATEGORIES.map((cat) => {
          const defs = all.filter((d) => d.category === cat && match(d))
          const showGroup = cat === 'advanced' && (!q || t('sidebar.group').toLowerCase().includes(q))
          if (defs.length === 0 && !showGroup) return null
          return (
            <div key={cat}>
              <h3 className="pb-1 text-xs font-bold uppercase caps-label text-muted-foreground">{t(CATEGORY_LABEL_KEY[cat] ?? `glance.cat.${cat}`)}</h3>
              <ul className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {defs.map((def) => {
                  const Icon = glanceIcon(def.icon)
                  return (
                    <li key={def.type}>
                      <button type="button" onClick={() => onPick(def)} className="rox-home-tile flex w-full items-start gap-2 rounded-[var(--radius-card)] px-2.5 py-2 text-left" data-glance-pick={def.type}>
                        <Icon className="mt-0.5 icon-toolbar shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-bold text-foreground">{glanceWidgetTitle(def, t)}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
                {showGroup ? (
                  <li>
                    <button type="button" onClick={onPickGroup} className="rox-home-tile flex w-full items-start gap-2 rounded-[var(--radius-card)] px-2.5 py-2 text-left" data-glance-pick="group">
                      <Layers className="mt-0.5 icon-toolbar shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-bold text-foreground">{t('sidebar.group')}</span>
                      </span>
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function Modal({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId: string }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[720px] flex-col" data-glance-modal={testId}>
        <DialogTitle>{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function GlanceSettingsDialog({
  widget,
  onClose,
  onSave,
  onAddChild,
  onRemoveChild,
  onShiftChild,
  onChildSettings,
}: {
  widget: GlanceWidgetInstance
  onClose: () => void
  onSave: (patch: { title: string | null; config: GlanceConfig }) => void
  onAddChild?: (def: GlanceWidgetDef) => void
  onRemoveChild?: (childId: string) => void
  onShiftChild?: (childId: string, delta: -1 | 1) => void
  onChildSettings?: (childId: string) => void
}) {
  const { t } = useTranslation()
  const def = widget.type === 'group' ? null : getGlanceWidget(widget.type)
  const [title, setTitle] = useState(widget.title ?? '')
  const [config, setConfig] = useState<GlanceConfig>(() => (def ? resolveConfig(def, widget.config) : widget.config))
  const name = widget.title ?? (def ? glanceWidgetTitle(def, t) : t('sidebar.group'))
  return (
    <Modal title={t('glance.settings', { name })} onClose={onClose} testId="glance-settings">
      <form
        className="flex flex-col gap-3 overflow-y-auto"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ title: title.trim() || null, config: def ? resolveConfig(def, config) : config })
        }}
      >
        <Labeled label={t('collection.table.column.title')}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={def ? glanceWidgetTitle(def, t) : ''} className={INPUT} />
        </Labeled>
        {def?.fields.map((field) => (
          <FieldEditor key={field.key} field={field} value={config[field.key]} onChange={(v) => setConfig((c) => ({ ...c, [field.key]: v }))} />
        ))}
        {widget.type === 'group' && onAddChild && onRemoveChild ? (
          <GroupEditor group={widget} onAdd={onAddChild} onRemove={onRemoveChild} onShift={onShiftChild} onSettings={onChildSettings} />
        ) : null}
        <div className="flex justify-end gap-1">
          <button type="button" onClick={onClose} className="h-7 rounded-[var(--radius-control)] px-3 text-sm text-muted-foreground hover:bg-surface-pressed">{t('common.cancel')}</button>
          <button type="submit" className="h-7 rounded-[var(--radius-control)] bg-foreground px-3 text-sm font-bold text-background" data-glance-save="">{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  )
}

const INPUT = 'h-8 w-full rounded-[var(--radius-control)] bg-surface-hover px-2 text-sm outline-none focus:bg-surface-pressed'

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase caps-label text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function FieldEditor({ field, value, onChange }: { field: GlanceField; value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useTranslation()
  const label = t(field.labelKey)
  const hint = field.hintKey ? t(field.hintKey) : undefined
  switch (field.kind) {
    case 'text':
    case 'url':
      return <Labeled label={label} hint={hint}><input type={field.kind === 'url' ? 'url' : 'text'} value={typeof value === 'string' ? value : ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} className={INPUT} /></Labeled>
    case 'textarea':
      return <Labeled label={label} hint={hint}><textarea value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} rows={6} className={cn(INPUT, 'h-auto py-1')} /></Labeled>
    case 'number':
      return <Labeled label={label} hint={hint}><input type="number" value={typeof value === 'number' ? value : ''} min={field.min} max={field.max} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className={INPUT} /></Labeled>
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      )
    case 'select':
      return (
        <Labeled label={label} hint={hint}>
          <GlanceSelect label={label} value={typeof value === 'string' ? value : ''} onChange={onChange} options={(field.options ?? []).map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
        </Labeled>
      )
    case 'strings':
      return (
        <Labeled label={label} hint={hint ?? t('glance.h.onePerLine')}>
          <textarea value={Array.isArray(value) ? (value as string[]).join('\n') : ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value.split('\n'))} rows={4} className={cn(INPUT, 'h-auto py-1 font-mono')} />
        </Labeled>
      )
    case 'links': {
      const links = Array.isArray(value) ? (value as { title: string; url: string }[]) : []
      return (
        <Labeled label={label} hint={hint ?? t('glance.h.links')}>
          <textarea
            value={links.map((l) => (l.title ? `${l.title} | ${l.url}` : l.url)).join('\n')}
            onChange={(e) => onChange(parseLinksText(e.target.value))}
            rows={6}
            className={cn(INPUT, 'h-auto py-1 font-mono')}
          />
        </Labeled>
      )
    }
  }
}

/** `Title | https://url` per line (title optional). */
export function parseLinksText(text: string): { title: string; url: string }[] {
  return text.split('\n').map((line) => {
    const bar = line.lastIndexOf('|')
    return bar >= 0 ? { title: line.slice(0, bar).trim(), url: line.slice(bar + 1).trim() } : { title: '', url: line.trim() }
  }).filter((l) => l.url)
}

function GroupEditor({ group, onAdd, onRemove, onShift, onSettings }: { group: GlanceWidgetInstance; onAdd: (def: GlanceWidgetDef) => void; onRemove: (id: string) => void; onShift?: (id: string, delta: -1 | 1) => void; onSettings?: (id: string) => void }) {
  const { t } = useTranslation()
  const [type, setType] = useState('')
  const defs = listGlanceWidgets()
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase caps-label text-muted-foreground">{t('glance.groupTabs')}</span>
      <ul className="flex flex-col gap-0.5">
        {(group.children ?? []).map((kid, i, all) => {
          const def = getGlanceWidget(kid.type)
          const name = kid.title ?? (def ? glanceWidgetTitle(def, t) : kid.type)
          return (
            <li key={kid.id} className="flex items-center gap-1 text-sm" data-glance-group-child={kid.id}>
              <span className="flex-1 truncate">{name}</span>
              {onShift && i > 0 ? <IconButton label={t('glance.moveLeft')} onClick={() => onShift(kid.id, -1)} testId="child-left"><ChevronLeft className="icon-caption" /></IconButton> : null}
              {onShift && i < all.length - 1 ? <IconButton label={t('glance.moveRight')} onClick={() => onShift(kid.id, 1)} testId="child-right"><ChevronRight className="icon-caption" /></IconButton> : null}
              {onSettings ? <IconButton label={t('glance.settings', { name })} onClick={() => onSettings(kid.id)} testId="child-settings"><Settings2 className="icon-caption" /></IconButton> : null}
              <IconButton label={t('workbench.home.edit.remove', { name: kid.title ?? kid.type })} danger onClick={() => onRemove(kid.id)}><X className="icon-caption" /></IconButton>
            </li>
          )
        })}
      </ul>
      <div className="flex gap-1">
        <GlanceSelect label={t('glance.groupAdd')} value={type} placeholder={t('glance.groupAdd')} onChange={setType} options={defs.map((d) => ({ value: d.type, label: glanceWidgetTitle(d, t) }))} className="flex-1" />
        <button type="button" disabled={!type} onClick={() => { const d = getGlanceWidget(type); if (d) onAdd(d); setType('') }} className="h-8 rounded-[var(--radius-control)] px-2 text-sm font-bold text-foreground hover:bg-surface-pressed disabled:opacity-40">
          <Plus className="icon-toolbar" />
        </button>
      </div>
    </div>
  )
}

export function GlanceSelect({ label, value, options, onChange, className, placeholder }: { label: string; value: string; options: readonly { value: string; label: string; disabled?: boolean }[]; onChange: (value: string) => void; className?: string; placeholder?: string }) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={cn('h-7 text-sm', className)}>
        <SelectValue placeholder={placeholder}>{options.find((o) => o.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
